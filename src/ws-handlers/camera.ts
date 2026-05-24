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

// ─── 规则算法 + 定时豆包教练话术 + 语音 ─────────────────────
import { PoseAlgorithmEngine, type AlgorithmResult } from './pose-algorithm';
import { generateCoaching } from './coaching-engine';
import type { WsMessage, Landmark, CoachingFeedback, AlgorithmUpdatePayload, TTSReadyPayload } from '../lib/ws-client';

const DOUBAO_COACH_URL = process.env.DOUBAO_VOICE_BOT_URL || 'https://320a02f4-5fad-4816-a1a8-37c1a4a92247.dev.coze.site/run';
const COACH_MODE = process.env.COACH_MODE || 'doubao'; // 'doubao'(豆包当教练) 或 'legacy'(旧LLM+TTS模式)

const EXERCISE_NAMES: Record<string, string> = {
  squat: '深蹲', deadlift: '硬拉', pushup: '俯卧撑',
  lunge: '弓步蹲', plank: '平板支撑', highknees: '高抬腿', jumpingjack: '开合跳',
};

let currentExercise: string | undefined;
let algorithmEngine: PoseAlgorithmEngine | null = null;
let lastAlgoResult: AlgorithmResult | null = null;
let analyzeTimer: ReturnType<typeof setInterval> | null = null;
let coachBusy = false;
const ANALYZE_INTERVAL_MS = 5000; // 豆包教练每5秒
let ttsClient: import('coze-coding-dev-sdk').TTSClient | null = null;

function getAlgorithmEngine(): PoseAlgorithmEngine {
  if (!algorithmEngine) {
    algorithmEngine = new PoseAlgorithmEngine();
  }
  return algorithmEngine;
}

async function getTTSClient() {
  if (!ttsClient) {
    const { TTSClient, Config } = await import('coze-coding-dev-sdk');
    ttsClient = new TTSClient(new Config());
  }
  return ttsClient;
}

/** 每帧调用：规则算法实时处理 → 推送算法结果 + 特效 */
function processFrameAlgorithms(landmarks: Landmark[]) {
  const engine = getAlgorithmEngine();
  const result = engine.analyze(landmarks, currentExercise || 'squat');
  lastAlgoResult = result;

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

  startNarrationLoop();
}

function startNarrationLoop() {
  if (analyzeTimer) return;
  analyzeTimer = setInterval(async () => {
    if (!lastAlgoResult || coachBusy) return;
    coachBusy = true;

    try {
      if (COACH_MODE === 'doubao') {
        await askDoubaoCoachCamera(lastAlgoResult);
      } else {
        await askLegacyCoachCamera(lastAlgoResult);
      }
    } catch (err) {
      console.error('[ws/camera] coaching error:', err);
    } finally {
      coachBusy = false;
    }
  }, ANALYZE_INTERVAL_MS);
}

/** 豆包教练模式（远程）：把运动状态喂给豆包，它自己出话术+语音 */
async function askDoubaoCoachCamera(result: AlgorithmResult) {
  const exerciseName = EXERCISE_NAMES[result.exercise] || result.exercise;
  const stageDesc: Record<string, string> = {
    standing: '站立准备', ascending: '上升中', descending: '下放中',
    bottom: '最低点', holding: '保持中', extended: '展开', contracted: '收缩',
    up: '抬腿中', down: '放腿中', left: '向左', right: '向右',
    neutral: '中立位',
  };

  // 豆包教练人设：骚话运动搭子
  const COACH_PERSONA = `你是我的运动搭子教练"豆包"，性格又贱又暖、嘴毒心软。说话风格：东北话+网络梗，骚气但不过分，像兄弟/闺蜜在旁边一边怼你一边加油。规则：1.根据运动状态给出1-2句短反馈，别超过30字 2.做对了就骚夸，做错了就毒舌提醒 3.绝对不要重复之前说过的话 4.不要加任何解释说明，直接出骚话 5.必须用语音回复（用synthesize_speech工具）`;

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
        messages: [{ role: 'user', content: `${COACH_PERSONA}\n\n【当前运动状态】${stateDesc}` }],
      }),
    });

    if (!response.ok) {
      await askLegacyCoachCamera(result);
      return;
    }

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
    console.error('[ws/camera] 豆包教练异常，降级:', err);
    await askLegacyCoachCamera(result);
  }
}

/** 旧模式降级：LLM 话术 + SDK TTS */
async function askLegacyCoachCamera(result: AlgorithmResult) {
  const feedback = await generateCoaching(lastAlgoResult!);
  const msg: WsMessage<CoachingFeedback> = {
    type: 'coaching:feedback',
    payload: feedback,
  };
  broadcastToBrowsers(JSON.stringify(msg));

  const ttsText = [...feedback.tips, feedback.encouragement].filter(Boolean).join('。');
  if (ttsText) {
    try {
      const client = await getTTSClient();
      const ttsResult = await client.synthesize({
        uid: 'pose-coach-camera',
        text: ttsText,
        speaker: 'zh_female_xiaohe_uranus_bigtts',
      });
      const ttsMsg: WsMessage<TTSReadyPayload> = {
        type: 'tts_ready',
        payload: { audioUrl: ttsResult.audioUri, text: ttsText },
      };
      broadcastToBrowsers(JSON.stringify(ttsMsg));
    } catch (ttsErr) {
      console.error('[ws/camera] TTS error:', ttsErr);
    }
  }
}

/** 浏览器可设置当前运动类型 */
export function setExerciseForCamera(exercise: string | undefined) {
  currentExercise = exercise;
  if (algorithmEngine) {
    algorithmEngine.reset();
  }
  lastAlgoResult = null;
}
