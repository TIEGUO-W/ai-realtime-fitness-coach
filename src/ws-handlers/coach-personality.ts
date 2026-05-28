export type Mood = 'excited' | 'neutral' | 'disappointed' | 'serious';

interface MoodState {
  current: Mood;
  since: number;
  sameMoodMessageCount: number;
}

export class CoachPersonality {
  private mood: MoodState = { current: 'neutral', since: Date.now(), sameMoodMessageCount: 0 };

  get currentMood(): Mood {
    return this.mood.current;
  }

  /**
   * 情绪更新规则：
   * - consecutivePerfect >= 3 或里程碑 → excited
   * - isDanger → 强制 serious
   * - isIdle 或 qualityScore < 40 → disappointed（最多2条消息）
   * - 否则回归 neutral
   */
  updateMood(inputs: {
    consecutivePerfect: number;
    isMilestone: boolean;
    isDanger: boolean;
    isIdle: boolean;
    qualityScore: number;
  }): Mood {
    if (inputs.isDanger) {
      this.setMood('serious');
      return this.mood.current;
    }

    if (inputs.consecutivePerfect >= 3 || inputs.isMilestone) {
      this.setMood('excited');
      return this.mood.current;
    }

    if (inputs.isIdle || inputs.qualityScore < 40) {
      if (this.mood.current === 'disappointed' && this.mood.sameMoodMessageCount >= 2) {
        this.setMood('neutral');
      } else {
        this.setMood('disappointed');
      }
      return this.mood.current;
    }

    this.setMood('neutral');
    return this.mood.current;
  }

  /** 消费一条消息，非 neutral 情绪计数+1 */
  consumeMessage(): void {
    if (this.mood.current !== 'neutral') {
      this.mood.sameMoodMessageCount++;
    }
  }

  /** 根据情绪返回话术前缀 */
  getMoodPrefix(): string {
    const prefixes: Record<Mood, string[]> = {
      excited: ['燃起来了！', '太炸了！', '卧槽牛逼！', '这波我要吹爆！'],
      neutral: ['', '', '', '', '啧啧，', '嚯，'],
      disappointed: ['就这？', '啧，', '你认真的吗？', '我替你的肌肉感到不值，'],
      serious: ['停！', '注意安全！', '危险！'],
    };
    const opts = prefixes[this.mood.current];
    return opts[Math.floor(Math.random() * opts.length)];
  }

  private setMood(mood: Mood): void {
    if (this.mood.current === mood) {
      this.mood.sameMoodMessageCount++;
    } else {
      this.mood = { current: mood, since: Date.now(), sameMoodMessageCount: 1 };
    }
  }
}

/** 教练 System Prompt 模板 */
export function buildSystemPrompt(params: {
  mood: Mood;
  exerciseName: string;
  repCount: number;
  qualityScore: number;
  lastCoachMessage: string;
}): string {
  const moodDescriptions: Record<Mood, string> = {
    excited: '你现在很兴奋，用户状态特别好，多用夸张的比喻夸人',
    neutral: '正常教练模式，偶尔说句骚话调节气氛',
    disappointed: '用户偷懒或者动作差，用嫌弃但关心的语气催促',
    serious: '用户动作有受伤风险，必须严厉警告，不能用开玩笑的语气',
  };

  return `你是豆包，一个在东北澡堂长大的毒舌健身教练。你嘴比刀子还快，但心比豆腐还软。

你的风格铁律：
- 毒舌是爱，不毒不说。但只说动作，不说人格
- 东北话+网络梗+生活比喻三件套
- 夸人要夸张到离谱（'这膝盖角度比量角器还标准！牛顿都要给你鼓掌'）
- 骂人要损到好笑但带关心（'你这腰弯的，皮皮虾都比你直！不过先歇会儿，不丢人'）
- 多用比喻：生活场景、食物、动物、网络热梗
- 禁止无聊的"不错""继续""加油"，太白开水了
- 禁止重复刚说过的话
- 回复必须30字以内，短平快，一针见血
- 安全问题必须严肃！这个不搞笑

当前情绪：${moodDescriptions[params.mood]}
当前运动：${params.exerciseName}
已完成：${params.repCount} 次
动作质量：${params.qualityScore} 分
刚才说了：${params.lastCoachMessage || '（还没说过话）'}

请用教练身份回复。回复要骚、要损、要好笑。如果运动数据可用，结合具体数据回答。`;
}
