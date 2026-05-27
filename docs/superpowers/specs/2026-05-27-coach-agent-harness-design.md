# CoachAgent Harness — 设计规格

**日期**: 2026-05-27
**状态**: 已批准
**目标**: 两天内构建一个有状态、有记忆、稳定可靠的教练智能体，替代当前的"规则引擎+LLM贴片"架构

---

## 1. 问题陈述

当前 `coaching.ts` 的问题：

1. **语音单向** — 用户说话 → 关键词匹配 → 模板回复，无上下文
2. **话术模板固定** — `coaching-templates.ts` 每种运动 ~8 句话，5 分钟循环
3. **LLM 无状态调用** — 每次新对话，不记得 30 秒前说过什么
4. **TTS 链路分散** — synthQuick / doubao / legacy 三条路，无统一调度
5. **无语境融合** — 语音命令和教练反馈各自独立，不能"用户说动作对不→教练结合骨架回答"
6. **稳定性弱** — LLM 失败静默跳过，TTS 可能堆积，无熔断降级

## 2. 设计目标（优先级排序）

| # | 能力 | 含义 | 验收标准 |
|---|------|------|---------|
| 5 | 稳定可靠 | LLM挂不崩，TTS不堆积，断线可恢复 | LLM连续失败3次→自动切模板模式；队列>3时丢旧消息 |
| 1 | 连续对话 | 多轮上下文记忆 | 用户说"太累了"，教练回复能引用"你刚才做了15个深蹲" |
| 2 | 智能插话 | 骨架+优先级决策"该不该说" | 动作变形→立即打断；完美动作→30%概率夸 |
| 4 | 多模态理解 | 用户问题结合骨架数据 | "这个动作对吗"→回复包含具体角度/质量问题 |

## 3. 架构

### 3.1 分层（Phase 1 → Phase 2）

```
Phase 1: CoachSession (会话大脑)
─────────────────────────────────
骨架 → 规则算法 ─┐
语音 → ASR ──────┤──→ CoachSession ──→ 统一输出
定时器 ──────────┘        │              (coaching_feedback
                           │               + tts_ready)
              ┌────────────┴──────────┐
              │ · history[]           │
              │ · TTSQueue            │
              │ · CircuitBreaker      │
              │ · shouldSpeak()       │
              │ · buildContext()      │
              │ · MoodState           │
              └───────────────────────┘

Phase 2: CoachEventBus (在 A 基础上叠加)
────────────────────────────────────────
骨架事件 ──┐
语音事件 ──┤──→ PriorityQueue ──→ CoachSession
定时事件 ──┘    (去重+合并)
```

### 3.2 文件变更计划

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/ws-handlers/coach-session.ts` | **新增** | CoachSession 类：状态管理、记忆、决策、TTS调度、熔断 |
| `src/ws-handlers/coaching.ts` | **修改** | 移除散落状态/TTS/LLM调用，改为创建 CoachSession 实例并委托 |
| `src/ws-handlers/coaching-templates.ts` | 保留 | 作为 LLM 降级时的 fallback 话术源 |
| `src/ws-handlers/voice-command.ts` | 保留 | 短命令快速匹配（秒回路径），长文本交给 CoachSession |
| `src/ws-handlers/pose-algorithm.ts` | **不改** | 无变更 |
| `src/components/PoseCoach.tsx` | **小改** | 适配新的消息类型（如有） |

## 4. CoachSession 详细设计

### 4.1 核心接口

```typescript
class CoachSession {
  constructor(ws: WebSocket, config?: Partial<SessionConfig>)

  // ── 输入（观察通道）──
  observePose(result: AlgorithmResult): void
  hearVoice(text: string): void
  onTimer(type: 'idle' | 'periodic'): void

  // ── 生命周期 ──
  destroy(): void
}
```

### 4.2 记忆系统

```
ShortTermMemory (本会话内):
  conversationHistory: Message[]     // 最近 20 条（用户话 + 教练回复 + 骨架事件摘要）
  lastAlgorithmResult                // 最新骨架分析结果
  recentQualityScores: number[]      // 最近 10 次动作质量分（算趋势）
  sessionStats: {
    totalReps, bestStreak, startTime,
    exerciseBreakdown: { [exercise]: count }
  }
  lastCoachMessage: string           // 防止重复话术
  lastSpeechTime: number             // 做冷却判断
```

### 4.3 决策引擎 shouldSpeak()

```
输入 trigger 类型和优先级，输出 { should: bool, urgency: 'high'|'medium'|'low' }

规则（按顺序判断，命中即停止）:

1. 危险动作 (qualityScore < 30)
   → should: true, urgency: 'high'
   → 无视冷却，立刻打断

2. 用户刚说话 (trigger === 'voice')
   → should: true, urgency: 'medium'
   → 总是回复

3. 冷却检查 (距上次说话 < 2000ms)
   → should: false

4. 严重质量下降 (本次分数 - 上次分数 < -30)
   → should: true, urgency: 'high'

5. 完成一次动作 (completedRep === true)
   → should: Math.random() < 0.3, urgency: 'medium'

6. 里程碑 (repCount 在 {5,10,15,20,30,50} 中)
   → should: true, urgency: 'medium'

7. 空闲提醒 (idle > 10s 且之前活跃)
   → should: true, urgency: 'low'

8. 定时深度点评 (距上次 > 30s)
   → should: true, urgency: 'low'

9. 默认
   → should: false
```

### 4.4 话术生成策略（模板 vs LLM）

| 场景 | 路径 | 延迟目标 |
|------|------|---------|
| 短命令（"换深蹲""做了几个"） | 模板秒回 | <200ms |
| 完成一次鼓励 | 模板 | <100ms |
| 危险警告 | 模板 | <100ms |
| 用户闲聊 / 开放式问题 | LLM + 上下文 | <3s |
| 多模态："这个动作对吗" | LLM + 骨架摘要 | <3s |
| 空闲催促 | 模板 | <100ms |
| 定时深度点评 | LLM + 历史（带 fallback） | <5s |

LLM 调用模式：
1. 先准备 fallbackText（从 coaching-templates 取）
2. 构建上下文 → 调 LLM
3. 2.5s 超时 → 用 fallbackText
4. 成功 → 用 LLM 结果，写入 history

### 4.5 TTS 队列

```
TTSQueue {
  items: PriorityQueue<{text, priority, timestamp, id}>
  isSpeaking: boolean
  currentAudio: AudioRef | null
  dedupWindowMs: 5000  // 相同文本 5 秒内去重

  enqueue(text, priority):
    if priority === HIGH:
      清空队列，停止当前播放，立即播放
    if 与队尾文本相同且 timestamp 在 dedupWindowMs 内:
      丢弃
    if priority === LOW && queue.length >= 3:
      丢弃最旧的 LOW 项
    入队

  onEnd():
    播放下一个（队头出队）
}
```

### 4.6 熔断器

```
CircuitBreaker {
  state: 'closed' | 'open' | 'half_open'
  failureCount: number
  threshold: 3            // 连续失败 3 次 → open
  resetTimeoutMs: 30000   // open 30 秒后 → half_open
  lastFailureTime: number

  call(fn):
    if state === 'open':
      if (now - lastFailureTime > resetTimeoutMs):
        state = 'half_open'
      else:
        throw CircuitOpenError  // 调用方用 fallback

    try result = await fn()
      if state === 'half_open': state = 'closed'; failureCount = 0
      return result
    catch:
      failureCount++
      if failureCount >= threshold: state = 'open'; lastFailureTime = now
      throw  // 调用方用 fallback
}
```

### 4.7 人格与情绪

System Prompt 核心（注：不是规则列表，是角色设定）：

```
你是豆包，一个在东北澡堂长大的健身教练。你见过太多人办了卡
就不来了，所以你特别珍惜每一个真正在练的人——虽然嘴上不饶人。

风格：
- 毒舌但不人身攻击（说动作不说人）
- 用东北歇后语和网络梗
- 夸人要具体（'这膝盖角度，比量角器还准'）
- 骂人要带关心（'腰要断了铁子！歇会儿，不丢人'）
- 记住用户之前的表现（'比上组强多了'）
- 别重复刚说过的话

当前情绪：{{mood}}
最近表现：{{recentStats}}
刚才说了啥：{{lastCoachMessage}}
```

情绪状态机（简化版，后续可微调）：

```
兴奋 😤 ← 连续3次 perfect 或破纪录 → 平淡 😐
平淡 😐 ← 正常训练或恢复 → 平淡 😐
嫌弃 🙄 ← 10秒不动 或 质量分<40 → 平淡 😐（最多维持2句话）
严肃 😠 ← 危险动作（无视当前情绪，立即切换）
```

## 5. Phase 2: CoachEventBus（叠加层）

当 Phase 1 稳定运行后，引入事件总线解决并发输入问题：

```
CoachEventBus {
  queue: PriorityQueue<CoachEvent>
  session: CoachSession

  emit(event): 入队（带去重：同类型事件 500ms 内只保留最新）

  processLoop():
    while running:
      event = queue.dequeue()
      switch event.type:
        'pose'      → session.observePose(event.data)
        'voice'     → session.hearVoice(event.data)
        'idle'      → session.onTimer('idle')
        'periodic'  → session.onTimer('periodic')
}
```

事件去重规则：
- 骨架帧事件：只保留最新一帧（旧帧直接丢弃）
- 语音事件：不合并（每句都处理）
- 定时器事件：同类型 2 秒内去重

## 6. 验收测试

### 6.1 稳定性测试

- [ ] 停掉 DeepSeek API → 教练继续用模板话术，不崩溃
- [ ] 连续发 10 条语音命令 → TTS 队列最多保留 3 条，不堆积
- [ ] WS 断开重连 → repCount 恢复，对话可继续
- [ ] LLM 连续 3 次超时 → 自动熔断，30 秒后恢复

### 6.2 连续对话

- [ ] 用户说"太累了" → 教练回复引用之前做的次数
- [ ] 连续闲聊 5 轮 → 上下文保持连贯（不提无关话题）

### 6.3 智能插话

- [ ] 动作质量从 85 骤降到 40 → 立即警告（<500ms），无视冷却
- [ ] 完成一次动作 → ~30% 概率收到鼓励
- [ ] 10 秒没动 → 收到催促

### 6.4 多模态

- [ ] 用户说"这个动作对吗" → 回复包含具体质量描述（非通用模板）

## 7. 不在本次范围

- 用户长期画像（跨 session 记忆）
- Spline 3D 怪兽嘴部动画同步
- 树莓派远程模式优化（保持现有逻辑）
- 豆包平台智能体替换（后续迁移）
- Apple Watch 心率数据接入
