import type { WebSocket } from 'ws';
import type { AlgorithmResult } from './pose-algorithm';
import type { WsMessage } from '../lib/ws-client';
import { CircuitBreaker } from './circuit-breaker';
import { TTSQueue, type TtsPriority } from './tts-queue';
import { CoachPersonality, buildSystemPrompt, type Mood } from './coach-personality';
import { generateQuickCoaching, generateIdleCoaching, getExerciseName } from './coaching-templates';
import { parseVoiceCommand, getVoiceCommandReply } from './voice-command';
import { getHealth, assessHeartRate, sleepAdvice, type WatchHealthData } from '../lib/health-store';
import { LLMClient, TTSClient, Config } from 'coze-coding-dev-sdk';

// ─── 类型 ──────────────────────────────────────

export type Priority = 'high' | 'medium' | 'low';
export type Trigger = 'voice' | 'pose_quality_drop' | 'pose_rep' | 'pose_milestone' | 'timer_idle' | 'timer_periodic';

interface ConversationMessage {
  role: 'user' | 'coach' | 'system';
  content: string;
  timestamp: number;
}

interface SessionStats {
  totalReps: number;
  bestStreak: number;
  startTime: number;
  exerciseBreakdown: Record<string, number>;
}

interface SpeechDecision {
  should: boolean;
  urgency: Priority;
  trigger: Trigger;
  useLLM: boolean;
  fallbackText: string;
}

interface SessionConfig {
  llmTimeoutMs: number;
  speechCooldownMs: number;
  idleThresholdMs: number;
  deepCoachIntervalMs: number;
  maxHistoryLength: number;
}

const DEFAULT_CONFIG: SessionConfig = {
  llmTimeoutMs: 2500,
  speechCooldownMs: 2000,
  idleThresholdMs: 10_000,
  deepCoachIntervalMs: 30_000,
  maxHistoryLength: 20,
};

const MILESTONE_REPS = new Set([5, 10, 15, 20, 30, 50]);

// ─── CoachSession ─────────────────────────────

export class CoachSession {
  private ws: WebSocket;
  private config: SessionConfig;

  // 记忆
  private history: ConversationMessage[] = [];
  private lastAlgorithmResult: AlgorithmResult | null = null;
  private recentQualityScores: number[] = [];
  private sessionStats: SessionStats = {
    totalReps: 0, bestStreak: 0, startTime: Date.now(),
    exerciseBreakdown: {},
  };
  private lastCoachMessage = '';
  private lastSpeechTime = 0;
  private consecutivePerfect = 0;

  // 子模块
  private circuitBreaker = new CircuitBreaker({ threshold: 3, resetTimeoutMs: 30_000 });
  private ttsQueue = new TTSQueue({ maxSize: 5, dedupWindowMs: 5_000 });
  private personality = new CoachPersonality();

  // SDK clients (lazy init)
  private llmClient: LLMClient | null = null;
  private ttsClient: TTSClient | null = null;

  // 定时器
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivityTime = Date.now();
  private currentExercise = 'squat';
  private llmBusy = false;

  // 健康数据
  private sessionId = '';
  private healthData: WatchHealthData | null = null;
  private lastHeartRateWarning = 0;

  constructor(ws: WebSocket, config?: Partial<SessionConfig>) {
    this.ws = ws;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.ttsQueue.setHandler(async (text, _priority) => {
      await this.synthAndSend(text);
    });

    this.startTimers();
  }

  /** 绑定 session，加载健康档案 */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
    this.healthData = getHealth(sessionId);
  }

  // ═══ 公开输入方法 ═══════════════════════════════

  /** 骨架观察 — 全程同步，不阻塞 */
  observePose(result: AlgorithmResult): void {
    this.lastAlgorithmResult = result;
    this.lastActivityTime = Date.now();

    // 更新质量滑动窗口
    this.recentQualityScores.push(result.quality.qualityScore);
    if (this.recentQualityScores.length > 10) {
      this.recentQualityScores.shift();
    }

    // 追踪连续 perfect
    if (result.quality.qualityScore >= 90 && result.quality.errors.length === 0) {
      this.consecutivePerfect++;
    } else if (result.quality.qualityScore < 70) {
      this.consecutivePerfect = 0;
    }

    // 更新统计
    if (result.completedRep) {
      this.sessionStats.totalReps++;
      this.sessionStats.exerciseBreakdown[result.exercise] =
        (this.sessionStats.exerciseBreakdown[result.exercise] || 0) + 1;
    }

    // 更新情绪
    this.personality.updateMood({
      consecutivePerfect: this.consecutivePerfect,
      isMilestone: result.completedRep && MILESTONE_REPS.has(result.repCount),
      isDanger: result.quality.qualityScore < 30,
      isIdle: false,
      qualityScore: result.quality.qualityScore,
    });

    // 决策 → 同步发话术（模板路径，不调 LLM）
    const decision = this.shouldSpeak(result);
    if (decision.should) {
      this.emitCoaching(result, decision);
    }
  }

  /** 语音输入 — 短命令同步回复，闲聊异步追 LLM */
  async hearVoice(text: string): Promise<void> {
    this.lastActivityTime = Date.now();
    const intent = parseVoiceCommand(text);

    // 短命令 → 模板秒回
    if (intent.action !== 'chat') {
      const quickReply = getVoiceCommandReply(intent, {
        exercise: this.currentExercise,
        repCount: this.lastAlgorithmResult?.repCount ?? 0,
        stage: this.lastAlgorithmResult?.stage ?? 'neutral',
      });
      if (quickReply) {
        this.addToHistory('user', text);
        this.addToHistory('coach', quickReply);
        this.lastCoachMessage = quickReply;
        this.personality.consumeMessage();
        this.send({ type: 'voice_reply', payload: { text: quickReply, audioUrl: null } });
        this.ttsQueue.enqueue(quickReply, 'medium');
      }
      return;
    }

    // 闲聊/复杂问题 → 异步追 LLM（不阻塞返回值）
    this.addToHistory('user', text);
    this.fireLLMReply(text);
  }

  /** 定时器触发 */
  onTimer(type: 'idle' | 'periodic'): void {
    if (type === 'idle') {
      this.personality.updateMood({
        consecutivePerfect: 0, isMilestone: false, isDanger: false,
        isIdle: true, qualityScore: 100,
      });
      const text = generateIdleCoaching();
      if (!text) return;
      const prefixed = this.personality.getMoodPrefix() + text;
      this.addToHistory('coach', prefixed);
      this.lastCoachMessage = prefixed;
      this.personality.consumeMessage();
      this.send({
        type: 'coaching_feedback',
        payload: {
          exercise: this.currentExercise, repCount: this.lastAlgorithmResult?.repCount ?? 0,
          stage: 'neutral', quality: 'good' as const, effect: null,
          tips: [prefixed], encouragement: prefixed,
        },
      });
      this.ttsQueue.enqueue(prefixed, 'low');
    }

    if (type === 'periodic' && !this.llmBusy) {
      this.fireDeepCoach();
    }
  }

  setExercise(exercise: string): void {
    this.currentExercise = exercise;
  }

  getRepCount(): number {
    return this.lastAlgorithmResult?.repCount ?? 0;
  }

  getStats(): SessionStats {
    return { ...this.sessionStats };
  }

  destroy(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.ttsQueue.clear();
  }

  // ═══ 定时器 ═══════════════════════════════════

  private startTimers(): void {
    // 空闲检测：每 5 秒检查
    this.idleTimer = setInterval(() => {
      if (this.ws.readyState !== this.ws.OPEN) {
        if (this.idleTimer) clearInterval(this.idleTimer);
        return;
      }
      const idle = Date.now() - this.lastActivityTime;
      // 刚超过阈值的第一个周期触发
      if (idle > this.config.idleThresholdMs && idle < this.config.idleThresholdMs + 5000) {
        this.onTimer('idle');
      }
      // 深度点评
      if (idle < this.config.idleThresholdMs && Date.now() - this.lastActivityTime > this.config.deepCoachIntervalMs) {
        // 这个判断不够精确，用独立的 deep coach 跟踪
      }
    }, 5000);
  }

  // ═══ 决策引擎 ═══════════════════════════════

  private shouldSpeak(result: AlgorithmResult): SpeechDecision {
    const now = Date.now();
    const no: SpeechDecision = {
      should: false, urgency: 'low', trigger: 'pose_rep', useLLM: false, fallbackText: '',
    };

    // 1. 危险动作 → 无视冷却，立即打断
    if (result.quality.qualityScore < 30) {
      const fb = generateQuickCoaching(result.exercise, result.stage, 'error', result.repCount);
      return { should: true, urgency: 'high', trigger: 'pose_quality_drop', useLLM: false, fallbackText: fb.text };
    }

    // 1.5. 心率超标 → 安全警告（5分钟内不重复）
    if (this.healthData?.heartRate && this.healthData.profile?.age) {
      const safety = assessHeartRate(this.healthData.heartRate, this.healthData.profile.age);
      if (safety.status === 'stop' && now - this.lastHeartRateWarning > 300_000) {
        this.lastHeartRateWarning = now;
        return {
          should: true, urgency: 'high', trigger: 'pose_rep', useLLM: false,
          fallbackText: `心率${this.healthData.heartRate}了！快停下来休息，别硬撑！`,
        };
      }
      if (safety.status === 'reduce_intensity' && now - this.lastHeartRateWarning > 120_000) {
        this.lastHeartRateWarning = now;
        return {
          should: true, urgency: 'high', trigger: 'pose_rep', useLLM: false,
          fallbackText: '心率有点高，放慢节奏，别太拼！',
        };
      }
    }

    // 2. 冷却检查
    if (now - this.lastSpeechTime < this.config.speechCooldownMs) {
      return no;
    }

    // 3. 质量骤降
    if (this.recentQualityScores.length >= 2) {
      const prev = this.recentQualityScores[this.recentQualityScores.length - 2];
      if (prev - result.quality.qualityScore > 30) {
        const fb = generateQuickCoaching(result.exercise, result.stage, 'warning', result.repCount);
        return { should: true, urgency: 'high', trigger: 'pose_quality_drop', useLLM: false, fallbackText: fb.text };
      }
    }

    // 4. 里程碑
    if (result.completedRep && MILESTONE_REPS.has(result.repCount)) {
      const fb = generateQuickCoaching(result.exercise, result.stage, 'perfect', result.repCount);
      return { should: true, urgency: 'medium', trigger: 'pose_milestone', useLLM: false, fallbackText: fb.text };
    }

    // 5. 完成一次 → 30% 概率鼓励
    if (result.completedRep && Math.random() < 0.3) {
      const q = result.quality.qualityScore >= 90 ? 'perfect' as const
        : result.quality.qualityScore >= 75 ? 'good' as const
        : result.quality.qualityScore >= 50 ? 'adjust' as const
        : 'warning' as const;
      const fb = generateQuickCoaching(result.exercise, result.stage, q, result.repCount);
      return { should: true, urgency: 'medium', trigger: 'pose_rep', useLLM: false, fallbackText: fb.text };
    }

    return no;
  }

  /** 发出教练话术（模板 + 情绪前缀 + TTS） */
  private emitCoaching(result: AlgorithmResult, decision: SpeechDecision): void {
    this.lastSpeechTime = Date.now();
    const prefix = this.personality.getMoodPrefix();
    const text = prefix ? prefix + decision.fallbackText : decision.fallbackText;
    if (!text) return;

    this.addToHistory('coach', text);
    this.lastCoachMessage = text;
    this.personality.consumeMessage();

    const qualityLevel = result.quality.qualityScore >= 85 ? 'good' as const
      : result.quality.qualityScore >= 60 ? 'warning' as const : 'error' as const;

    this.send({
      type: 'coaching_feedback',
      payload: {
        exercise: result.exercise, repCount: result.repCount,
        stage: result.stage, quality: qualityLevel, effect: result.effect,
        tips: [text], encouragement: text,
      },
    });

    this.ttsQueue.enqueue(text, decision.urgency);
  }

  // ═══ LLM 编排（异步，不阻塞主循环） ═════════

  /** 闲聊 LLM 回复 — fire and forget */
  private fireLLMReply(userText: string): void {
    if (this.llmBusy) return; // 上一轮 LLM 还在跑
    this.llmBusy = true;

    const fallbackText = '嗯嗯，继续练！';

    this.askLLM(userText)
      .then(result => {
        this.addToHistory('coach', result);
        this.lastCoachMessage = result;
        this.personality.consumeMessage();
        this.send({ type: 'voice_reply', payload: { text: result, audioUrl: null } });
        this.ttsQueue.enqueue(result, 'medium');
      })
      .catch(() => {
        // fallback already silent, but ensure coach says something
        this.addToHistory('coach', fallbackText);
        this.send({ type: 'voice_reply', payload: { text: fallbackText, audioUrl: null } });
      })
      .finally(() => { this.llmBusy = false; });
  }

  /** 深度点评 — fire and forget */
  private fireDeepCoach(): void {
    if (this.llmBusy) return;
    this.llmBusy = true;

    const result = this.lastAlgorithmResult;
    if (!result) { this.llmBusy = false; return; }

    const prompt = [
      `你是豆包教练，用户已经练了一会儿了。给一段15字以内的深度点评。`,
      `运动：${getExerciseName(result.exercise)}，完成：${result.repCount}次，质量：${result.quality.qualityScore}分`,
      `情绪：${this.personality.currentMood}`,
      `刚才说了：${this.lastCoachMessage || '无'}（别重复）`,
    ].join(' ');

    this.askLLM(prompt)
      .then(text => {
        this.addToHistory('coach', text);
        this.lastCoachMessage = text;
        this.personality.consumeMessage();
        this.send({
          type: 'coaching_feedback',
          payload: {
            exercise: result.exercise, repCount: result.repCount,
            stage: result.stage,
            quality: result.quality.qualityScore >= 85 ? 'good' as const
              : result.quality.qualityScore >= 60 ? 'warning' as const : 'error' as const,
            effect: result.effect, tips: [text], encouragement: text,
          },
        });
        this.ttsQueue.enqueue(text, 'low');
      })
      .catch(() => {})
      .finally(() => { this.llmBusy = false; });
  }

  private async askLLM(userText: string): Promise<string> {
    const fallbackText = this.lastCoachMessage || '继续加油！';

    try {
      return await this.circuitBreaker.call(async () => {
        const client = this.getLLMClient();
        const messages = this.buildLLMContext(userText);

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('LLM timeout')), this.config.llmTimeoutMs),
        );

        const llmPromise = client.invoke(messages, {
          model: 'doubao-seed-2-0-mini-260215',
          temperature: 0.7,
          thinking: 'disabled',
        });

        const response = await Promise.race([llmPromise, timeoutPromise]);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = (response as any).content?.trim();
        return content || fallbackText;
      });
    } catch {
      return fallbackText;
    }
  }

  private buildLLMContext(userText: string) {
    const result = this.lastAlgorithmResult;
    const exerciseName = getExerciseName(this.currentExercise);

    const systemPrompt = buildSystemPrompt({
      mood: this.personality.currentMood,
      exerciseName,
      repCount: result?.repCount ?? 0,
      qualityScore: result?.quality.qualityScore ?? 100,
      lastCoachMessage: this.lastCoachMessage,
    });

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // 骨架数据（多模态理解用）
    if (result) {
      messages.push({
        role: 'system',
        content: `[当前运动数据] ${result.algorithmContext}`,
      });
    }

    // 健康数据（心率、睡眠等）
    if (this.healthData) {
      const h = this.healthData;
      const parts: string[] = [];
      if (h.profile) {
        parts.push(`运动水平: ${h.profile.fitnessLevel}, 目标: ${h.profile.goal}`);
      }
      if (h.heartRate) {
        const safety = h.profile?.age ? assessHeartRate(h.heartRate, h.profile.age) : null;
        parts.push(`心率: ${h.heartRate}bpm${safety ? ` (${safety.status})` : ''}`);
      }
      if (h.sleepQuality) {
        parts.push(`睡眠: ${h.sleepQuality}${h.sleepHours ? ` (${h.sleepHours}h)` : ''} - ${sleepAdvice(h.sleepQuality)}`);
      }
      if (parts.length > 0) {
        messages.push({
          role: 'system',
          content: `[用户健康数据] ${parts.join('; ')}`,
        });
      }
    }

    // 最近对话历史（coach → assistant，LLM API 标准角色）
    const recentHistory = this.history
      .filter(m => m.role !== 'system')
      .slice(-this.config.maxHistoryLength);
    for (const m of recentHistory) {
      const role = m.role === 'coach' ? 'assistant' as const : m.role as 'user' | 'system';
      messages.push({ role, content: m.content });
    }

    messages.push({ role: 'user', content: userText });
    return messages;
  }

  // ═══ TTS ═════════════════════════════════════

  private async synthAndSend(text: string): Promise<void> {
    try {
      const client = this.getTTSClient();
      const result = await client.synthesize({
        uid: 'coach-session',
        text,
        speaker: 'zh_female_xiaohe_uranus_bigtts',
      });
      if (result.audioUri) {
        this.send({
          type: 'tts_ready',
          payload: { audioUrl: result.audioUri, text },
        });
      }
    } catch (err) {
      console.error('[CoachSession] TTS failed:', err);
    }
  }

  // ═══ 辅助 ═══════════════════════════════════

  private addToHistory(role: 'user' | 'coach' | 'system', content: string): void {
    this.history.push({ role, content, timestamp: Date.now() });
    if (this.history.length > this.config.maxHistoryLength * 2) {
      this.history = this.history.slice(-this.config.maxHistoryLength);
    }
  }

  private send(msg: WsMessage): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private getLLMClient(): LLMClient {
    if (!this.llmClient) {
      this.llmClient = new LLMClient(new Config());
    }
    return this.llmClient;
  }

  private getTTSClient(): TTSClient {
    if (!this.ttsClient) {
      this.ttsClient = new TTSClient(new Config());
    }
    return this.ttsClient;
  }
}
