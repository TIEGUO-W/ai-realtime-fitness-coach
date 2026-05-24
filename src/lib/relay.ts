// 帧中继 — 连接 RPi 摄像头端点和浏览器客户端

import { WebSocket } from 'ws';

// 浏览器客户端池（/ws/coaching 连接）
export const browserClients = new Set<WebSocket>();

// RPi 客户端（/ws/camera 连接，通常只有1个）
export let rpiClient: WebSocket | null = null;

export function setRpiClient(ws: WebSocket | null) {
  rpiClient = ws;
}

/** 向所有浏览器客户端广播文本消息 */
export function broadcastToBrowsers(message: string) {
  for (const client of browserClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}
