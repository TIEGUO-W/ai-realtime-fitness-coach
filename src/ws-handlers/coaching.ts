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
import { normalizeSessionId, onHeartRate } from '../lib/health-store';
import { FollowAlongEngine } from './follow-along-engine';
import type { AlgorithmResult } from './pose-algorithm';
import { generateFollowCoaching } from './coaching-templates';

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
  let healthSessionId = '';

  // Follow-along mode state
  let followAlongEngine: FollowAlongEngine | null = null;
  let followAlongActive = false;
  let userFrameCounter = 0;
  let lastComparisonPush = 0;
  let lastFollowCorrectionTime = 0;
  let lowMatchStreak = 0;

  // Listen for Apple Health heart rate updates for the bound dashboard session.
  const hrHandler = (data: { sessionId: string; heartRate: number }) => {
    if (healthSessionId && data.sessionId !== normalizeSessionId(healthSessionId)) return;
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
      if (sid) {
        healthSessionId = normalizeSessionId(sid);
        session.setSessionId(healthSessionId);
      }
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

    // ── 跟练模式：开始 ──────────────────────────

    if (msg.type === 'start_follow_along') {
      const { recordingId, coachVideoUrl } = msg.payload as { recordingId: string; coachVideoUrl?: string };
      try {
        followAlongEngine = new FollowAlongEngine();
        await followAlongEngine.loadCoachData(recordingId);
        followAlongActive = true;
        userFrameCounter = 0;
        algorithm.reset();

        const initialFrames = followAlongEngine.getInitialFrames(5);
        safeSend(ws, {
          type: 'follow_along_started',
          payload: {
            recordingId,
            coachVideoUrl: coachVideoUrl || `/uploads/coach-videos/${recordingId}.mp4`,
            totalFrames: followAlongEngine.totalFrames,
            coachLandmarks: initialFrames.map(f => f.landmarks),
          },
        });
        session.setExercise('follow_along');
        session.setFollowAlongMode();
        currentExercise = 'follow_along';
        console.log('[coaching] follow-along started:', recordingId);
      } catch (err) {
        if (!coachVideoUrl) {
          console.error('[coaching] failed to start follow-along:', err);
          safeSend(ws, { type: 'error', payload: { message: '跟练数据加载失败，请确认视频已处理完成' } });
          return;
        }

        followAlongEngine = null;
        followAlongActive = false;
        safeSend(ws, {
          type: 'follow_along_started',
          payload: {
            recordingId,
            coachVideoUrl,
            totalFrames: 0,
            coachLandmarks: [],
          },
        });
        session.setExercise('follow_along');
        session.setFollowAlongMode();
        currentExercise = 'follow_along';
        console.log('[coaching] preset follow-along video started without skeleton:', recordingId);
      }
      return;
    }

    // ── 暂停教练说话 ──────────────────────────
    if (msg.type === 'pause_coaching') {
      session.pause();
      safeSend(ws, { type: 'voice_reply', payload: { text: '已暂停', audioUrl: null } });
      // Say "已暂停" once
      const pauseText = '已暂停，休息一下吧';
      session.sayOnce(pauseText);
      return;
    }

    if (msg.type === 'resume_coaching') {
      session.resume();
      safeSend(ws, { type: 'voice_reply', payload: { text: '继续！', audioUrl: null } });
      return;
    }

    // ── 跟练模式：停止 ──────────────────────────

    if (msg.type === 'stop_follow_along') {
      followAlongActive = false;
      followAlongEngine = null;
      userFrameCounter = 0;
      safeSend(ws, { type: 'follow_along_ended', payload: {} });
      console.log('[coaching] follow-along stopped');
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

      // ── 跟练模式：对比引擎 ──────────────────
      if (followAlongActive && followAlongEngine) {
        userFrameCounter++;
        const comparison = followAlongEngine.compareFrame(frame.landmarks, userFrameCounter);

        if (now - lastComparisonPush >= ALGORITHM_INTERVAL_MS) {
          lastComparisonPush = now;
          safeSend(ws, {
            type: 'comparison_update',
            payload: {
              matchQuality: comparison.matchQuality,
              angleDiffs: comparison.angleDiffs,
              coachFrameIndex: comparison.coachFrameIndex,
              userScore: comparison.matchQuality,
              coachAngles: comparison.coachAngles,
              followed: comparison.followed,
              perJointStatus: comparison.perJointStatus,
            },
          });
        }

        // 推送教练帧给前端渲染
        const coachFrame = followAlongEngine.getCoachFrame(comparison.coachFrameIndex);
        if (coachFrame) {
          safeSend(ws, {
            type: 'coach_frame',
            payload: {
              frameIndex: comparison.coachFrameIndex,
              landmarks: coachFrame.landmarks,
              perJointStatus: comparison.perJointStatus,
            },
          });
        }

        // 偏差大时注入 CoachSession 触发 TTS（有冷却，避免轰炸）
        if (!comparison.followed && comparison.matchQuality < 50) {
          lowMatchStreak++;
        } else {
          lowMatchStreak = 0;
        }

        const now2 = Date.now();
        // 跟练模式：只更新活动时间（防止 idle 误触发），不说话
        // 只在对比发现真正偏差时才触发纠正
        session.touch(); // 仅更新时间戳，不触发 shouldSpeak

        // 偏差足够大 + 足够久才说一次
        if (lowMatchStreak >= 15 && now2 - lastFollowCorrectionTime > 12000) {
          lastFollowCorrectionTime = now2;
          lowMatchStreak = 0;
          const followText = generateFollowCoaching(comparison.perJointStatus, comparison.matchQuality);
          if (followText) {
            const correctionResult: AlgorithmResult = {
              ...result,
              quality: {
                qualityScore: Math.min(result.quality.qualityScore, comparison.matchQuality),
                errors: [followText],
                warnings: result.quality.warnings,
              },
            };
            session.observePose(correctionResult);
          }
        }
        return;
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
    followAlongEngine = null;
    followAlongActive = false;
    userFrameCounter = 0;
  });
}

function safeSend(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
