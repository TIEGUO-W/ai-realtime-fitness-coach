# AGENTS.md

## 项目概览

AI 实时运动教练 — 边缘端骨架检测 + 云端 LLM 智能分析 + TTS 语音反馈。
用户在浏览器中通过摄像头 + MediaPipe Pose 提取骨架坐标，通过 WebSocket 发送到云端进行 LLM 推理分析，实时返回动作指导和语音反馈。

### 架构

```
浏览器 (MediaPipe Pose) → WebSocket → 云端 (LLM 推理 + TTS) → 反馈
   ↑ 摄像头 + 骨架提取        ↑ 骨架 JSON ~2KB/帧     ↑ 文字 + 语音
```

核心优化：只传骨架坐标 JSON，不传视频流，极大降低带宽和延迟。

## 技术栈

- **Framework**: Next.js 16 (App Router + 自定义服务器)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI**: shadcn/ui + Tailwind CSS 4
- **WebSocket**: ws (noServer 模式，与 Next.js 共用 5000 端口)
- **AI**: coze-coding-dev-sdk (LLMClient + TTSClient)
- **骨架检测**: MediaPipe Pose (CDN 加载，浏览器端运行)
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
│   ├── PoseCoach.tsx           # 核心客户端组件 (摄像头+骨架+WS+UI)
│   └── ui/                     # shadcn/ui 组件库
├── lib/
│   ├── utils.ts
│   └── ws-client.ts            # WebSocket 协议类型 + 客户端工具
├── ws-handlers/
│   ├── coaching.ts             # WebSocket 骨架帧处理器
│   └── coaching-engine.ts      # LLM 教练推理引擎
└── server.ts                   # 自定义服务器 (HTTP + WS 共 5000 端口)
```

## 构建与运行

```bash
# 开发
pnpm dev            # → npx tsx watch src/server.ts

# 构建
pnpm build          # → next build + tsup 编译 server.ts

# 生产
pnpm start          # → node dist/server.js
```

## 关键文件说明

### server.ts
自定义 HTTP + WebSocket 服务器。注册了 `/ws/coaching` 端点。
开发环境不销毁未注册的 upgrade 请求（Next.js HMR 需要）。

### ws-handlers/coaching-engine.ts
核心推理逻辑：提取关键关节 → 计算角度和指标 → 调用 LLM → 返回结构化反馈。
每 2.5 秒分析一次积累的骨架帧，使用 mini 模型降低延迟。

### components/PoseCoach.tsx
前端核心组件：
- 通过 CDN 动态加载 MediaPipe Pose
- 摄像头画面 + Canvas 骨架叠加（镜像翻转）
- WebSocket 实时通信
- 教练反馈面板 + TTS 语音播放
- 7种运动模式切换

## API 接口

| 路径 | 方法 | 说明 |
|------|------|------|
| `/ws/coaching` | WebSocket | 实时骨架分析（主通道） |
| `/api/coaching` | POST | HTTP 备用教练分析 |
| `/api/tts` | POST | TTS 语音合成 |

## 编码规范

- 严格 TypeScript，禁止隐式 any
- WebSocket 消息统一 `{ type, payload }` 格式
- LLM/TTS 必须通过后端调用 coze-coding-dev-sdk，禁止前端直调
- 客户端组件必须 'use client'，摄像头/MediaPipe 逻辑全在 useEffect 中
- MediaPipe 通过 CDN 动态加载，不走 npm 包（避免 WASM 路径问题）
