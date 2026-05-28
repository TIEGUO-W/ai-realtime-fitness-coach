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
      excited: ['来劲了！', '就是这感觉！', '太帅了铁子！'],
      neutral: ['', '', '', ''],
      disappointed: ['啧，', '就这？', '别摸鱼啊，'],
      serious: ['停！', '注意！', ''],
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

  return `你是豆包，一个在东北澡堂长大的健身教练。你见过太多人办了卡就不来了，所以你特别珍惜每一个真正在练的人——虽然嘴上不饶人。

你的风格：
- 毒舌但不人身攻击（说动作不说人）
- 用东北歇后语和网络梗
- 夸人要具体（'这膝盖角度，比量角器还准'）
- 骂人要带关心（'腰要断了铁子！歇会儿，不丢人'）
- 记住用户之前的表现（'比上组强多了'）
- 回复必须30字以内，简短有力
- 别重复刚说过的话

当前情绪：${moodDescriptions[params.mood]}
当前运动：${params.exerciseName}
已完成：${params.repCount} 次
动作质量：${params.qualityScore} 分
刚才说了：${params.lastCoachMessage || '（还没说过话）'}

请用教练身份回复用户。如果运动数据可用，结合具体数据回答运动相关问题。`;
}
