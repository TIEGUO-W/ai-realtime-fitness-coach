/**
 * WebSocket 浏览器端处理器 — 本地模式
 *
 * 骨架帧 → 规则算法（毫秒级）→ 推送 algorithm_update + rep_completed
 *                ↘ CoachSession（智能插话决策 + 话术 + TTS）
 *
 * 语音命令 → ASR → 控制类本地执行 / 闲聊类委托 CoachSession
 */

import type { WebSocket } from 'ws';
import type { WsMessage, PoseFrame } from '../lib/ws-client';
import { PoseAlgorithmEngine } from './pose-algorithm';
import { CoachSession } from './coach-session';
import { parseVoiceCommand } from './voice-command';
import { ASRClient, Config } from 'coze-coding-dev-sdk';
import { onHeartRate } from '../lib/health-store';

const ALGORITHM_INTERVAL_MS = 100; // 算法推送 ~10fps

/** 前端运动ID → 算法运动ID 映射 */
const EXERCISE_ALIAS: Record<string, string> = {
  pushup: 'push_up',
  push_up: 'push_up',
  deadlift: 'squat',       // 算法暂不支持硬拉，用深蹲逻辑兜底
  squat: 'squat',
  plank: 'plank',
  lunge: 'lunge',
  jumping_jack: 'jumping_jack',
  high_knees: 'high_knees',
  sit_up: 'sit_up',
};

function normalizeExercise(raw: string): string {
  return EXERCISE_ALIAS[raw] || 'squat';
}

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

  // Listen for Apple Health heart rate updates
  const hrHandler = (data: { sessionId: string; heartRate: number }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'heart_rate_update', payload: { heartRate: data.heartRate } }));
    }
  };
  const unsubHeartRate = onHeartRate(hrHandler);

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

    // 前端传 sessionId 绑定健康数据
    if (msg.type === 'set_session') {
      const sid = (msg.payload as { sessionId: string }).sessionId;
      if (sid) session.setSessionId(sid);
      return;
    }

    // ── 切换运动 ──────────────────────────────

    if (msg.type === 'set_exercise') {
      const raw = (msg.payload as { exercise: string }).exercise || 'squat';
      currentExercise = normalizeExercise(raw);
      session.setExercise(currentExercise);
      algorithm.reset();
      return;
    }

    // ── 语音命令 ──────────────────────────────

    if (msg.type === 'voice_command') {
      const payload = msg.payload as { base64Data?: string; text?: string };
      console.log('[coaching] voice_command received, text:', payload.text?.slice(0, 30), 'hasAudio:', !!payload.base64Data);
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
          // 静音/无效音频，不回复
          console.log('[coaching] voice_command: no speech detected, skipping');
          return;
        }

        // 通知前端识别结果
        safeSend(ws, { type: 'voice_recognized', payload: { text: recognizedText } });

        // 控制类命令：本地执行
        const intent = parseVoiceCommand(recognizedText);
        if (intent.action === 'switch_exercise') {
          currentExercise = normalizeExercise(intent.exercise);
          session.setExercise(currentExercise);
          algorithm.reset();
          safeSend(ws, { type: 'set_exercise', payload: { exercise: intent.exercise } });
        } else if (intent.action === 'reset') {
          algorithm.reset();
        }

        // 所有语音都交给 CoachSession 生成回复（短命令秒回，闲聊异步追 LLM）
        await session.hearVoice(recognizedText);
      } catch (err) {
        console.error('[coaching] voice error:', err);
        safeSend(ws, { type: 'voice_reply', payload: { text: '出了点问题，再试一次？', audioUrl: null } });
      }
      return;
    }

    // ── 骨架帧 ────────────────────────────────

    if (msg.type === 'pose_frame') {
      const frame = msg.payload as PoseFrame;
      if (!frame.landmarks || frame.landmarks.length < 28) return;

      const result = algorithm.analyze(frame.landmarks, currentExercise);
      const now = Date.now();

      // 算法推送（~10fps，不等任何人）
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

      // 委托给 CoachSession（智能插话决策 + 模板话术 + TTS）
      session.observePose(result);
      return;
    }

    // ── 批量骨架帧（HTTP API 兼容） ────────────

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
        }
      }
    }
  });

  ws.on('close', () => {
    algorithm.reset();
    session.destroy();
    unsubHeartRate();
  });
}

function safeSend(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
