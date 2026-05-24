// WebSocket 消息协议类型定义

export interface WsMessage<T = unknown> {
  type: string;
  payload: T;
}

// ─── 客户端 → 服务端 ────────────────────────────

// 骨架帧数据（归一化坐标 0-1）
export interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseFrame {
  landmarks: Landmark[];
  timestamp: number;
}

export interface PoseBatchPayload {
  frames: PoseFrame[];
  exercise?: string; // 用户当前选择的运动
  sessionId: string;
}

// 浏览器设置运动类型（远程模式时传给服务端）
export interface SetExercisePayload {
  exercise: string;
}

// ─── 服务端 → 客户端 ────────────────────────────

export interface CoachingFeedback {
  exercise: string;       // 识别到的运动
  repCount: number;       // 计数
  stage: string;          // 当前阶段
  quality: 'good' | 'warning' | 'error'; // 动作质量
  effect: 'perfect' | 'excellent' | 'good' | null; // 前端特效指令
  tips: string[];         // 纠正建议
  encouragement: string;  // 鼓励语
}

// 实时算法结果（规则算法毫秒级推送，不等 LLM）
export interface AlgorithmUpdatePayload {
  exercise: string;
  stage: string;
  repCount: number;
  quality: 'good' | 'warning' | 'error';
  effect: 'perfect' | 'excellent' | 'good' | null;
  kneeAngle: number | null;
  hipAngle: number | null;
}

export interface TTSReadyPayload {
  audioUrl: string;
  text: string;
}

// 远程帧数据（服务端骨架检测后的结果推送到浏览器）
export interface RemoteFramePayload {
  image: string;    // base64 JPEG（带骨架叠加）
  width: number;
  height: number;
  timestamp: number;
}

export interface RemoteSkeletonPayload {
  landmarks: Landmark[];
  worldLandmarks: Landmark[];
  timestamp: number;
}

export interface RpiStatusPayload {
  connected: boolean;
}

// ─── WebSocket 客户端工具 ───────────────────────

interface WsOptions {
  path: string;
  onMessage: (msg: WsMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  reconnect?: boolean;
  heartbeatMs?: number;
}

export function createWsConnection(opts: WsOptions) {
  const { path, onMessage, onOpen, onClose, reconnect = true, heartbeatMs = 30000 } = opts;
  let ws: WebSocket;
  let heartbeatTimer: ReturnType<typeof setInterval>;
  let closed = false;

  function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}${path}`);

    ws.onopen = () => {
      heartbeatTimer = setInterval(
        () => ws.send(JSON.stringify({ type: 'ping', payload: null })),
        heartbeatMs,
      );
      onOpen?.();
    };

    ws.onmessage = (e) => {
      const msg: WsMessage = JSON.parse(e.data as string);
      if (msg.type === 'pong') return;
      onMessage(msg);
    };

    ws.onclose = () => {
      clearInterval(heartbeatTimer);
      onClose?.();
      if (reconnect && !closed) setTimeout(connect, 1000);
    };
  }

  connect();

  return {
    send: (msg: WsMessage) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    close: () => {
      closed = true;
      ws.close();
    },
  };
}
