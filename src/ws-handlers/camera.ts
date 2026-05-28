import { WebSocket, type WebSocketServer } from 'ws';
import { setRpiClient, broadcastToBrowsers } from '../lib/relay';
import { detectPoseFromJpeg } from '../services/pose-detector';
import { PoseAlgorithmEngine, type AlgorithmResult } from './pose-algorithm';
import { CoachSession } from './coach-session';
import type { WsMessage as WsMsg } from '../lib/ws-client';

// 帧处理节流 — 避免树莓派帧率过高导致 CPU 过载
const MIN_FRAME_INTERVAL_MS = 80; // 最多 ~12fps 处理
let lastProcessTime = 0;

// 算法引擎
const algorithm = new PoseAlgorithmEngine();
let currentExercise = 'squat';

// 远程模式的 CoachSession — 与本地模式共享同一套 harness 架构
let cameraSession: CoachSession | null = null;
let lastAlgorithmPush = 0;
const ALGORITHM_INTERVAL_MS = 100;

function getCameraSession(): CoachSession {
  if (!cameraSession) {
    // CoachSession needs a WebSocket-like object with send()
    // Create a minimal adapter that broadcasts to all browser clients
    const wsAdapter = {
      send: (msg: string) => broadcastToBrowsers(msg),
      readyState: 1, // OPEN
    } as unknown as WebSocket;
    cameraSession = new CoachSession(wsAdapter);
    cameraSession.setExercise(currentExercise);
  }
  return cameraSession;
}

export function setupCameraHandler(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket) => {
    console.log('[ws/camera] RPi connected');
    setRpiClient(ws);

    // 通知浏览器 RPi 已上线
    const statusMsg: WsMsg = { type: 'rpi:status', payload: { connected: true } };
    broadcastToBrowsers(JSON.stringify(statusMsg));

    ws.on('message', async (raw: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        const msg: WsMsg = JSON.parse(raw.toString());
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
          const frameMsg: WsMsg = {
            type: 'remote:frame',
            payload: {
              image: frameBase64,
              width: 0,
              height: 0,
              timestamp: now,
            },
          };
          broadcastToBrowsers(JSON.stringify(frameMsg));

          // 2. 发送骨架坐标给浏览器
          const skeletonMsg: WsMsg = {
            type: 'remote:skeleton',
            payload: {
              landmarks: pose.landmarks,
              worldLandmarks: pose.worldLandmarks,
              timestamp: now,
            },
          };
          broadcastToBrowsers(JSON.stringify(skeletonMsg));

          // 3. 算法分析
          const result = algorithm.analyze(pose.landmarks, currentExercise);

          // 4. 推送 algorithm_update（节流 10fps）
          if (now - lastAlgorithmPush >= ALGORITHM_INTERVAL_MS) {
            lastAlgorithmPush = now;
            const algoMsg: WsMsg = {
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
            };
            broadcastToBrowsers(JSON.stringify(algoMsg));
          }

          // 5. 完成一次动作 → 推送特效
          if (result.completedRep) {
            const repMsg: WsMsg = {
              type: 'rep_completed',
              payload: { repCount: result.repCount, effect: result.effect, quality: result.quality.qualityScore },
            };
            broadcastToBrowsers(JSON.stringify(repMsg));
          }

          // 6. 委托给 CoachSession（智能插话决策 + 模板话术 + TTS）
          const session = getCameraSession();
          session.observePose(result);
        } else {
          // 没检测到人体 — 只转发原始帧
          const frameBase64 = raw.toString('base64');
          const frameMsg: WsMsg = {
            type: 'remote:frame',
            payload: {
              image: frameBase64,
              width: 0,
              height: 0,
              timestamp: now,
            },
          };
          broadcastToBrowsers(JSON.stringify(frameMsg));

          const noPoseMsg: WsMsg = {
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
      const statusMsg: WsMsg = { type: 'rpi:status', payload: { connected: false } };
      broadcastToBrowsers(JSON.stringify(statusMsg));
    });
  });
}

/** 浏览器可设置当前运动类型 — 同步给算法引擎和 CoachSession */
export function setExerciseForCamera(exercise: string | undefined) {
  currentExercise = exercise || 'squat';
  algorithm.reset();
  const session = getCameraSession();
  session.setExercise(currentExercise);
}
