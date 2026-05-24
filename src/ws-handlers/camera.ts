import { WebSocket, type WebSocketServer } from 'ws';
import { setRpiClient, broadcastToBrowsers } from '../lib/relay';
import { detectPoseFromJpeg, type DetectedPose } from '../services/pose-detector';
import type { WsMessage, Landmark, PoseFrame } from '../lib/ws-client';

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
          accumulateForCoaching(pose.landmarks);
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

// ─── 骨架帧缓冲 + 定时 LLM 分析 ─────────────────────
import { analyzePose } from './coaching-engine';
import type { PoseBatchPayload, CoachingFeedback } from '../lib/ws-client';

let frameBuffer: PoseFrame[] = [];
let currentExercise: string | undefined;
let analyzeTimer: ReturnType<typeof setInterval> | null = null;
const ANALYZE_INTERVAL_MS = 2500;

function accumulateForCoaching(landmarks: Landmark[]) {
  frameBuffer.push({ landmarks, timestamp: Date.now() });
  if (frameBuffer.length > 30) {
    frameBuffer = frameBuffer.slice(-30);
  }
  startAnalyzeLoop();
}

function startAnalyzeLoop() {
  if (analyzeTimer) return;
  analyzeTimer = setInterval(async () => {
    if (frameBuffer.length === 0) return;

    const batch: PoseBatchPayload = {
      frames: frameBuffer.splice(0),
      exercise: currentExercise,
      sessionId: 'rpi-auto',
    };

    try {
      const feedback = await analyzePose(batch);
      const msg: WsMessage<CoachingFeedback> = {
        type: 'coaching:feedback',
        payload: feedback,
      };
      broadcastToBrowsers(JSON.stringify(msg));
    } catch (err) {
      console.error('[ws/camera] LLM analyze error:', err);
    }
  }, ANALYZE_INTERVAL_MS);
}

/** 浏览器可设置当前运动类型 */
export function setExerciseForCamera(exercise: string | undefined) {
  currentExercise = exercise;
}
