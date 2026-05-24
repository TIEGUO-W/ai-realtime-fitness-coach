import { WebSocket, type WebSocketServer } from 'ws';
import type { WsMessage, PoseBatchPayload, CoachingFeedback } from '../lib/ws-client';
import { analyzePose } from './coaching-engine';

const ANALYZE_INTERVAL_MS = 2500; // 每 2.5 秒分析一次

export function setupCoachingHandler(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket) => {
    console.log('[ws/coaching] client connected');

    let frameBuffer: PoseBatchPayload | null = null;
    let analyzeTimer: ReturnType<typeof setInterval> | null = null;

    // 定时分析积累的帧
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
    });

    ws.on('close', () => {
      console.log('[ws/coaching] client disconnected');
      if (analyzeTimer) clearInterval(analyzeTimer);
    });
  });
}
