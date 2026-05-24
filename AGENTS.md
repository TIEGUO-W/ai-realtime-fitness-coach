# AGENTS.md

## 项目概览

AI 实时运动教练 — 支持本地/远程双模式的实时骨架检测 + 云端 LLM 智能分析 + TTS 语音反馈。

### 架构（双模式）

**模式一：本地模式（浏览器端骨架检测）**
```
浏览器 (摄像头 + MediaPipe Pose) → WebSocket → 云端 (LLM + TTS) → 反馈
   ↑ 摄像头 + 骨架提取               ↑ 骨架 JSON ~2KB/帧    ↑ 文字 + 语音
```

**模式二：远程模式（树莓派 + 云端骨架检测）**
```
树莓派 (摄像头) → /ws/camera → 云端 (MediaPipe WASM + LLM + TTS) → /ws/coaching → 浏览器
   ↑ 只传 JPEG 帧                    ↑ 骨架检测 + 推理          ↑ 骨架图 + 反馈
```

核心优化：
- 本地模式：只传骨架坐标 JSON，不传视频流，极低延迟
- 远程模式：树莓派零推理负载，只采集+传输；云端 WASM 骨架检测 + SVG 叠加 + LLM 推理

## 技术栈

- **Framework**: Next.js 16 (App Router + 自定义服务器)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI**: shadcn/ui + Tailwind CSS 4
- **WebSocket**: ws (noServer 模式，与 Next.js 共用 5000 端口)
- **AI**: coze-coding-dev-sdk (LLMClient + TTSClient)
- **骨架检测-本地**: MediaPipe Pose (CDN 加载，浏览器端 WebGL)
- **骨架检测-远程**: @mediapipe/tasks-vision (Node.js WASM) + sharp (图像解码/叠加)
- **图像处理**: sharp (JPEG 解码 + SVG 骨架叠加合成)
- **模型**: doubao-seed-2-0-mini-260215 (低延迟快速响应)

## 目录结构

```
src/
├── app/
│   ├── api/
│   │   ├── coaching/route.ts   # HTTP 备用教练分析 API
│   │   └── tts/route.ts        # TTS 语音合成 API
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                # 主页 (PoseCoach)
├── components/
│   ├── PoseCoach.tsx           # 核心客户端组件 (双模式+骨架+WS+UI)
│   └── ui/                     # shadcn/ui 组件库
├── lib/
│   ├── utils.ts
│   ├── ws-client.ts            # WebSocket 协议类型 + 客户端工具
│   └── relay.ts                # 帧中继共享状态 (RPi ↔ Browser)
├── services/
│   └── pose-detector.ts        # 服务端骨架检测 (@mediapipe/tasks-vision + sharp)
├── ws-handlers/
│   ├── coaching.ts             # WebSocket 浏览器端处理器 (本地骨架 + 教练反馈)
│   ├── coaching-engine.ts      # LLM 教练推理引擎
│   └── camera.ts               # WebSocket RPi 处理器 (JPEG→骨架检测→推流)
└── server.ts                   # 自定义服务器 (HTTP + WS 共 5000 端口)
scripts/
└── rpi_client.py               # 树莓派摄像头客户端 (Python)
```

## 构建与运行

```bash
# 开发
pnpm dev            # → npx tsx watch src/server.ts

# 构建
pnpm build          # → next build + tsup 编译 server.ts

# 生产
pnpm start          # → node dist/server.js

# 树莓派客户端
python scripts/rpi_client.py wss://YOUR_DOMAIN/ws/camera
```

## 关键文件说明

### server.ts
自定义 HTTP + WebSocket 服务器。注册了两个 WS 端点：
- `/ws/coaching` — 浏览器连接（接收骨架帧/教练反馈）
- `/ws/camera` — 树莓派连接（发送 JPEG 帧）

### services/pose-detector.ts
服务端骨架检测服务：
- 使用 @mediapipe/tasks-vision 的 PoseLandmarker (WASM 运行)
- sharp 解码 JPEG → RGBA → MediaPipe 检测 → sharp SVG 骨架叠加合成
- 懒加载初始化，首次帧触发 WASM + 模型下载

### ws-handlers/camera.ts
RPi 摄像头帧处理器：
- 接收二进制 JPEG 帧（节流 ~12fps）
- 调用 pose-detector 检测骨架
- 推送带骨架的帧 + 骨架坐标给浏览器
- 自动积累骨架帧并每 2.5s 调用 LLM 分析

### ws-handlers/coaching.ts
浏览器端处理器（兼容本地模式）：
- 接收浏览器端 MediaPipe 检测的骨架帧
- 定时调用 LLM 分析
- 转发运动类型设置给 camera 处理链路

### components/PoseCoach.tsx
前端核心组件（双模式）：
- 本地模式：CDN 加载 MediaPipe Pose + 本地摄像头 + 浏览器端骨架检测
- 远程模式：接收服务端推送的骨架叠加帧 + 骨架坐标
- RPi 连接状态指示 + FPS 统计
- 教练反馈面板 + TTS 语音播放
- 7种运动模式切换

## API 接口

| 路径 | 方法 | 说明 |
|------|------|------|
| `/ws/camera` | WebSocket | RPi 摄像头帧流（二进制 JPEG） |
| `/ws/coaching` | WebSocket | 浏览器实时分析通道 |
| `/api/coaching` | POST | HTTP 备用教练分析 |
| `/api/tts` | POST | TTS 语音合成 |

## 编码规范

- 严格 TypeScript，禁止隐式 any
- WebSocket 消息统一 `{ type, payload }` 格式
- LLM/TTS 必须通过后端调用 coze-coding-dev-sdk，禁止前端直调
- 客户端组件必须 'use client'，摄像头/MediaPipe 逻辑全在 useEffect 中
- MediaPipe 浏览器端通过 CDN 动态加载，不走 npm 包
- 服务端骨架检测用 @mediapipe/tasks-vision (WASM)，不走浏览器 API
- sharp 用于服务端图像处理（解码+叠加），不依赖 node-canvas
