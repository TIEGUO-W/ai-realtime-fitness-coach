/**
 * 语音命令解析器
 * 
 * 将 ASR 识别的文字解析为结构化命令
 * 支持：切换运动、控制会话、查询统计、聊天
 */

export type VoiceIntent =
  | { action: 'switch_exercise'; exercise: string }
  | { action: 'start' }
  | { action: 'pause' }
  | { action: 'stop' }
  | { action: 'reset' }
  | { action: 'query_stats' }
  | { action: 'chat'; text: string };

const EXERCISE_ALIASES: Record<string, string[]> = {
  squat: ['深蹲', '蹲', '下蹲', 'squats', 'squat'],
  deadlift: ['硬拉', '拉', '提拉', 'deadlift'],
  pushup: ['俯卧撑', '趴', '推', 'pushup', 'push up'],
  lunge: ['弓步', '弓步蹲', '箭步', 'lunge'],
  plank: ['平板支撑', '支撑', 'plank', '平板'],
  high_knees: ['高抬腿', '抬腿', '原地跑', 'high knees'],
  jumping_jack: ['开合跳', '开合', '跳', 'jumping jack'],
};

export function parseVoiceCommand(text: string): VoiceIntent {
  const t = text.toLowerCase().trim();

  // 切换运动
  for (const [exercise, aliases] of Object.entries(EXERCISE_ALIASES)) {
    for (const alias of aliases) {
      if (t.includes(alias)) {
        // 排除误匹配：如"深蹲多少个"是查询不是切换
        if (t.includes('多少') || t.includes('几个') || t.includes('几组')) {
          break;
        }
        if (t.includes('换') || t.includes('做') || t.includes('来') || t.includes('改成') || t.includes('切') || aliases.includes(t)) {
          return { action: 'switch_exercise', exercise };
        }
      }
    }
  }

  // 控制类
  if (t.includes('开始') || t.includes('继续') || t.includes('来吧') || t.includes('走起')) {
    return { action: 'start' };
  }
  if (t.includes('暂停') || t.includes('等一下') || t.includes('等等') || t.includes('停一下')) {
    return { action: 'pause' };
  }
  if (t.includes('停') || t.includes('结束') || t.includes('不做了') || t.includes('算了')) {
    return { action: 'stop' };
  }
  if (t.includes('重置') || t.includes('重来') || t.includes('清零') || t.includes('重新')) {
    return { action: 'reset' };
  }

  // 查询类
  if (t.includes('多少') || t.includes('几个') || t.includes('几组') || t.includes('统计') || t.includes('数据') || t.includes('成绩')) {
    return { action: 'query_stats' };
  }

  // 其他当聊天
  return { action: 'chat', text };
}

/**
 * 根据命令生成快速回复话术
 */
export function getVoiceCommandReply(
  intent: VoiceIntent,
  context: { exercise: string; repCount: number; stage: string }
): string | null {
  const exName = getExerciseNameCN(context.exercise);

  switch (intent.action) {
    case 'switch_exercise':
      if (intent.exercise === context.exercise) {
        return `你不正在做${exName}吗？专心点！`;
      }
      return `行，换成${getExerciseNameCN(intent.exercise)}，来吧！`;

    case 'start':
      return '走着！';
    case 'pause':
      return '行，歇会儿';
    case 'stop':
      return context.repCount > 0 ? `做了${context.repCount}个${exName}，不错！` : '这就歇了？';
    case 'reset':
      return '清零重来，这次得给力啊！';
    case 'query_stats':
      return `目前${exName}做了${context.repCount}个，${context.repCount >= 20 ? '牛逼啊铁子！' : context.repCount >= 10 ? '还行，继续！' : '才这么点？加把劲！'}`;

    case 'chat':
      return null; // 聊天类交给豆包处理
  }
}

function getExerciseNameCN(exercise: string): string {
  const names: Record<string, string> = {
    squat: '深蹲', deadlift: '硬拉', pushup: '俯卧撑',
    lunge: '弓步蹲', plank: '平板支撑', high_knees: '高抬腿', jumping_jack: '开合跳',
  };
  return names[exercise] || exercise;
}
