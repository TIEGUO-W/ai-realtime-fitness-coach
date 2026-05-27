# CoachAgent Harness 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 CoachSession 状态化教练智能体，统一管理对话记忆、TTS调度、LLM熔断降级、情绪状态机

**Architecture:** 新增 3 个独立工具文件 (CircuitBreaker / TTSQueue / CoachPersonality) + 1 个核心文件 (CoachSession)，修改 coaching.ts 将散落的 TTS/LLM/状态管理委托给 CoachSession。不动 pose-algorithm 和 coaching-templates

**Tech Stack:** TypeScript 5 + ws + coze-coding-dev-sdk (LLMClient/TTSClient/ASRClient) + Next.js 16

---

## 文件结构

```
src/ws-handlers/
├── circuit-breaker.ts     # NEW  独立工具：LLM熔断器
├── tts-queue.ts           # NEW  独立工具：TTS优先级队列
├── coach-personality.ts   # NEW  System prompt + 情绪状态机 + 话术前缀
├── coach-session.ts       # NEW  核心：状态管理 + 决策 + LLM编排 + 降级
├── coaching.ts            # MOD  删除散落状态，委托给 CoachSession
├── coaching-templates.ts  # KEEP 作为 LLM 降级时的 fallback 话术源
├── coaching-engine.ts     # KEEP 旧 generateCoaching，不再主用
├── pose-algorithm.ts      # KEEP 无变更
└── voice-command.ts       # KEEP 短命令快速匹配，长文本交给 CoachSession
```

---

### Task 1: CircuitBreaker 工具

**Files:**
- Create: `src/ws-handlers/circuit-breaker.ts`

- [ ] **Step 1: 创建熔断器类**

```typescript
// src/ws-handlers/circuit-breaker.ts

type CircuitState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private readonly threshold: number;
  private readonly resetTimeoutMs: number;

  constructor(opts?: { threshold?: number; resetTimeoutMs?: number }) {
    this.threshold = opts?.threshold ?? 3;
    this.resetTimeoutMs = opts?.resetTimeoutMs ?? 30_000;
  }

  get isOpen(): boolean {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
        this.state = 'half_open';
        return false;
      }
      return true;
    }
    return false;
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen) {
      throw new CircuitOpenError();
    }

    try {
      const result = await fn();
      if (this.state === 'half_open') {
        this.state = 'closed';
        this.failureCount = 0;
      }
      return result;
    } catch (err) {
      this.failureCount++;
      if (this.failureCount >= this.threshold) {
        this.state = 'open';
        this.lastFailureTime = Date.now();
      }
      throw err;
    }
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
  }
}

export class CircuitOpenError extends Error {
  constructor() {
    super('Circuit breaker is open');
    this.name = 'CircuitOpenError';
  }
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd /d/claude-workspace/ai-fitness-coach && npx tsx --eval "import { CircuitBreaker } from './src/ws-handlers/circuit-breaker'; console.log('CircuitBreaker loaded OK')" 2>&1`
Expected: `CircuitBreaker loaded OK`

- [ ] **Step 3: Commit**

```bash
git add src/ws-handlers/circuit-breaker.ts
git commit -m "feat: add CircuitBreaker utility for LLM fault tolerance"
```

---

### Task 2: TTSQueue 工具

**Files:**
- Create: `src/ws-handlers/tts-queue.ts`

- [ ] **Step 1: 创建 TTS 优先级队列**

```typescript
// src/ws-handlers/tts-queue.ts

export type TtsPriority = 'high' | 'medium' | 'low';

interface TtsItem {
  id: number;
  text: string;
  priority: TtsPriority;
  timestamp: number;
}

export class TTSQueue {
  private queue: TtsItem[] = [];
  private isSpeaking = false;
  private nextId = 0;
  private readonly maxSize: number;
  private readonly dedupWindowMs: number;
  private onSpeak: ((text: string, priority: TtsPriority) => Promise<void>) | null = null;

  constructor(opts?: { maxSize?: number; dedupWindowMs?: number }) {
    this.maxSize = opts?.maxSize ?? 5;
    this.dedupWindowMs = opts?.dedupWindowMs ?? 5_000;
  }

  setHandler(fn: (text: string, priority: TtsPriority) => Promise<void>): void {
    this.onSpeak = fn;
  }

  enqueue(text: string, priority: TtsPriority): void {
    if (!text) return;

    // HIGH priority: clear all + stop current
    if (priority === 'high') {
      this.queue = [];
      this.isSpeaking = false;
      this.speakNow(text, priority);
      return;
    }

    // Dedup: same text within window
    const now = Date.now();
    const dup = this.queue.find(
      item => item.text === text && now - item.timestamp < this.dedupWindowMs
    );
    if (dup) return;

    // LOW priority: drop oldest LOW if at capacity
    if (priority === 'low' && this.queue.length >= this.maxSize) {
      const oldestLowIdx = this.queue.findIndex(item => item.priority === 'low');
      if (oldestLowIdx !== -1) {
        this.queue.splice(oldestLowIdx, 1);
      } else {
        return; // queue full of higher priority, drop this one
      }
    }

    // Also enforce absolute max
    if (this.queue.length >= this.maxSize * 2) return;

    this.queue.push({ id: this.nextId++, text, priority, timestamp: now });
    this.flush();
  }

  private speakNow(text: string, priority: TtsPriority): void {
    this.isSpeaking = true;
    Promise.resolve(this.onSpeak?.(text, priority))
      .catch(() => {})
      .finally(() => {
        this.isSpeaking = false;
        this.flush();
      });
  }

  private flush(): void {
    if (this.isSpeaking || this.queue.length === 0) return;
    const item = this.queue.shift()!;
    this.speakNow(item.text, item.priority);
  }

  clear(): void {
    this.queue = [];
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /d/claude-workspace/ai-fitness-coach && npx tsx --eval "import { TTSQueue } from './src/ws-handlers/tts-queue'; console.log('TTSQueue loaded OK')" 2>&1`
Expected: `TTSQueue loaded OK`

- [ ] **Step 3: Commit**

```bash
git add src/ws-handlers/tts-queue.ts
git commit -m "feat: add TTSQueue with priority dedup and throttling"
```

---

### Task 3: CoachPersonality — 人设 + 情绪

**Files:**
- Create: `src/ws-handlers/coach-personality.ts`

- [ ] **Step 1: 创建人格和情绪模块**

```typescript
// src/ws-handlers/coach-personality.ts

export type Mood = 'excited' | 'neutral' | 'disappointed' | 'serious';

interface MoodState {
  current: Mood;
  since: number;
  sameMoodMessageCount: number;
}

export class CoachPersonality {
  private mood: MoodState = { current: 'neutral', since: Date.now(), sameMoodMessageCount: 0 };

  get currentMood(): Mood {
    return this.mood.current;
  }

  /**
   * 根据运动表现更新情绪。
   * 规则：
   * - 连续3次perfect/里程碑 → excited
   * - 危险动作 → 强制 serious
   * - 10秒不动/质量<40 → disappointed（最多维持2句话）
   * - 否则回归 neutral
   */
  updateMood(inputs: {
    consecutivePerfect: number;
    isMilestone: boolean;
    isDanger: boolean;
    isIdle: boolean;
    qualityScore: number;
  }): Mood {
    if (inputs.isDanger) {
      this.setMood('serious');
      return this.mood.current;
    }

    if (inputs.consecutivePerfect >= 3 || inputs.isMilestone) {
      this.setMood('excited');
      return this.mood.current;
    }

    if (inputs.isIdle || inputs.qualityScore < 40) {
      // disappointed 最多维持 2 条消息
      if (this.mood.current === 'disappointed' && this.mood.sameMoodMessageCount >= 2) {
        this.setMood('neutral');
      } else {
        this.setMood('disappointed');
      }
      return this.mood.current;
    }

    this.setMood('neutral');
    return this.mood.current;
  }

  /** 消费一条消息，如果是非 neutral 情绪，计数+1（用于限制 disappointed 条数） */
  consumeMessage(): void {
    if (this.mood.current !== 'neutral') {
      this.mood.sameMoodMessageCount++;
    }
  }

  private setMood(mood: Mood): void {
    if (this.mood.current === mood) {
      this.mood.sameMoodMessageCount++;
    } else {
      this.mood = { current: mood, since: Date.now(), sameMoodMessageCount: 1 };
    }
  }

  /** 根据情绪返回话术前缀（给模板用，丰富表现力） */
  getMoodPrefix(): string {
    const prefixes: Record<Mood, string[]> = {
      excited: ['来劲了！', '就是这感觉！', '太帅了铁子！', '🔥 '],
      neutral: ['', '', '', ''],
      disappointed: ['啧，', '就这？', '别摸鱼啊，', '🙄 '],
      serious: ['停！', '注意！', '⚠️ ', ''],
    };
    const opts = prefixes[this.mood.current];
    return opts[Math.floor(Math.random() * opts.length)];
  }
}

/** 教练 System Prompt 模板 */
export function buildSystemPrompt(params: {
  mood: Mood;
  exerciseName: string;
  repCount: number;
  qualityScore: number;
  lastCoachMessage: string;
}): string {
  const moodDescriptions: Record<Mood, string> = {
    excited: '你现在很兴奋，用户状态特别好，多用夸张的比喻夸人',
    neutral: '正常教练模式，偶尔说句骚话调节气氛',
    disappointed: '用户偷懒或者动作差，用嫌弃但关心的语气催促',
    serious: '用户动作有受伤风险，必须严厉警告，不能用开玩笑的语气',
  };

  return `你是豆包，一个在东北澡堂长大的健身教练。你见过太多人办了卡就不来了，所以你特别珍惜每一个真正在练的人——虽然嘴上不饶人。

你的风格：
- 毒舌但不人身攻击（说动作不说人）
- 用东北歇后语和网络梗（'这动作比我的基金还绿'）
- 夸人要具体（'这膝盖角度，比量角器还准'）
- 骂人要带关心（'腰要断了铁子！歇会儿，不丢人'）
- 记住用户之前的表现（'比上组强多了'）
- 回复必须30字以内，简短有力
- 别重复刚说过的话

当前情绪：${moodDescriptions[params.mood]}
当前运动：${params.exerciseName}
已完成：${params.repCount} 次
动作质量：${params.qualityScore} 分
刚才说了：${params.lastCoachMessage || '（还没说过话）'}

请用教练身份回复用户。如果用户不是在跟你聊天，而是在问运动相关的问题，结合他的运动数据回答。`;
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /d/claude-workspace/ai-fitness-coach && npx tsx --eval "import { CoachPersonality, buildSystemPrompt } from './src/ws-handlers/coach-personality'; console.log('CoachPersonality loaded OK')" 2>&1`
Expected: `CoachPersonality loaded OK`

- [ ] **Step 3: Commit**

```bash
git add src/ws-handlers/coach-personality.ts
git commit -m "feat: add CoachPersonality with mood state machine and system prompt"
```

---

### Task 4: CoachSession 核心 — 状态与记忆

**Files:**
- Create: `src/ws-handlers/coach-session.ts`

- [ ] **Step 1: 创建 CoachSession 类骨架 + 类型定义 + 记忆系统**

```typescript
// src/ws-handlers/coach-session.ts

import type { WebSocket } from 'ws';
import type { AlgorithmResult } from './pose-algorithm';
import type { WsMessage } from '../lib/ws-client';
import { CircuitBreaker } from './circuit-breaker';
import { TTSQueue, type TtsPriority } from './tts-queue';
import { CoachPersonality, buildSystemPrompt, type Mood } from './coach-personality';
import { generateQuickCoaching, generateIdleCoaching, getExerciseName } from './coaching-templates';
import { parseVoiceCommand, getVoiceCommandReply } from './voice-command';
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

  // SDK clients (lazy)
  private llmClient: LLMClient | null = null;
  private ttsClient: TTSClient | null = null;

  // 定时器
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private deepCoachTimer: ReturnType<typeof setInterval> | null = null;
  private lastDeepCoachTime = Date.now();
  private currentExercise = 'squat';

  constructor(ws: WebSocket, config?: Partial<SessionConfig>) {
    this.ws = ws;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.ttsQueue.setHandler(async (text, priority) => {
      await this.synthAndSend(text, priority);
    });

    this.startTimers();
  }

  // ── 公开输入方法 ──

  observePose(result: AlgorithmResult): void {
    this.lastAlgorithmResult = result;
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
      isMilestone: [5, 10, 15, 20, 30, 50].includes(result.repCount) && result.completedRep,
      isDanger: result.quality.qualityScore < 30,
      isIdle: false,
      qualityScore: result.quality.qualityScore,
    });

    // 判断要不要插话
    const decision = this.shouldSpeak(result);
    if (decision.should) {
      this.handlePoseTrigger(result, decision);
    }
  }

  async hearVoice(text: string): Promise<void> {
    // 先走快速命令匹配
    const intent = parseVoiceCommand(text);
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
        return;
      }
      // 控制类命令直接执行，不需要说话
      if (['start', 'pause', 'stop', 'reset'].includes(intent.action)) {
        return;
      }
    }

    // 闲聊或复杂问题 → LLM
    this.addToHistory('user', text);
    const result = await this.askLLM(text);
    if (result) {
      this.addToHistory('coach', result);
      this.lastCoachMessage = result;
      this.personality.consumeMessage();
      this.send({ type: 'voice_reply', payload: { text: result, audioUrl: null } });
      this.ttsQueue.enqueue(result, 'medium');
    }
  }

  onTimer(type: 'idle' | 'periodic'): void {
    if (type === 'idle') {
      const text = generateIdleCoaching();
      this.addToHistory('coach', text);
      this.lastCoachMessage = text;
      this.send({
        type: 'coaching_feedback',
        payload: {
          exercise: this.currentExercise,
          repCount: this.lastAlgorithmResult?.repCount ?? 0,
          stage: 'neutral',
          quality: 'good' as const,
          effect: null,
          tips: [text],
          encouragement: text,
        },
      });
      this.ttsQueue.enqueue(text, 'low');
    }
  }

  setExercise(exercise: string): void {
    this.currentExercise = exercise;
  }

  getRepCount(): number {
    return this.lastAlgorithmResult?.repCount ?? 0;
  }

  destroy(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.deepCoachTimer) clearInterval(this.deepCoachTimer);
    this.ttsQueue.clear();
  }

  // ── 定时器 ──

  private startTimers(): void {
    let lastActivityTime = Date.now();

    this.idleTimer = setInterval(() => {
      const idle = Date.now() - lastActivityTime;
      if (idle > this.config.idleThresholdMs && idle < this.config.idleThresholdMs + 2000) {
        this.onTimer('idle');
      }
    }, 5000);

    this.deepCoachTimer = setInterval(() => {
      if (Date.now() - this.lastDeepCoachTime >= this.config.deepCoachIntervalMs) {
        this.lastDeepCoachTime = Date.now();
        this.onTimer('periodic');
      }
    }, 10_000);
  }

  // ── 决策引擎 ──

  private shouldSpeak(result: AlgorithmResult): SpeechDecision {
    const now = Date.now();
    const defaultDecision: SpeechDecision = {
      should: false, urgency: 'low', trigger: 'pose_rep', useLLM: false, fallbackText: '',
    };

    // 1. 危险动作 → 立即打断（不走冷却）
    if (result.quality.qualityScore < 30) {
      const fb = generateQuickCoaching(
        result.exercise, result.stage, 'error', result.repCount,
      );
      return { should: true, urgency: 'high', trigger: 'pose_quality_drop', useLLM: false, fallbackText: fb.text };
    }

    // 2. 冷却检查
    if (now - this.lastSpeechTime < this.config.speechCooldownMs) {
      return defaultDecision;
    }

    // 3. 严重质量下降
    if (this.recentQualityScores.length >= 2) {
      const prev = this.recentQualityScores[this.recentQualityScores.length - 2];
      if (prev - result.quality.qualityScore > 30) {
        const fb = generateQuickCoaching(
          result.exercise, result.stage, 'warning', result.repCount,
        );
        return { should: true, urgency: 'high', trigger: 'pose_quality_drop', useLLM: false, fallbackText: fb.text };
      }
    }

    // 4. 里程碑
    const milestones = [5, 10, 15, 20, 30, 50];
    if (result.completedRep && milestones.includes(result.repCount)) {
      const fb = generateQuickCoaching(
        result.exercise, result.stage, 'perfect', result.repCount,
      );
      return { should: true, urgency: 'medium', trigger: 'pose_milestone', useLLM: false, fallbackText: fb.text };
    }

    // 5. 完成一次动作 → 30% 概率
    if (result.completedRep && Math.random() < 0.3) {
      const qualityLevel = result.quality.qualityScore >= 90 ? 'perfect' as const
        : result.quality.qualityScore >= 75 ? 'good' as const
        : result.quality.qualityScore >= 50 ? 'adjust' as const
        : result.quality.qualityScore >= 30 ? 'warning' as const : 'error' as const;
      const fb = generateQuickCoaching(
        result.exercise, result.stage, qualityLevel, result.repCount,
      );
      return { should: true, urgency: 'medium', trigger: 'pose_rep', useLLM: false, fallbackText: fb.text };
    }

    return defaultDecision;
  }

  private handlePoseTrigger(result: AlgorithmResult, decision: SpeechDecision): void {
    this.lastSpeechTime = Date.now();

    // 模板话术追加情绪前缀
    const prefix = this.personality.getMoodPrefix();
    const text = prefix ? prefix + decision.fallbackText : decision.fallbackText;
    const finalText = text || decision.fallbackText;

    if (!finalText) return;

    this.addToHistory('coach', finalText);
    this.lastCoachMessage = finalText;
    this.personality.consumeMessage();

    this.send({
      type: 'coaching_feedback',
      payload: {
        exercise: result.exercise,
        repCount: result.repCount,
        stage: result.stage,
        quality: result.quality.qualityScore >= 85 ? 'good' as const
          : result.quality.qualityScore >= 60 ? 'warning' as const : 'error' as const,
        effect: result.effect,
        tips: [finalText],
        encouragement: finalText,
      },
    });

    this.ttsQueue.enqueue(finalText, decision.urgency);
  }

  // ── LLM 编排 ──

  private async askLLM(userText: string): Promise<string | null> {
    // 准备 fallback
    const fb = generateQuickCoaching(
      this.currentExercise, 'neutral', 'good', this.lastAlgorithmResult?.repCount ?? 0,
    );
    const fallbackText = fb.text || '嗯嗯，继续练！';

    try {
      const result = await this.circuitBreaker.call(async () => {
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
        return (response as any).content?.trim() || fallbackText;
      });

      return result;
    } catch {
      // 熔断开路或超时 → fallback
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

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    // 骨架摘要作为 context
    if (result) {
      messages.push({
        role: 'system',
        content: `[当前运动数据] ${result.algorithmContext}`,
      });
    }

    // 历史对话（最近 N 条，排除 system）
    const recentHistory = this.history
      .filter(m => m.role !== 'system')
      .slice(-this.config.maxHistoryLength);
    for (const m of recentHistory) {
      messages.push({ role: m.role, content: m.content });
    }

    // 当前用户输入
    messages.push({ role: 'user', content: userText });

    return messages;
  }

  // ── TTS ──

  private async synthAndSend(text: string, priority: TtsPriority): Promise<void> {
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

  // ── 辅助 ──

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
```

- [ ] **Step 2: 验证编译**

Run: `cd /d/claude-workspace/ai-fitness-coach && npx tsx --eval "import { CoachSession } from './src/ws-handlers/coach-session'; console.log('CoachSession loaded OK')" 2>&1`
Expected: `CoachSession loaded OK`

- [ ] **Step 3: Commit**

```bash
git add src/ws-handlers/coach-session.ts
git commit -m "feat: add CoachSession with state, memory, decision engine, and LLM orchestration"
```

---

### Task 5: 改造 coaching.ts — 接入 CoachSession

**Files:**
- Modify: `src/ws-handlers/coaching.ts`

- [ ] **Step 1: 重写 coaching.ts — 用 CoachSession 替代散落逻辑**

保留的部分：
- `ALGORITHM_INTERVAL_MS` 常量
- 骨架帧接收 → 规则算法分析 → 推送 algorithm_update / rep_completed
- 语音命令接收 → ASR 识别 → 委托给 CoachSession
- WebSocket 生命周期管理

删除的部分：
- 散落的 TTS/LLM 状态变量
- `synthQuick()` / `askDoubaoDeepCoach()` / `askLegacyCoach()` / `askDoubaoChat()`
- 空闲检测定时器（移入 CoachSession）
- COACH_MODE / DOUBAO_COACH_URL 相关逻辑

```typescript
// src/ws-handlers/coaching.ts

import type { WebSocket } from 'ws';
import type { WsMessage, PoseFrame } from '../lib/ws-client';
import { PoseAlgorithmEngine } from './pose-algorithm';
import { CoachSession } from './coach-session';
import { parseVoiceCommand } from './voice-command';
import { ASRClient, Config } from 'coze-coding-dev-sdk';

const ALGORITHM_INTERVAL_MS = 100; // 算法推送 ~10fps

let asrClient: ASRClient | null = null;
function getASRClient(): ASRClient {
  if (!asrClient) {
    asrClient = new ASRClient(new Config());
  }
  return asrClient;
}

export function handleCoachingConnection(ws: WebSocket): void {
  const algorithm = new PoseAlgorithmEngine();
  const session = new CoachSession(ws);
  let currentExercise = 'squat';
  let lastAlgorithmPush = 0;
  let prevRepCount = 0;

  ws.on('message', async (raw: Buffer) => {
    let msg: WsMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', payload: null }));
      return;
    }

    // 切换运动
    if (msg.type === 'set_exercise') {
      const raw = (msg.payload as { exercise: string }).exercise || 'squat';
      const supported = ['squat', 'push_up', 'plank', 'lunge', 'jumping_jack', 'high_knees', 'sit_up'];
      currentExercise = supported.includes(raw) ? raw : 'squat';
      session.setExercise(currentExercise);
      algorithm.reset();
      prevRepCount = 0;
      return;
    }

    // 语音命令
    if (msg.type === 'voice_command') {
      const payload = msg.payload as { base64Data?: string; text?: string };
      try {
        let recognizedText = payload.text || '';
        if (payload.base64Data && !recognizedText) {
          const asr = getASRClient();
          const asrResult = await asr.recognize({
            uid: 'pose-coach-user',
            base64Data: payload.base64Data,
          });
          recognizedText = asrResult.text;
        }

        if (!recognizedText) {
          ws.send(JSON.stringify({ type: 'voice_reply', payload: { text: '没听清，再说一遍？', audioUrl: null } }));
          return;
        }

        // 通知前端识别结果
        ws.send(JSON.stringify({ type: 'voice_recognized', payload: { text: recognizedText } }));

        // 控制类命令：本地执行
        const intent = parseVoiceCommand(recognizedText);
        if (intent.action === 'switch_exercise') {
          currentExercise = intent.exercise;
          session.setExercise(intent.exercise);
          algorithm.reset();
          prevRepCount = 0;
          ws.send(JSON.stringify({ type: 'set_exercise', payload: { exercise: intent.exercise } }));
        } else if (intent.action === 'reset') {
          algorithm.reset();
          prevRepCount = 0;
        }

        // 所有语音都交给 CoachSession 处理回复
        await session.hearVoice(recognizedText);
      } catch (err) {
        console.error('[coaching] voice error:', err);
        ws.send(JSON.stringify({ type: 'voice_reply', payload: { text: '出了点问题，再试一次？', audioUrl: null } }));
      }
      return;
    }

    // 骨架帧
    if (msg.type === 'pose_frame') {
      const frame = msg.payload as PoseFrame;
      if (!frame.landmarks || frame.landmarks.length < 28) return;

      const result = algorithm.analyze(frame.landmarks, currentExercise);
      const now = Date.now();

      // 算法推送（~10fps）
      if (now - lastAlgorithmPush >= ALGORITHM_INTERVAL_MS) {
        lastAlgorithmPush = now;
        safeSend(ws, {
          type: 'algorithm_update',
          payload: {
            exercise: result.exercise,
            stage: result.stage,
            repCount: result.repCount,
            quality: result.quality.qualityScore >= 85 ? 'good' as const
              : result.quality.qualityScore >= 60 ? 'warning' as const : 'error' as const,
            qualityScore: result.quality.qualityScore,
            effect: result.effect,
            kneeAngle: result.angles.kneeAngle,
            hipAngle: result.angles.hipAngle,
            errors: result.quality.errors,
            warnings: result.quality.warnings,
          },
        });
      }

      // 完成一次 → 推送特效
      if (result.completedRep) {
        safeSend(ws, {
          type: 'rep_completed',
          payload: { repCount: result.repCount, effect: result.effect, quality: result.quality.qualityScore },
        });
      }

      // 委托给 CoachSession（智能插话决策）
      session.observePose(result);
      prevRepCount = result.repCount;
      return;
    }

    // 批量骨架帧（HTTP API 兼容）
    if (msg.type === 'pose_batch') {
      const batch = msg.payload as { frames: PoseFrame[]; exercise?: string };
      if (batch.exercise) {
        currentExercise = batch.exercise;
        session.setExercise(currentExercise);
      }
      for (const frame of batch.frames) {
        if (frame.landmarks && frame.landmarks.length >= 28) {
          const result = algorithm.analyze(frame.landmarks, currentExercise);
          session.observePose(result);
          prevRepCount = result.repCount;
        }
      }
    }
  });

  ws.on('close', () => {
    algorithm.reset();
    session.destroy();
  });
}

function safeSend(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd /d/claude-workspace/ai-fitness-coach && npx tsc --noEmit 2>&1`
Expected: No errors (or only pre-existing errors unrelated to our changes)

- [ ] **Step 3: Commit**

```bash
git add src/ws-handlers/coaching.ts
git commit -m "refactor: replace scattered TTS/LLM logic with CoachSession delegation"
```

---

### Task 6: 冒烟测试

**Files:** 无需修改

- [ ] **Step 1: 启动开发服务器**

Run: `cd /d/claude-workspace/ai-fitness-coach && pnpm dev 2>&1 &`
Wait for: `> Server listening at http://localhost:5000`

- [ ] **Step 2: 验证 WebSocket 连接**

在浏览器打开 `http://localhost:5000`，检查：
- 控制台无报错
- WS 连接状态显示绿色"云端"
- 摄像头权限正常

- [ ] **Step 3: 验证语音交互**

- 点击"语音控制"按钮 → 浏览器请求麦克风权限 → 显示"监听中"
- 说"换深蹲" → 识别文字出现 → 教练回复
- 说"做了多少个" → 返回计数

- [ ] **Step 4: 验证教练反馈**

- 点击"开始训练"
- 做几个深蹲 → 观察右侧教练面板是否显示反馈和计数
- 故意做不标准动作 → 观察是否收到纠正提醒

- [ ] **Step 5: 验证降级（可选，修改 .env 临时切断 API）**

将 LLM 配置中的 API key 改为无效值，重启服务器：
- 运动反馈应继续工作（模板降级）
- 无崩溃、无白屏

- [ ] **Step 6: Commit（如果冒烟测试中发现小修小补）**

```bash
git add -A
git commit -m "fix: smoke test adjustments for CoachSession integration"
```

---

## 验收清单

对照 Spec 逐项检查：

### 稳定可靠
- [ ] LLM 连续失败 3 次 → CircuitBreaker 自动熔断 → 用模板话术
- [ ] TTS 队列 > 5 时旧 LOW 消息被丢弃
- [ ] HIGH 优先级清空队列立即播放

### 连续对话
- [ ] 对话历史在 CoachSession.history 中累积
- [ ] LLM 调用包含最近 20 条历史消息
- [ ] `lastCoachMessage` 防止重复话术

### 智能插话
- [ ] 危险动作 → shouldSpeak 返回 should:true, urgency:high
- [ ] 完成一次动作 → 约 30% 概率鼓励
- [ ] 冷却期 (2s) 内不重复说话

### 多模态
- [ ] buildLLMContext 包含骨架 algorithmContext
- [ ] 用户问"这个动作对吗" → LLM 能看到角度/质量数据
