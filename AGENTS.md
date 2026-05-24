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
- **UI**: 赛博朋克风格 Dashboard + Tailwind CSS 4 + Spline 3D 怪物模型
- **WebSocket**: ws (noServer 模式，与 Next.js 共用 5000 端口)
- **AI**: coze-coding-dev-sdk (LLMClient + TTSClient)
- **3D**: @splinetool/react-spline (运动怪物模型)
- **特效**: canvas-confetti (里程碑庆祝)
- **骨架检测-本地**: MediaPipe Pose (CDN 加载，浏览器端 WebGL)
- **骨架检测-远程**: @mediapipe/tasks-vision (Node.js WASM) + sharp (图像解码/叠加)
- **图像处理**: sharp (JPEG 解码 + SVG 骨架叠加合成)
- **模型**: doubao-seed-2-0-mini-260215 (低延迟快速响应)

## 目录结构

```
src/
├── app/
│   ├── api/
│   │   ├── asr/route.ts         # ASR 语音识别 API
│   │   ├── coaching/route.ts    # HTTP 备用教练分析 API
│   │   └── tts/route.ts         # TTS 语音合成 API
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                 # 主页 (动态加载 Dashboard)
├── components/
│   ├── dashboard/
│   │   ├── Dashboard.tsx        # 主仪表盘布局 (左60%+右40%)
│   │   ├── LeftPanel.tsx        # 左面板 (3D怪物+摄像头+视频区)
│   │   ├── RightPanel.tsx       # 右面板 (统计+控制+教练+语音)
│   │   ├── StatsRow.tsx         # 统计数据行 (计数/卡路里/时长/心率)
│   │   ├── CustomPlanModal.tsx  # 自定义训练计划弹窗
│   │   └── WorkoutSummaryModal.tsx # 训练总结弹窗
│   └── ui/                      # shadcn/ui 组件库
├── data/
│   ├── monsters.ts              # 7种运动3D怪物数据 (Spline场景URL+颜色)
│   └── mockData.ts              # 模拟数据 (开发用)
├── lib/
│   ├── utils.ts
│   ├── ws-client.ts             # WebSocket 协议类型 + 客户端工具
│   └── relay.ts                 # 帧中继共享状态 (RPi ↔ Browser)
├── services/
│   ├── usePipeline.ts           # WebSocket pipeline hook (连接+MediaPipe+LLM+TTS)
│   └── pose-detector.ts         # 服务端骨架检测 (@mediapipe/tasks-vision + sharp)
├── types/
│   └── dashboard.ts             # Dashboard 类型定义
├── utils/
│   ├── coachVoice.ts            # 教练话术生成 (7种人格×多场景)
│   └── confettiEffects.ts       # 庆祝特效 (里程碑/成就)
├── ws-handlers/
│   ├── coaching.ts              # WebSocket 浏览器端处理器 (双层架构)
│   ├── coaching-engine.ts       # LLM 教练推理引擎
│   ├── coaching-templates.ts    # 快速层骚话模板库
│   ├── pose-algorithm.ts        # v3骨架算法 (清洗+EMA+6种运动+质量评分)
│   ├── voice-command.ts         # 语音意图解析器
│   └── camera.ts                # WebSocket RPi 处理器 (JPEG→骨架→推流)
└── server.ts                    # 自定义服务器 (HTTP + WS 共 5000 端口)
scripts/
└── rpi_client.py                # 树莓派摄像头客户端 (Python)
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

### services/usePipeline.ts
前端核心 hook，管理完整 pipeline：
- WebSocket 连接 /ws/coaching（自动重连）
- 本地模式：MediaPipe Pose CDN 加载 + 浏览器端骨架检测
- 发送骨架帧到后端 → 接收教练反馈 + TTS 音频
- 语音交互：Web Speech API / MediaRecorder 降级
- 训练会话管理（开始/暂停/结束/切换运动）
- 双层话术：快速层（模板+SDK TTS 1-2s）+ 深度层（豆包智能体 30s）

### components/dashboard/Dashboard.tsx
赛博朋克风格主仪表盘：
- 左侧 60%：3D 怪物模型 (Spline) + 摄像头视频 + 骨架叠加
- 右侧 40%：统计面板 + 教练反馈 + 语音交互 + 控制栏
- 7种运动模式切换（每种对应不同3D怪物）
- 里程碑庆祝 (canvas-confetti)

### ws-handlers/coaching.ts
浏览器端处理器（双层架构）：
- 快速层：骚话模板库 + SDK TTSClient (1-2s)
- 深度层：豆包智能体教练 (30s 间隔)
- 语音命令处理（意图解析+ASR）

## API 接口

| 路径 | 方法 | 说明 |
|------|------|------|
| `/ws/camera` | WebSocket | RPi 摄像头帧流（二进制 JPEG） |
| `/ws/coaching` | WebSocket | 浏览器实时分析通道 |
| `/api/coaching` | POST | HTTP 备用教练分析 |
| `/api/tts` | POST | TTS 语音合成 |
| `/api/asr` | POST | ASR 语音识别 |

## 编码规范

- 严格 TypeScript，禁止隐式 any
- WebSocket 消息统一 `{ type, payload }` 格式
- LLM/TTS 必须通过后端调用 coze-coding-dev-sdk，禁止前端直调
- 客户端组件必须 'use client'，摄像头/MediaPipe 逻辑全在 useEffect 中
- MediaPipe 浏览器端通过 CDN 动态加载，不走 npm 包
- 服务端骨架检测用 @mediapipe/tasks-vision (WASM)，不走浏览器 API
- sharp 用于服务端图像处理（解码+叠加），不依赖 node-canvas
