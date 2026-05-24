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

// ─── 规则算法 + 定时 LLM 话术 + TTS ─────────────────────
import { PoseAlgorithmEngine, type AlgorithmResult } from './pose-algorithm';
import { generateCoaching } from './coaching-engine';
import type { WsMessage, Landmark, CoachingFeedback, AlgorithmUpdatePayload, TTSReadyPayload } from '../lib/ws-client';

let currentExercise: string | undefined;
let algorithmEngine: PoseAlgorithmEngine | null = null;
let lastAlgoResult: AlgorithmResult | null = null;
let analyzeTimer: ReturnType<typeof setInterval> | null = null;
const ANALYZE_INTERVAL_MS = 3000;
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
    if (!lastAlgoResult) return;

    try {
      // 用最新的算法结果生成教练反馈（LLM 辅助话术）
      const feedback = await generateCoaching(lastAlgoResult);
      const msg: WsMessage<CoachingFeedback> = {
        type: 'coaching:feedback',
        payload: feedback,
      };
      broadcastToBrowsers(JSON.stringify(msg));

      // TTS 语音播放
      const ttsText = [...feedback.tips, feedback.encouragement].filter(Boolean).join('。');
      if (ttsText) {
        try {
          const client = await getTTSClient();
          const ttsResult = await client.synthesize({
            uid: 'pose-coach-camera',
            text: ttsText,
            speaker: 'zh_male_m191_uranus_bigtts',
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
    } catch (err) {
      console.error('[ws/camera] coaching error:', err);
    }
  }, ANALYZE_INTERVAL_MS);
}

/** 浏览器可设置当前运动类型 */
export function setExerciseForCamera(exercise: string | undefined) {
  currentExercise = exercise;
  if (algorithmEngine) {
    algorithmEngine.reset();
  }
  lastAlgoResult = null;
}
