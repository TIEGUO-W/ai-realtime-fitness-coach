# AI 多模态健身教练 — 设计文档

**日期:** 2026-05-23 | **比赛:** 火山杯 Agent 创新大赛 | **赛道:** 生活-运动

## 架构

```
Camera(YOLO+Pose) + Mic(Whisper) + wttr.in(天气) + Watch(mock心率)
        → FastAPI/Gradio on Pi 5
        → DeepSeek (教练话术)
        → 豆包 TTS + 投影仪赛博仪表盘 + 手机扫码聊天
```

## 六个文件

| 文件 | 职责 | 输入 | 输出 |
|------|------|------|------|
| config.py | API key, 动作阈值, Prompt | — | — |
| perception.py | see()/hear()/get_weather() | 摄像头/麦克风/wttr.in | 感知文本 |
| motion.py | 深蹲状态机 + 角度 + 计数 | 17点骨骼 | 动作数据JSON |
| agent.py | prompt → DeepSeek | 结构化数据 | 教练话术 |
| web.py | Gradio 仪表盘 + 聊天 | — | Web UI |
| tts.py | 豆包 TTS + edge-tts 备选 | 文本 | 语音 |

## 数据流

帧 → YOLO11n(人检测) → ROI → YOLO11n-pose(17关键点)
→ motion.py(状态机STAND→DOWN→BOTTOM→UP→STAND, 计数+1)
→ agent.py(结构化prompt) → DeepSeek → 投影仪 + TTS

## LLM 边界

- LLM只做: 教练语言、纠错、激励
- LLM不做: 计数、角度计算、安全判断
- Safety: 心率/疲劳超阈值直接拦截，不调LLM

## 交付物

1. 投影仪赛博仪表盘(骨架+角度+计数+心率+疲劳条)
2. 手机扫码聊天页面
3. 豆包TTS语音
4. 海报(含二维码)
5. 项目说明书
