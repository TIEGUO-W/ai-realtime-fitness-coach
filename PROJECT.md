# AI 生活搭子 — 项目设计文档

## 一句话定位

一个能看见你、听见你、感知环境、用一整面墙回应你的实体 AI 生活助手。
不是手机 App，是一个**活在房间里的豆包**。

---

## 硬件清单

| 硬件 | 作用 | 连接方式 |
|------|------|---------|
| 树莓派 5 (8G) | 主控大脑，跑所有核心逻辑 | — |
| 大疆 Action 4 | 摄像头 + 麦克风，感知视觉和语音 | USB-C → Pi USB 3.0 (UVC/UAC) |
| DHT11/DHT22 温湿度传感器 | 感知房间环境 | 3pin 杜邦线 → Pi GPIO |
| Apple Watch | 心率、加速度计、运动数据 | Watch → iPhone → HTTP POST → Pi |
| 投影仪 | 全屏展示：仪表盘、欢迎画面、AI 回复 | micro HDMI → 投影仪 |
| USB 音箱 (可选) | TTS 语音播报 | Pi USB 口 / 3.5mm 音频口 |
| 网线 | 笔记本 ↔ Pi 直连（最稳网络方案） | 水晶头两端 |

---

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│                     感知层                           │
│                                                     │
│  Action 4 摄像头 ──→ YOLO11n ──→ 画面里有谁、什么    │
│  Action 4 麦克风 ──→ Whisper ──→ 用户说了什么        │
│  DHT11 传感器   ──→ GPIO   ──→ 温度/湿度            │
│  Apple Watch    ──→ iPhone ──→ 心率/运动数据        │
│                                                     │
└──────────────────────┬──────────────────────────────┘
                       │ 感知结果（纯文本 JSON）
                       ▼
┌─────────────────────────────────────────────────────┐
│                     推理层                           │
│                                                     │
│  DeepSeek API (deepseek-chat)                       │
│  System Prompt: "你是 AI 生活搭子，你能看见、听见、    │
│   感知环境数据。用自然的方式跟用户交互。"              │
│                                                     │
└──────────────────────┬──────────────────────────────┘
                       │ AI 回复文本
                       ▼
┌─────────────────────────────────────────────────────┐
│                     输出层                           │
│                                                     │
│  Gradio 网页 ──→ 手机扫码显示                        │
│  投影仪       ──→ 全屏 Kiosk 模式                    │
│  edge-tts     ──→ 语音播报                          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 软件模块 & 分工

### 模块 1：感知层 (perception.py) — 树莓派 / 王

| 函数 | 功能 | 输入 | 输出 |
|------|------|------|------|
| `see()` | 抓一帧 → YOLO 检测 | 摄像头 | `{"objects": ["1 个人", "1 个苹果"], "summary": "..."}` |
| `hear(n)` | 录 n 秒 → Whisper 转写 | 麦克风 | `"我今天应该做什么运动"` |
| `read_dht()` | 读 GPIO 温湿度 | DHT11 pin 4 | `{"temperature": 26.5, "humidity": 62}` |
| `sense()` | 一键采集所有感知 | — | `{"visual": ..., "speech": ..., "dht": ...}` |

**依赖：** ultralytics, openai-whisper, Adafruit_DHT, sounddevice

### 模块 2：Agent 核心 (agent.py) — 树莓派 / 王

| 功能 | 说明 |
|------|------|
| `build_prompt(perception)` | 把感知数据拼成给 LLM 的自然语言 |
| `chat(perception, history)` | 调 DeepSeek API，返回回复 |
| `run_loop()` | 主循环：感知 → 推理 → 输出 |

### 模块 3：传感器数据接收 (sensor_api.py) — 树莓派 / 王

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sensor` | POST | 接收 iPhone 转发来的 Watch 数据 |
| `/api/state` | GET | 返回当前所有传感器快照 |

**FastAPI + uvicorn，跑在 Pi 上。**

### 模块 4：Web 前端 (web.py) — 队友 A

用 Gradio 或纯 HTML/CSS/JS 实现：

- **手机端（扫码进入）**
  - 聊天框：文字输入 + 显示 AI 回复
  - 语音按钮：手机麦克风录音 → 发给 Pi → Pi 转写 → DeepSeek 回复
- **投影仪端（全屏 Dashboard）**
  - 实时摄像头画面（带 YOLO 检测框）
  - 温湿度显示
  - AI 对话历史
  - 运动数据仪表盘（心率曲线、运动时间）

**两个页面可以是同一个 URL，用 CSS media query 或 URL 参数区分布局。**

### 模块 5：iPhone 快捷指令 — 队友 B

```
iPhone 快捷指令（无需写 App）:
  循环:
    "获取健康样本" → 心率、步数
    "获取URL内容" → POST 到 http://<Pi_IP>:8080/api/sensor
    等待 5 秒
```

### 模块 6：TTS 语音合成 — 队友 A 或王

```python
import edge_tts, asyncio, os
async def speak(text):
    tts = edge_tts.Communicate(text, "zh-CN-XiaoxiaoNeural")
    await tts.save("/tmp/reply.mp3")
    os.system("cvlc --play-and-exit /tmp/reply.mp3")
```

---

## Demo 交互流程（评委体验）

```
1. 评委走近展位
   → YOLO 检测到人 → 投影仪显示欢迎画面
   → TTS："你好！我是你的 AI 生活搭子，今天有什么可以帮你？"

2. 评委说："帮我看看我现在状态怎么样"
   → Whisper 转写 → DeepSeek 推理
   → Agent："房间 26 度有点热，你心率 85 挺正常的。
      你手上那个苹果看起来很新鲜，要帮你规划今天的饮食吗？"

3. 评委拿 Apple Watch 做了几个深蹲
   → Watch 数据实时传到投影仪：心率从 85 → 120
   → Agent："心率上来了！你刚才做了 8 个深蹲，再加 2 个凑一组？"

4. 评委扫码带走体验链接
   → 手机上继续跟 Agent 聊天
```

---

## 开发顺序（按优先级）

### Phase 1：核心链路（先打通，2 小时）

- [ ] 烧录 Pi 系统，SSH 进去
- [ ] 网线直连 Pi ↔ 笔记本
- [ ] 装 Python 依赖
- [ ] 验证摄像头 (Action 4) 和麦克风
- [ ] 跑通 `sense()` + `chat()` + Gradio 出页面
- [ ] 投影仪接上，全屏显示

**→ 此时已有一个能扫码体验的 Agent（MVP 达成）**

### Phase 2：加传感器（1 小时）

- [ ] DHT11 接 GPIO，读温湿度
- [ ] 感知数据里加入环境信息
- [ ] 投影仪 Dashboard 显示温湿度

### Phase 3：加 Apple Watch（1.5 小时）

- [ ] Pi 上写 `/api/sensor` 接收端点
- [ ] iPhone 上建快捷指令转发 Watch 数据
- [ ] 投影仪 Dashboard 显示心率曲线

### Phase 4：加 TTS（0.5 小时）

- [ ] 装 edge-tts
- [ ] Agent 回复同时语音播报

### Phase 5：打磨（剩余时间）

- [ ] System Prompt 优化（让 Agent 性格鲜明）
- [ ] 投影仪 UI 美化
- [ ] 海报制作
- [ ] 项目说明书撰写

---

## 关键配置文件 (config.py)

```python
# 树莓派 IP（网线直连）
PI_IP = "192.168.1.10"

# DeepSeek API
LLM_CONFIG = {
    "base_url": "https://api.deepseek.com",
    "api_key": "你的key",
    "model": "deepseek-chat",
}

# 摄像头
CAMERA_ID = 1       # Action 4 UVC
AUDIO_DEVICE = 1    # Action 4 Mic (OsmoAct)
```

---

## Pi 联网方案

| 方案 | 场景 |
|------|------|
| **网线直连（首选）** | 笔记本 ↔ Pi 一根线，静态 IP，零延迟 |
| **手机热点** | 备用，Pi 和笔记本连同一个热点 |

Pi 端静态 IP 设置（烧录后在 `/etc/dhcpcd.conf` 追加）：
```
interface eth0
static ip_address=192.168.1.10/24
```

笔记本端：网络适配器 → IPv4 → `192.168.1.1/24`。

---

## 记忆点（评委走了之后还记得什么）

1. "那个 AI 不是手机 App，是一个**能看见你、有整面墙当表情的实体**"
2. "它能感知房间温湿度、用户心率、画面里的人——**比豆包更像一个人**"
3. "扫码就能带走，但现场的体验比手机好 10 倍"
