/**
 * WebSocket 浏览器端处理器 — 本地模式
 * 
 * 优化架构:
 * 1. 每帧 → 规则算法（毫秒级）→ 实时推送算法结果（计数/阶段/质量/特效）
 * 2. 每 3 秒 → LLM 话术（基于算法结果）
 * 3. LLM 返回 → 话术 + TTS 语音
 */

import type { WebSocket } from 'ws';
import type { WsMessage, Landmark, PoseFrame } from '../lib/ws-client';
import { PoseAlgorithmEngine } from './pose-algorithm';
import { generateCoaching } from './coaching-engine';

const ALGORITHM_INTERVAL_MS = 100;   // 算法推送频率 ~10fps
const LLM_INTERVAL_MS = 3000;       // LLM 话术频率 ~每3秒

export function handleCoachingConnection(ws: WebSocket): void {
  const algorithm = new PoseAlgorithmEngine();
  let currentExercise = 'squat';

  let lastAlgorithmPush = 0;
  let lastLlmCall = 0;
  let latestAlgorithmResult: ReturnType<PoseAlgorithmEngine['analyze']> | null = null;

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

      // 实时推送算法结果（~10fps，不等 LLM）
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

      // 定时 LLM 话术（~每3秒）
      if (now - lastLlmCall >= LLM_INTERVAL_MS) {
        lastLlmCall = now;
        try {
          const feedback = await generateCoaching(result);
          safeSend(ws, { type: 'coaching_feedback', payload: feedback });

          // 话术不为空时合成 TTS（优先用鼓励语，更短更有力）
          let ttsText = feedback.encouragement || (feedback.tips.length > 0 ? feedback.tips[0] : '');
          // 截断到 60 字避免 TTS 超时
          if (ttsText.length > 60) ttsText = ttsText.substring(0, 60);
          if (ttsText) {
            const ttsUrl = await synthesizeTTS(ttsText);
            if (ttsUrl) {
              safeSend(ws, {
                type: 'tts_ready',
                payload: { audioUrl: ttsUrl, text: ttsText },
              });
            }
          }
        } catch (err) {
          console.error('[coaching] LLM/TTS error:', err);
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
        const feedback = await generateCoaching(latestAlgorithmResult);
        safeSend(ws, { type: 'coaching_feedback', payload: feedback });
      }
    }
  });

  ws.on('close', () => {
    algorithm.reset();
  });
}

// TTS: SDK 直出（一字不差，低延迟 ~1秒）
// 也可通过环境变量 TTS_MODE=doubao 切换为豆包智能体（豆包自己理解+出话术）
import { TTSClient, Config } from 'coze-coding-dev-sdk';

let ttsClient: TTSClient | null = null;
function getTTSClient(): TTSClient {
  if (!ttsClient) {
    ttsClient = new TTSClient(new Config());
  }
  return ttsClient;
}

const DOUBAO_VOICE_BOT_URL = process.env.DOUBAO_VOICE_BOT_URL || 'https://320a02f4-5fad-4816-a1a8-37c1a4a92247.dev.coze.site/run';
const TTS_MODE = process.env.TTS_MODE || 'direct'; // 'direct' 或 'doubao'

async function synthesizeTTS(text: string): Promise<string | null> {
  const trimmed = text.slice(0, 200);

  try {
    if (TTS_MODE === 'doubao') {
      // 豆包智能体模式：豆包自己理解并回复（延迟 ~3秒，但更有豆包味）
      return await synthViaDoubao(trimmed);
    } else {
      // SDK 直出模式：一字不差转语音（延迟 ~1秒，精确可控）
      return await synthDirect(trimmed);
    }
  } catch (err) {
    console.error('[coaching] TTS error:', err);
    // 降级：如果豆包模式失败，尝试直出
    if (TTS_MODE === 'doubao') {
      try { return await synthDirect(trimmed); } catch { return null; }
    }
    return null;
  }
}

async function synthDirect(text: string): Promise<string | null> {
  const client = getTTSClient();
  const result = await client.synthesize({
    uid: 'pose-coach',
    text,
    speaker: 'zh_female_xiaohe_uranus_bigtts',
  });
  return result.audioUri;
}

async function synthViaDoubao(text: string): Promise<string | null> {
  const response = await fetch(DOUBAO_VOICE_BOT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: text }],
    }),
  });

  if (!response.ok) return null;

  const data = await response.json() as {
    messages: Array<{ type: string; content: string; name?: string }>;
  };

  for (const msg of data.messages) {
    if (msg.type === 'tool' && msg.name === 'synthesize_speech' && msg.content) {
      return msg.content.trim();
    }
  }
  return null;
}

function safeSend(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
