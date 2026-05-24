/**
 * WebSocket 浏览器端处理器 — 本地模式
 * 
 * 架构:
 * 1. 每帧 → 规则算法（毫秒级）→ 实时推送算法结果（计数/阶段/质量/特效）
 * 2. 每 5 秒 → 豆包智能体当教练（收到运动状态 → 自己出话术 + 语音，一步到位）
 * 
 * 豆包教练模式：
 *   不再让 LLM 先生成干巴巴的话术再让豆包念，
 *   而是直接把算法状态喂给豆包，让它用自己的教练人格出话术+语音
 */

import type { WebSocket } from 'ws';
import type { WsMessage, PoseFrame } from '../lib/ws-client';
import { PoseAlgorithmEngine } from './pose-algorithm';
import { generateCoaching } from './coaching-engine';
import { TTSClient, Config } from 'coze-coding-dev-sdk';

const ALGORITHM_INTERVAL_MS = 100;   // 算法推送频率 ~10fps
const COACH_INTERVAL_MS = 5000;      // 豆包教练频率 ~每5秒（豆包需要思考时间）

const DOUBAO_COACH_URL = process.env.DOUBAO_VOICE_BOT_URL || 'https://320a02f4-5fad-4816-a1a8-37c1a4a92247.dev.coze.site/run';
const COACH_MODE = process.env.COACH_MODE || 'doubao'; // 'doubao'(豆包当教练) 或 'legacy'(旧LLM+TTS模式)

// SDK TTSClient 降级备用
let ttsClient: TTSClient | null = null;
function getTTSClient(): TTSClient {
  if (!ttsClient) {
    ttsClient = new TTSClient(new Config());
  }
  return ttsClient;
}

// 运动名称映射
const EXERCISE_NAMES: Record<string, string> = {
  squat: '深蹲', deadlift: '硬拉', pushup: '俯卧撑',
  lunge: '弓步蹲', plank: '平板支撑', highknees: '高抬腿', jumpingjack: '开合跳',
};

export function handleCoachingConnection(ws: WebSocket): void {
  const algorithm = new PoseAlgorithmEngine();
  let currentExercise = 'squat';

  let lastAlgorithmPush = 0;
  let lastCoachCall = 0;
  let latestAlgorithmResult: ReturnType<PoseAlgorithmEngine['analyze']> | null = null;
  let coachBusy = false; // 防止豆包还没回复又发请求

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

    // 切换运动类型
    if (msg.type === 'set_exercise') {
      currentExercise = (msg.payload as { exercise: string }).exercise || 'squat';
      algorithm.reset();
      return;
    }

    // 单帧骨架数据
    if (msg.type === 'pose_frame') {
      const frame = msg.payload as PoseFrame;
      if (!frame.landmarks || frame.landmarks.length < 28) return;

      // 规则算法（毫秒级）
      const result = algorithm.analyze(frame.landmarks, currentExercise);
      latestAlgorithmResult = result;

      const now = Date.now();

      // 实时推送算法结果（~10fps，不等教练）
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
            effect: result.effect,
            kneeAngle: result.angles.kneeAngle,
            hipAngle: result.angles.hipAngle,
          },
        });
      }

      // 完成一次 → 立即推送特效
      if (result.completedRep) {
        safeSend(ws, {
          type: 'rep_completed',
          payload: {
            repCount: result.repCount,
            effect: result.effect,
            quality: result.quality.qualityScore,
          },
        });
      }

      // 定时调用豆包教练（~每5秒）
      if (now - lastCoachCall >= COACH_INTERVAL_MS && !coachBusy) {
        lastCoachCall = now;
        coachBusy = true;

        if (COACH_MODE === 'doubao') {
          askDoubaoCoach(ws, result).finally(() => { coachBusy = false; });
        } else {
          askLegacyCoach(ws, result).finally(() => { coachBusy = false; });
        }
      }
      return;
    }

    // 批量骨架帧（兼容 HTTP API 模式）
    if (msg.type === 'pose_batch') {
      const batch = msg.payload as { frames: PoseFrame[]; exercise?: string };
      if (batch.exercise) {
        currentExercise = batch.exercise;
      }
      for (const frame of batch.frames) {
        if (frame.landmarks && frame.landmarks.length >= 28) {
          const result = algorithm.analyze(frame.landmarks, currentExercise);
          latestAlgorithmResult = result;
        }
      }
      if (latestAlgorithmResult) {
        if (COACH_MODE === 'doubao') {
          askDoubaoCoach(ws, latestAlgorithmResult);
        } else {
          const feedback = await generateCoaching(latestAlgorithmResult);
          safeSend(ws, { type: 'coaching_feedback', payload: feedback });
        }
      }
    }
  });

  ws.on('close', () => {
    algorithm.reset();
  });
}

/**
 * 豆包教练模式：把运动状态直接喂给豆包智能体
 * 豆包自己用教练人格出话术 + 语音，一步到位
 */
async function askDoubaoCoach(
  ws: WebSocket,
  result: ReturnType<PoseAlgorithmEngine['analyze']>
): Promise<void> {
  const exerciseName = EXERCISE_NAMES[result.exercise] || result.exercise;
  const stageDesc: Record<string, string> = {
    standing: '站立准备', ascending: '上升中', descending: '下放中',
    bottom: '最低点', holding: '保持中', extended: '展开', contracted: '收缩',
    up: '抬腿中', down: '放腿中', left: '向左', right: '向右',
    neutral: '中立位',
  };

  // 构建运动状态描述
  const stateDesc = [
    `运动：${exerciseName}`,
    `次数：第${result.repCount}次`,
    `阶段：${stageDesc[result.stage] || result.stage}`,
    `质量评分：${result.quality.qualityScore}分`,
    result.quality.errors.length > 0 ? `错误：${result.quality.errors.join('、')}` : '',
    result.quality.warnings.length > 0 ? `警告：${result.quality.warnings.join('、')}` : '',
    `膝盖角度：${Math.round(result.angles.kneeAngle || 0)}度`,
    `髋部角度：${Math.round(result.angles.hipAngle || 0)}度`,
  ].filter(Boolean).join('，');

  try {
    const response = await fetch(DOUBAO_COACH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: stateDesc,
        }],
      }),
    });

    if (!response.ok) {
      // 降级到旧模式
      await askLegacyCoach(ws, result);
      return;
    }

    const data = await response.json() as {
      messages: Array<{
        type: string;
        content: string;
        name?: string;
      }>;
    };

    let audioUrl: string | null = null;
    let coachText = '';

    // 提取豆包的教练话术和语音
    for (const msg of data.messages) {
      if (msg.type === 'tool' && msg.name === 'synthesize_speech' && msg.content) {
        audioUrl = msg.content.trim();
      }
      // 豆包的回复文本（AI message，不是 human 也不是 tool）
      if (msg.type === 'ai' && msg.content && !msg.name) {
        coachText = msg.content.trim();
      }
    }

    // 推送教练反馈（兼容前端现有格式）
    if (coachText || audioUrl) {
      safeSend(ws, {
        type: 'coaching_feedback',
        payload: {
          exercise: result.exercise,
          repCount: result.repCount,
          stage: result.stage,
          quality: result.quality.qualityScore >= 85 ? 'good' as const
            : result.quality.qualityScore >= 60 ? 'warning' as const : 'error' as const,
          effect: result.effect,
          tips: coachText ? [coachText] : [],
          encouragement: '',
        },
      });

      // 推送语音
      if (audioUrl) {
        safeSend(ws, {
          type: 'tts_ready',
          payload: { audioUrl, text: coachText },
        });
      }
    }
  } catch (err) {
    console.error('[coaching] 豆包教练异常，降级到旧模式:', err);
    await askLegacyCoach(ws, result);
  }
}

/**
 * 旧模式降级：LLM 生成话术 + TTS 念出来
 */
async function askLegacyCoach(
  ws: WebSocket,
  result: ReturnType<PoseAlgorithmEngine['analyze']>
): Promise<void> {
  try {
    const feedback = await generateCoaching(result);
    safeSend(ws, { type: 'coaching_feedback', payload: feedback });

    let ttsText = feedback.encouragement || (feedback.tips.length > 0 ? feedback.tips[0] : '');
    if (ttsText.length > 60) ttsText = ttsText.substring(0, 60);
    if (ttsText) {
      const ttsUrl = await synthDirect(ttsText);
      if (ttsUrl) {
        safeSend(ws, {
          type: 'tts_ready',
          payload: { audioUrl: ttsUrl, text: ttsText },
        });
      }
    }
  } catch (err) {
    console.error('[coaching] 旧模式教练异常:', err);
  }
}

/**
 * SDK TTSClient 直出（降级用，无豆包味）
 */
async function synthDirect(text: string): Promise<string | null> {
  try {
    const client = getTTSClient();
    const result = await client.synthesize({
      uid: 'pose-coach',
      text,
      speaker: 'zh_female_xiaohe_uranus_bigtts',
    });
    return result.audioUri;
  } catch {
    return null;
  }
}

function safeSend(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
