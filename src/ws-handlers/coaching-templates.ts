/**
 * 骚话模板库 — 规则算法直接出话术，不走 LLM，毫秒级响应
 * 按运动类型 × 阶段 × 质量分类，随机选一句
 */

// 质量等级
type QualityLevel = 'perfect' | 'good' | 'adjust' | 'warning' | 'error';

// 话术模板结构
interface CoachingTemplates {
  // 计数鼓励（每 N 次触发）
  milestones: Record<number, string[]>;
  // 按质量分级
  byQuality: Record<QualityLevel, string[]>;
  // 按阶段
  byStage: {
    up: string[];
    down: string[];
    hold: string[];
    transition: string[];
  };
  // 休息/停顿太久
  idle: string[];
}

// ============ 通用骚话（所有运动共享） ============
const commonTemplates: CoachingTemplates = {
  milestones: {
    5: ['才5个？热身都算不上吧铁子', '5个了，你确定不是在数羊？'],
    10: ['10个了！有点东西啊', '两位数了，给你鼓个掌先'],
    15: ['15！我还以为你早歇了呢', '15个，今天状态可以啊'],
    20: ['20个！你这是要卷死谁？', '20！再这么练要上天了'],
    30: ['30！你是认真的吗？太猛了', '30个！我服了，你继续'],
    50: ['50！你在拍短视频吧？', '50个...我怀疑你开挂了'],
  },
  byQuality: {
    perfect: ['漂亮！教科书级别', '这动作，教练看了都自闭', '太标准了，别人跟你学吧'],
    good: ['不错不错，继续保持', '这波可以，稳住', '有那味儿了'],
    adjust: ['稍微调一下就更完美了', '差一丢丢，微调就好', '别急，细节再抠抠'],
    warning: ['诶诶诶，注意姿势', '你这动作跑偏了啊', '停停停，先调好再继续'],
    error: ['这什么操作？重来！', '你这动作我没法看', '兄弟，安全第一啊'],
  },
  byStage: {
    up: ['起得利索', '漂亮，起来', '到位'],
    down: ['蹲下去！别偷懒', '再低点再低点', '往下走，别含糊'],
    hold: ['稳住！别抖', '保持住，我看着呢', '定住！数三秒'],
    transition: ['准备好了吗？', '来，继续', '别愣着，动起来'],
  },
  idle: ['人呢？跑了？', '还练不练了？', '休息够了吧，继续啊', '我等得花都开了', '别摸鱼了！起来动！'],
};

// ============ 深蹲专属 ============
const squatTemplates: CoachingTemplates = {
  milestones: commonTemplates.milestones,
  byQuality: {
    perfect: ['这蹲得，屁股都要贴地了', '完美深蹲，膝盖没有内扣，给你满分', '教科书深蹲！拍下来发朋友圈'],
    good: ['蹲得还行，屁股再往后坐点就更骚了', '不错，膝盖方向对头', '这深度可以，继续维持'],
    adjust: ['膝盖别内扣！往脚尖方向打开', '屁股再往后坐，想象后面有椅子', '腰挺直，别弯腰驼背的'],
    warning: ['膝盖快超脚尖了，注意！', '腰别弯！会废的', '起来太快了，控制住节奏'],
    error: ['你这蹲的啥？重新来！', '膝盖严重内扣，停下调整', '腰都弯成虾了，安全第一啊铁子'],
  },
  byStage: {
    up: ['起来干脆点', '起身夹臀！', '顶上去'],
    down: ['往下坐！想象后面有凳子', '再低点！别半蹲忽悠我', '慢点下，控制住'],
    hold: ['底部停一秒！', '定住，别弹', '最低点稳住'],
    transition: ['准备，下一个', '来，继续蹲', '别歇太久'],
  },
  idle: commonTemplates.idle,
};

// ============ 硬拉专属 ============
const deadliftTemplates: CoachingTemplates = {
  milestones: commonTemplates.milestones,
  byQuality: {
    perfect: ['这硬拉，腰直得跟尺子似的', '完美！背没弯，杠铃贴腿走', '教科书硬拉，发网上能当教程'],
    good: ['背保持得不错', '还行，发力顺序对头', '髋关节驱动，可以'],
    adjust: ['杠铃要贴着腿走，别远离身体', '背再收紧点', '别弯腰！用腿和髋发力'],
    warning: ['背弯了！危险！', '杠铃离身体太远了', '别用腰拉！用臀和腿'],
    error: ['你这硬拉是在许愿吗？停！', '腰弯成C了，会受伤的！', '放下重来，安全第一'],
  },
  byStage: {
    up: ['拉起来！夹臀！', '锁定！站直', '顶髋夹臀'],
    down: ['控制下放，别砸', '慢慢放，离心也很重要', '贴腿下放'],
    hold: ['顶部锁定住', '站直，肩胛骨收紧', '别急着放'],
    transition: ['下一个', '准备，拉', '握紧，来'],
  },
  idle: commonTemplates.idle,
};

// ============ 俯卧撑专属 ============
const pushupTemplates: CoachingTemplates = {
  milestones: commonTemplates.milestones,
  byQuality: {
    perfect: ['这俯卧撑，胸都快贴地了', '身体一条线，完美', '教科书！核心收紧了'],
    good: ['还行，身体比较稳', '不错，幅度可以', '继续，保持节奏'],
    adjust: ['屁股别翘起来！', '身体要一条线，别塌腰', '下去再低点'],
    warning: ['塌腰了！核心收紧', '半程俯卧撑不算啊', '起来别锁死手肘'],
    error: ['你这是俯卧撑还是蠕动？', '塌成虾了，重来！', '先做跪姿的，别硬撑'],
  },
  byStage: {
    up: ['推起来！', '撑住！', '手臂伸直'],
    down: ['胸口贴近地面', '慢点下，别砸', '肘部45度，别打太开'],
    hold: ['底部停住', '核心绷紧', '别塌腰'],
    transition: ['继续', '下一个', '别停'],
  },
  idle: commonTemplates.idle,
};

// ============ 弓步蹲专属 ============
const lungeTemplates: CoachingTemplates = {
  milestones: commonTemplates.milestones,
  byQuality: {
    perfect: ['这弓步蹲，前后脚角度完美', '膝盖刚好90度，漂亮', '稳如老狗，标准'],
    good: ['还行，步幅可以', '不错，前膝没过脚尖', '稳住了'],
    adjust: ['步子再大点', '前膝别超脚尖', '后腿膝盖轻触地'],
    warning: ['身体别前倾！', '前膝超脚尖了', '重心不稳啊'],
    error: ['你这弓步是在跳房子吗？', '膝盖内扣严重，停下', '先扶墙练，别摔了'],
  },
  byStage: {
    up: ['站起来！', '蹬地起来', '到位'],
    down: ['蹲下去，后膝触地', '慢点下', '控制住'],
    hold: ['底部稳住', '别晃', '核心收紧'],
    transition: ['换腿', '准备下一个', '稳住节奏'],
  },
  idle: commonTemplates.idle,
};

// ============ 平板支撑专属 ============
const plankTemplates: CoachingTemplates = {
  milestones: {
    10: ['10秒了，这才哪到哪', '10秒，勉强算热身'],
    20: ['20秒，还行', '坚持住，才20秒'],
    30: ['30秒！这才开始', '半分钟了，稳住'],
    45: ['45秒，核心在燃烧吧？', '快一分钟了，撑住'],
    60: ['一分钟！可以啊', '60秒！给你点个赞'],
    90: ['一分半！你是铁板吗？', '90秒，核心炸裂了吧'],
    120: ['两分钟！大神啊', '120秒，我服了'],
  },
  byQuality: {
    perfect: ['身体一条线，完美', '核心绷得紧，好样的', '标准平板，拍下来'],
    good: ['不错，比较稳', '还行，保持', '继续，别松'],
    adjust: ['屁股别翘', '腰别塌下去', '肩胛骨撑开'],
    warning: ['塌腰了！核心收紧', '屁股太高了，压下去', '别抖，呼吸'],
    error: ['都塌地上了还撑什么！', '重来，先跪姿练', '你这叫蛇形支撑，不叫平板'],
  },
  byStage: {
    up: commonTemplates.byStage.up,
    down: commonTemplates.byStage.down,
    hold: ['稳住！', '呼吸，别憋气', '核心收紧，时间还长', '想想你的腹肌', '再撑5秒！'],
    transition: commonTemplates.byStage.transition,
  },
  idle: commonTemplates.idle,
};

// ============ 高抬腿专属 ============
const highKneeTemplates: CoachingTemplates = {
  milestones: commonTemplates.milestones,
  byQuality: {
    perfect: ['这频率，跑酷选手啊', '膝盖到腰了，完美', '核心稳+抬腿高，牛'],
    good: ['频率不错', '还行，继续提速', '节奏可以'],
    adjust: ['腿再抬高点', '摆臂配合起来', '脚掌着地，别脚跟砸地'],
    warning: ['腿抬得不够高', '别弯腰！', '节奏乱了，稳住'],
    error: ['这抬腿...你在原地踏步？', '弯腰驼背的，重来', '腿抬到腰！'],
  },
  byStage: {
    up: ['抬！抬！抬！', '膝盖往上顶', '再高点'],
    down: ['快下快上', '脚掌落地', '弹起来'],
    hold: ['保持频率！', '别减速', '最后冲刺'],
    transition: ['继续！别停', '加速！', '再来一组'],
  },
  idle: commonTemplates.idle,
};

// ============ 开合跳专属 ============
const jumpingJackTemplates: CoachingTemplates = {
  milestones: commonTemplates.milestones,
  byQuality: {
    perfect: ['这开合跳，协调性满分', '手脚同步，完美', '节奏感十足'],
    good: ['还行，比较协调', '节奏不错', '继续这个速度'],
    adjust: ['手要举过头顶', '跳开再大点', '脚并拢要快'],
    warning: ['手脚不同步啊', '跳高点', '别偷懒半跳'],
    error: ['你这是在跳什么舞？', '手脚各跳各的是吧', '先慢动作练协调'],
  },
  byStage: {
    up: ['打开！', '跳开！手举起来', '展开'],
    down: ['并拢！', '收回来', '手放下来'],
    hold: ['保持节奏', '速度稳住', '别减速'],
    transition: ['继续跳', '加速！', '别停'],
  },
  idle: commonTemplates.idle,
};

// ============ 运动模板映射 ============
const EXERCISE_TEMPLATES: Record<string, CoachingTemplates> = {
  squat: squatTemplates,
  deadlift: deadliftTemplates,
  pushup: pushupTemplates,
  push_up: pushupTemplates,        // 算法 key 别名
  lunge: lungeTemplates,
  plank: plankTemplates,
  high_knee: highKneeTemplates,
  high_knees: highKneeTemplates,   // 算法 key 别名
  jumping_jack: jumpingJackTemplates,
};

// 运动中文名
const EXERCISE_NAMES: Record<string, string> = {
  squat: '深蹲',
  deadlift: '硬拉',
  pushup: '俯卧撑',
  push_up: '俯卧撑',      // 算法 key 别名
  lunge: '弓步蹲',
  plank: '平板支撑',
  high_knee: '高抬腿',
  high_knees: '高抬腿',   // 算法 key 别名
  jumping_jack: '开合跳',
  sit_up: '仰卧起坐',
};

/**
 * 从数组中随机选一条
 */
function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 生成实时教练话术（毫秒级，不走 LLM）
 * @param exercise 运动类型
 * @param stage 当前阶段
 * @param quality 质量等级
 * @param repCount 当前次数
 * @param prevRepCount 上次次数（判断是否刚完成一次）
 */
export function generateQuickCoaching(
  exercise: string,
  stage: string,
  quality: QualityLevel,
  repCount: number,
  prevRepCount: number = 0,
): { text: string; isMilestone: boolean } {
  const templates = EXERCISE_TEMPLATES[exercise] || commonTemplates;
  const name = EXERCISE_NAMES[exercise] || exercise;

  // 1. 里程碑检查（刚完成 N 次）
  if (repCount > prevRepCount) {
    const milestone = templates.milestones[repCount];
    if (milestone) {
      return { text: pickRandom(milestone), isMilestone: true };
    }
  }

  // 2. 质量话术（优先级：error > warning > adjust）
  //    perfect/good 时 50% 概率说话，避免太啰嗦
  if (quality === 'error' || quality === 'warning') {
    return { text: pickRandom(templates.byQuality[quality]), isMilestone: false };
  }

  if (quality === 'adjust') {
    // 60% 概率说调整话术，40% 说阶段话术
    if (Math.random() < 0.6) {
      return { text: pickRandom(templates.byQuality.adjust), isMilestone: false };
    }
  }

  if (quality === 'perfect' || quality === 'good') {
    // 30% 概率夸一句，70% 安静（别太啰嗦）
    if (Math.random() < 0.3) {
      return { text: pickRandom(templates.byQuality[quality]), isMilestone: false };
    }
  }

  // 3. 阶段话术（低概率，别太啰嗦）
  if (Math.random() < 0.2) {
    const stageKey = stage as keyof typeof templates.byStage;
    if (templates.byStage[stageKey]) {
      return { text: pickRandom(templates.byStage[stageKey]), isMilestone: false };
    }
  }

  // 4. 不说话
  return { text: '', isMilestone: false };
}

/**
 * 生成空闲话术（太久没动）
 */
export function generateIdleCoaching(): string {
  return pickRandom(commonTemplates.idle);
}

/**
 * 获取运动中文名
 */
export function getExerciseName(exercise: string): string {
  return EXERCISE_NAMES[exercise] || exercise;
}

/**
 * 获取所有支持的运动类型
 */
export function getSupportedExercises(): string[] {
  return Object.keys(EXERCISE_TEMPLATES);
}
