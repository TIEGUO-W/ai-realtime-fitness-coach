import { WebSocket, type WebSocketServer } from 'ws';
import { setRpiClient, broadcastToBrowsers } from '../lib/relay';
import { detectPoseFromJpeg, type DetectedPose } from '../services/pose-detector';
import type { PoseFrame } from '../lib/ws-client';

// 帧处理节流 — 避免树莓派帧率过高导致 CPU 过载
const MIN_FRAME_INTERVAL_MS = 80; // 最多 ~12fps 处理
let lastProcessTime = 0;

export function setupCameraHandler(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket) => {
    console.log('[ws/camera] RPi connected');
    setRpiClient(ws);

    // 通知浏览器 RPi 已上线
    const statusMsg: WsMessage = { type: 'rpi:status', payload: { connected: true } };
    broadcastToBrowsers(JSON.stringify(statusMsg));

    ws.on('message', async (raw: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        // 文本控制消息
        const msg: WsMessage = JSON.parse(raw.toString());
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', payload: null }));
        }
        return;
      }

      // JPEG 二进制帧 — 节流处理
      const now = Date.now();
      if (now - lastProcessTime < MIN_FRAME_INTERVAL_MS) return;
      lastProcessTime = now;

      try {
        const pose = await detectPoseFromJpeg(raw);

        if (pose) {
          // 1. 发送带骨架叠加的帧给浏览器
          const frameBase64 = pose.annotatedImage.toString('base64');
          const frameMsg: WsMessage = {
            type: 'remote:frame',
            payload: {
              image: frameBase64,
              width: 0, // 由前端从图片获取
              height: 0,
              timestamp: now,
            },
          };
          broadcastToBrowsers(JSON.stringify(frameMsg));

          // 2. 发送骨架坐标给浏览器（供显示和统计）
          const skeletonMsg: WsMessage = {
            type: 'remote:skeleton',
            payload: {
              landmarks: pose.landmarks,
              worldLandmarks: pose.worldLandmarks,
              timestamp: now,
            },
          };
          broadcastToBrowsers(JSON.stringify(skeletonMsg));

          // 3. 自动积累骨架帧供 LLM 分析
          // 将骨架帧 push 到 coaching handler 的缓冲区
          processFrameAlgorithms(pose.landmarks);
        } else {
          // 没检测到人体 — 只转发原始帧
          const frameBase64 = raw.toString('base64');
          const frameMsg: WsMessage = {
            type: 'remote:frame',
            payload: {
              image: frameBase64,
              width: 0,
              height: 0,
              timestamp: now,
            },
          };
          broadcastToBrowsers(JSON.stringify(frameMsg));

          const noPoseMsg: WsMessage = {
            type: 'remote:nopose',
            payload: { timestamp: now },
          };
          broadcastToBrowsers(JSON.stringify(noPoseMsg));
        }
      } catch (err) {
        console.error('[ws/camera] frame processing error:', err);
      }
    });

    ws.on('close', () => {
      console.log('[ws/camera] RPi disconnected');
      setRpiClient(null);
      const statusMsg: WsMessage = { type: 'rpi:status', payload: { connected: false } };
      broadcastToBrowsers(JSON.stringify(statusMsg));
    });
  });
}

// ─── 双层话术架构：快速层 + 深度层 ─────────────────────
import { PoseAlgorithmEngine, type AlgorithmResult } from './pose-algorithm';
import { generateCoaching } from './coaching-engine';
import { generateQuickCoaching, generateIdleCoaching, getExerciseName } from './coaching-templates';
import { TTSClient, Config } from 'coze-coding-dev-sdk';
import type { WsMessage, Landmark, CoachingFeedback, AlgorithmUpdatePayload, TTSReadyPayload } from '../lib/ws-client';

const DOUBAO_COACH_URL = process.env.DOUBAO_VOICE_BOT_URL || 'https://320a02f4-5fad-4816-a1a8-37c1a4a92247.dev.coze.site/run';
const COACH_MODE = process.env.COACH_MODE || 'hybrid'; // 'hybrid'(快速+深度) / 'doubao'(纯豆包) / 'legacy'(旧LLM+TTS)

const QUICK_COACH_INTERVAL_MS = 3000;  // 快速话术 ~3秒
const DEEP_COACH_INTERVAL_MS = 30000;  // 豆包深度点评 ~30秒

let currentExercise: string | undefined;
let algorithmEngine: PoseAlgorithmEngine | null = null;
let lastAlgoResult: AlgorithmResult | null = null;
let prevRepCount = 0;
let lastQuickCoach = 0;
let lastDeepCoach = 0;
let deepCoachBusy = false;
let lastActivityTime = Date.now();
let coachTimer: ReturnType<typeof setInterval> | null = null;
let ttsClient: TTSClient | null = null;

function getAlgorithmEngine(): PoseAlgorithmEngine {
  if (!algorithmEngine) {
    algorithmEngine = new PoseAlgorithmEngine();
  }
  return algorithmEngine;
}

function getTTSClientInstance(): TTSClient {
  if (!ttsClient) {
    ttsClient = new TTSClient(new Config());
  }
  return ttsClient;
}

/** 每帧调用：规则算法实时处理 → 推送算法结果 + 特效 + 快速话术 */
function processFrameAlgorithms(landmarks: Landmark[]) {
  const engine = getAlgorithmEngine();
  const result = engine.analyze(landmarks, currentExercise || 'squat');
  lastAlgoResult = result;
  lastActivityTime = Date.now();

  // 推送轻量算法结果给浏览器（毫秒级）
  const algoMsg: WsMessage<AlgorithmUpdatePayload> = {
    type: 'algorithm_update',
    payload: {
      exercise: result.exercise,
      stage: result.stage,
      repCount: result.repCount,
      quality: result.quality.qualityScore >= 85 ? 'good' : result.quality.qualityScore >= 60 ? 'warning' : 'error',
      effect: result.effect,
      kneeAngle: result.angles.kneeAngle,
      hipAngle: result.angles.hipAngle,
    },
  };
  broadcastToBrowsers(JSON.stringify(algoMsg));

  // 完成一次动作 → 推送特效指令
  if (result.completedRep && result.effect) {
    const repMsg: WsMessage<{ count: number; effect: string }> = {
      type: 'rep_completed',
      payload: { count: result.repCount, effect: result.effect },
    };
    broadcastToBrowsers(JSON.stringify(repMsg));
  }

  // ===== 实时层：快速话术 =====
  const now = Date.now();
  if (COACH_MODE === 'hybrid') {
    const justCompletedRep = result.repCount > prevRepCount;
    const qualityUrgent = result.quality.qualityScore < 50;

    if (justCompletedRep || qualityUrgent || (now - lastQuickCoach >= QUICK_COACH_INTERVAL_MS)) {
      lastQuickCoach = now;
      const qualityLevel = result.quality.qualityScore >= 90 ? 'perfect' as const
        : result.quality.qualityScore >= 75 ? 'good' as const
        : result.quality.qualityScore >= 50 ? 'adjust' as const
        : result.quality.qualityScore >= 30 ? 'warning' as const : 'error' as const;

      const coaching = generateQuickCoaching(
        result.exercise, result.stage, qualityLevel,
        result.repCount, prevRepCount,
      );

      if (coaching.text) {
        const msg: WsMessage<CoachingFeedback> = {
          type: 'coaching_feedback',
          payload: {
            exercise: result.exercise,
            repCount: result.repCount,
            stage: result.stage,
            quality: (qualityLevel === 'perfect' ? 'good' : qualityLevel === 'adjust' ? 'warning' : qualityLevel) as 'good' | 'warning' | 'error',
            effect: result.effect,
            tips: [coaching.text],
            encouragement: '',
          },
        };
        broadcastToBrowsers(JSON.stringify(msg));

        // 快速 TTS
        synthQuickCamera(coaching.text).then(audioUrl => {
          if (audioUrl) {
            const ttsMsg: WsMessage<TTSReadyPayload> = {
              type: 'tts_ready',
              payload: { audioUrl, text: coaching.text },
            };
            broadcastToBrowsers(JSON.stringify(ttsMsg));
          }
        });
      }
      prevRepCount = result.repCount;
    }
  }

  // 启动深度教练循环
  startCoachLoop();
}

function startCoachLoop() {
  if (coachTimer) return;
  coachTimer = setInterval(async () => {
    if (!lastAlgoResult) return;

    const now = Date.now();

    // 空闲检测
    if (now - lastActivityTime > 10000 && now - lastActivityTime < 12000) {
      const text = generateIdleCoaching();
      const msg: WsMessage<CoachingFeedback> = {
        type: 'coaching_feedback',
        payload: {
          exercise: currentExercise || 'squat',
          repCount: prevRepCount,
          stage: 'neutral',
          quality: 'good',
          effect: null,
          tips: [text],
          encouragement: '',
        },
      };
      broadcastToBrowsers(JSON.stringify(msg));
      synthQuickCamera(text).then(audioUrl => {
        if (audioUrl) {
          const ttsMsg: WsMessage<TTSReadyPayload> = {
            type: 'tts_ready',
            payload: { audioUrl, text },
          };
          broadcastToBrowsers(JSON.stringify(ttsMsg));
        }
      });
    }

    // 深度层：豆包智能体
    if (COACH_MODE === 'hybrid' && now - lastDeepCoach >= DEEP_COACH_INTERVAL_MS && !deepCoachBusy) {
      lastDeepCoach = now;
      deepCoachBusy = true;
      askDoubaoDeepCoachCamera(lastAlgoResult).finally(() => { deepCoachBusy = false; });
    } else if (COACH_MODE === 'doubao' && now - lastDeepCoach >= 5000 && !deepCoachBusy) {
      lastDeepCoach = now;
      deepCoachBusy = true;
      askDoubaoDeepCoachCamera(lastAlgoResult).finally(() => { deepCoachBusy = false; });
    } else if (COACH_MODE === 'legacy' && now - lastQuickCoach >= QUICK_COACH_INTERVAL_MS) {
      lastQuickCoach = now;
      askLegacyCoachCamera(lastAlgoResult);
    }
  }, 2000);
}

/** 快速 TTS：SDK TTSClient 直出 */
async function synthQuickCamera(text: string): Promise<string | null> {
  try {
    const client = getTTSClientInstance();
    const result = await client.synthesize({
      uid: 'pose-coach-camera',
      text,
      speaker: 'zh_female_xiaohe_uranus_bigtts',
    });
    return result.audioUri;
  } catch {
    return null;
  }
}

/** 豆包深度教练（远程模式） */
async function askDoubaoDeepCoachCamera(result: AlgorithmResult) {
  const exerciseName = getExerciseName(result.exercise);
  const stageDesc: Record<string, string> = {
    standing: '站立准备', ascending: '上升中', descending: '下放中',
    bottom: '最低点', holding: '保持中', extended: '展开', contracted: '收缩',
    up: '抬腿中', down: '放腿中', neutral: '中立位',
  };

  const COACH_PERSONA = `你是我的运动搭子教练"豆包"，性格又贱又暖、嘴毒心软。说话风格：东北话+网络梗，骚气但不过分，像兄弟/闺蜜在旁边一边怼你一边加油。你现在是每30秒一次的深度点评，给2-3句总结。规则：1.总结最近运动表现，骚气点评 2.指出最需要改进的一点 3.鼓励继续 4.别超过50字 5.必须用语音回复（用synthesize_speech工具）`;

  const stateDesc = [
    `运动：${exerciseName}`,
    `已完成：${result.repCount}次`,
    `阶段：${stageDesc[result.stage] || result.stage}`,
    `质量评分：${result.quality.qualityScore}分`,
    result.quality.errors.length > 0 ? `主要问题：${result.quality.errors[0]}` : '动作比较标准',
    result.quality.warnings.length > 0 ? `注意：${result.quality.warnings[0]}` : '',
  ].filter(Boolean).join('，');

  try {
    const response = await fetch(DOUBAO_COACH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: `${COACH_PERSONA}\n\n【当前运动状态】${stateDesc}` }],
      }),
    });

    if (!response.ok) return;

    const data = await response.json() as {
      messages: Array<{ type: string; content: string; name?: string }>;
    };

    let audioUrl: string | null = null;
    let coachText = '';

    for (const msg of data.messages) {
      if (msg.type === 'tool' && msg.name === 'synthesize_speech' && msg.content) {
        audioUrl = msg.content.trim();
      }
      if (msg.type === 'ai' && msg.content && !msg.name) {
        coachText = msg.content.trim();
      }
    }

    if (coachText || audioUrl) {
      const msg: WsMessage<CoachingFeedback> = {
        type: 'coaching_feedback',
        payload: {
          exercise: result.exercise,
          repCount: result.repCount,
          stage: result.stage,
          quality: result.quality.qualityScore >= 85 ? 'good' : result.quality.qualityScore >= 60 ? 'warning' : 'error',
          effect: result.effect,
          tips: coachText ? [coachText] : [],
          encouragement: '',
        },
      };
      broadcastToBrowsers(JSON.stringify(msg));

      if (audioUrl) {
        const ttsMsg: WsMessage<TTSReadyPayload> = {
          type: 'tts_ready',
          payload: { audioUrl, text: coachText },
        };
        broadcastToBrowsers(JSON.stringify(ttsMsg));
      }
    }
  } catch (err) {
    console.error('[ws/camera] 豆包深度点评异常:', err);
  }
}

/** 旧模式降级 */
async function askLegacyCoachCamera(result: AlgorithmResult) {
  try {
    const feedback = await generateCoaching(result);
    const msg: WsMessage<CoachingFeedback> = {
      type: 'coaching_feedback',
      payload: feedback,
    };
    broadcastToBrowsers(JSON.stringify(msg));

    const ttsText = [...feedback.tips, feedback.encouragement].filter(Boolean).join('。');
    if (ttsText) {
      const audioUrl = await synthQuickCamera(ttsText);
      if (audioUrl) {
        const ttsMsg: WsMessage<TTSReadyPayload> = {
          type: 'tts_ready',
          payload: { audioUrl, text: ttsText },
        };
        broadcastToBrowsers(JSON.stringify(ttsMsg));
      }
    }
  } catch (err) {
    console.error('[ws/camera] 旧模式教练异常:', err);
  }
}

/** 浏览器可设置当前运动类型 */
export function setExerciseForCamera(exercise: string | undefined) {
  currentExercise = exercise;
  if (algorithmEngine) {
    algorithmEngine.reset();
  }
  lastAlgoResult = null;
  prevRepCount = 0;
}
