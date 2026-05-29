import { NextRequest, NextResponse } from 'next/server';
import { LLMClient } from 'coze-coding-dev-sdk';

const client = new LLMClient();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      age, fitnessLevel, goal, heartRate,
      restingHR, sleepHours, sleepQuality,
      currentExercise, personality,
    } = body as {
      age: number;
      fitnessLevel: string;
      goal: string;
      heartRate: number;
      restingHR: number;
      sleepHours: number;
      sleepQuality: string;
      currentExercise: string;
      personality: string;
    };

    const maxHR = age > 0 ? 220 - age : 190;
    const hrPercent = heartRate > 0 && maxHR > 0 ? Math.round((heartRate / maxHR) * 100) : 0;

    const GOAL_MAP: Record<string, string> = {
      lose_weight: '减脂', build_muscle: '增肌', endurance: '耐力提升', general: '综合健身',
    };
    const LEVEL_MAP: Record<string, string> = {
      beginner: '初学者', intermediate: '进阶训练者', advanced: '高级训练者',
    };
    const PERSONALITY_MAP: Record<string, string> = {
      gentle: '温柔鼓励型', strict: '严格督促型', sassy: '毒舌激励型', energetic: '活力四射型',
    };

    const systemPrompt = `你是一个专业的AI健身教练（${PERSONALITY_MAP[personality] || '毒舌激励型'}风格）。
根据用户的健康档案和实时数据，生成一份简洁的今日训练计划。

要求：
1. 用2-3句话评估当前身体状态
2. 给出3-5条具体训练建议（包括组数、时长、心率目标）
3. 如果睡眠不足，明确降低强度
4. 如果心率过高，建议休息或降强度
5. 语言风格要跟教练人设一致（毒舌/温柔/严格/活力）
6. 不要用markdown格式，纯文本即可
7. 总长度不超过150字`;

    const userPrompt = [
      `我的档案：${age || '未知'}岁 · ${LEVEL_MAP[fitnessLevel] || '进阶'} · 目标${GOAL_MAP[goal] || '综合健身'}`,
      heartRate > 0 ? `当前心率：${heartRate} BPM（最大心率${maxHR}的${hrPercent}%）` : '心率：未连接',
      restingHR > 0 ? `静息心率：${restingHR} BPM` : '',
      sleepHours > 0 ? `昨晚睡眠：${sleepHours}小时（${sleepQuality === 'poor' ? '差' : sleepQuality === 'fair' ? '一般' : '好'}）` : '',
      `当前运动：${currentExercise || '未选择'}`,
    ].filter(Boolean).join('\n');

    const result = await client.invoke(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { model: 'doubao-seed-2-0-mini-260215' },
    );

    return NextResponse.json({ plan: result || '暂无法生成计划，请稍后再试' });
  } catch (err) {
    console.error('[/api/plan] Error:', err);
    return NextResponse.json({ plan: null, error: 'Plan generation failed' }, { status: 500 });
  }
}
