import { WebSocket, type WebSocketServer } from 'ws';
import type { WsMessage, PoseBatchPayload, CoachingFeedback, SetExercisePayload } from '../lib/ws-client';
import { analyzePose } from './coaching-engine';
import { browserClients } from '../lib/relay';
import { setExerciseForCamera } from './camera';

const ANALYZE_INTERVAL_MS = 2500; // 每 2.5 秒分析一次

export function setupCoachingHandler(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket) => {
    console.log('[ws/coaching] browser client connected');
    browserClients.add(ws);

    let frameBuffer: PoseBatchPayload | null = null;
    let analyzeTimer: ReturnType<typeof setInterval> | null = null;

    // 定时分析积累的帧（本地模式：浏览器发骨架数据过来）
    function startAnalyzeLoop() {
      if (analyzeTimer) return;
      analyzeTimer = setInterval(async () => {
        if (!frameBuffer || frameBuffer.frames.length === 0) return;
        const batch = frameBuffer;
        frameBuffer = null; // 清空缓冲

        try {
          const feedback = await analyzePose(batch);
          const msg: WsMessage<CoachingFeedback> = {
            type: 'coaching:feedback',
            payload: feedback,
          };
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
          }
        } catch (err) {
          console.error('[ws/coaching] analyze error:', err);
        }
      }, ANALYZE_INTERVAL_MS);
    }

    ws.on('message', (raw) => {
      const msg: WsMessage = JSON.parse(raw.toString());

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', payload: null }));
        return;
      }

      // 本地模式：浏览器发来骨架帧
      if (msg.type === 'pose:batch') {
        const payload = msg.payload as PoseBatchPayload;
        // 积累帧数据
        if (!frameBuffer) {
          frameBuffer = { ...payload, frames: [...payload.frames] };
        } else {
          frameBuffer.frames.push(...payload.frames);
          if (payload.exercise) frameBuffer.exercise = payload.exercise;
        }
        // 第一次收到帧时启动分析循环
        startAnalyzeLoop();
      }

      // 设置运动类型（同步给 RPi 摄像头处理链路）
      if (msg.type === 'set:exercise') {
        const payload = msg.payload as SetExercisePayload;
        setExerciseForCamera(payload.exercise || undefined);
      }
    });

    ws.on('close', () => {
      console.log('[ws/coaching] browser client disconnected');
      browserClients.delete(ws);
      if (analyzeTimer) clearInterval(analyzeTimer);
    });
  });
}
