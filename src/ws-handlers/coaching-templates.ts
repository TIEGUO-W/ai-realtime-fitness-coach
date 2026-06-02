/**
 * 骚话模板库 — 规则算法直接出话术，不走 LLM，毫秒级响应
 * 按运动类型 × 阶段 × 质量分类，随机选一句
 * 风格：毒舌 + 搞笑 + 热血，像你最损的兄弟在旁边盯着你练
 */

// 质量等级
type QualityLevel = 'perfect' | 'good' | 'adjust' | 'warning' | 'error';

// 话术模板结构
interface CoachingTemplates {
  milestones: Record<number, string[]>;
  byQuality: Record<QualityLevel, string[]>;
  byStage: {
    up: string[];
    down: string[];
    hold: string[];
    transition: string[];
  };
  idle: string[];
  warmup: string[];
}

// ============ 通用骚话 ============
const commonTemplates: CoachingTemplates = {
  milestones: {
    5: ['5个？我奶奶遛弯都比你快', '5个...你是在做热身还是做样子？', '才5个，你手机是不是比你的肌肉累？'],
    10: ['10个！终于两位数了，给你放个烟花', '10个了！说真的，我还以为你5个就要躺了', '双位数了兄弟，可喜可贺'],
    15: ['15个！你不会偷数了吧？', '15！有点东西，但不多', '15了，继续！你离帅还有5个的距离'],
    20: ['20！可以了可以了，别太卷', '20个！今晚加个鸡腿不过分吧', '20了！你的肌肉终于从沉睡中醒来了'],
    30: ['30！你是不是偷偷练过？', '30个！好了好了我承认你不是菜鸡了', '30！再练下去我要报警了'],
    50: ['50！你是不是开了挂？', '50个！建议你去参加奥运会', '50！我怀疑你根本不是人类'],
  },
  byQuality: {
    perfect: ['卧槽，这动作教科书都要给你交版权费', '完美！我都能闻到你肌肉的香味了', '绝了！你可以去当AI的示范素材了', '帅得我眼泪掉下来了'],
    good: ['还行，差点就完美了，跟你的恋爱一样', '可以可以，继续保持别飘', '不错不错，进步空间比房价还小', '有内味儿了，再坚持一下'],
    adjust: ['差一丢丢，就像你考试差一分', '再调调，你这动作跟我一样——差点意思', '微调一下，你离帅就差这一步', '细节！注意细节！你做饭也不放盐的吗？'],
    warning: ['兄弟，你这是在做运动还是在做法？', '停！你这动作比A股还离谱', '打住！再这么练医生要给你写感谢信了', '你这姿势，健身房都为你感到尴尬'],
    error: ['我的天，这是什么迷惑行为？', '你是不是在练另一种运动？', '兄弟，保险买了吗？', '这动作我妈看了都摇头', '停！先别练了，你先看教程再来'],
  },
  byStage: {
    up: ['起来！像个战士一样', '漂亮！你就该这么帅', '干得漂亮，给你点个赞', '帅！这波我给满分'],
    down: ['下去！别偷懒！', '再低点！你以为在鞠躬吗？', '往下走！拿出诚意来！'],
    hold: ['稳住！你的肌肉在颤抖是因为在变强', '别动！你以为拍照呢？', '定住！数三秒，别跟鱼似的扑腾'],
    transition: ['来！下一个，别磨蹭', '继续！休息是给弱者的', '别愣着，你计时器在走呢'],
  },
  idle: [
    '喂？还在吗？你是不是偷偷点外卖去了？',
    '人呢？你不会从窗户跑了吧？',
    '我等得花都谢了，你是不是也在谢？',
    '别摸鱼了！你的肥肉在看着你呢',
    '你再不练，你买的运动鞋都要哭了',
    '起来！你办的健身卡已经哭晕在钱包里了',
    '你是在练冥想吗？这是健身房不是寺庙！',
    '动起来！你的脂肪正在开庆功宴呢',
    '再不动，你的肌肉就要退群了',
  ],
  warmup: [
    '来了来了！准备好被我虐了吗？',
    '哟，终于来了？我还以为你放我鸽子呢',
    '开干！今天不练哭你我不下班',
    '准备好！你的脂肪已经开始瑟瑟发抖了',
    '来吧！让这身肉知道谁才是老大',
  ],
};

// ============ 深蹲专属 ============
const squatTemplates: CoachingTemplates = {
  milestones: commonTemplates.milestones,
  byQuality: {
    perfect: ['这蹲得！屁股跟地面在谈恋爱吧', '完美！你的膝盖比你的前任还听话', '教科书深蹲！牛顿看了都鼓掌', '帅！这蹲得比我工资降得还低'],
    good: ['蹲得还行，屁股再往后坐点就完美了', '不错！膝盖方向对了，继续保持', '这深度可以，就像你在找掉地上的钱', '有进步！屁股再往后坐坐，别客气'],
    adjust: ['膝盖别内扣！又不是在跳女团舞', '屁股往后坐！想象后面有个沙发在等你', '腰挺直！你又不是在找地上有没有硬币', '别弯腰！你不是在跟地板打招呼'],
    warning: ['膝盖快超脚尖了！你想去医院排队吗？', '腰别弯！你脊椎不是面条做的', '起来太快了！你以为弹簧吗？', '停停停！你这蹲法，骨科大夫看了都想给你递名片'],
    error: ['兄弟你蹲了个啥？我看了三遍都没看懂', '腰弯成虾了！你是想变皮皮虾吗？', '膝盖内扣成这样？你是在许愿吗？', '停！你这动作我的保险都不赔'],
  },
  byStage: {
    up: ['起来！夹紧你的屁股！', '顶上去！像火箭发射一样', '起身干脆点！别磨磨唧唧的', '漂亮！屁股用力，别浪费了'],
    down: ['往下坐！后面有隐形的椅子你怕啥', '再低点！半蹲是啥意思？敷衍我？', '慢点下！你不是在做自由落体', '蹲下去！想象你在躲前女友'],
    hold: ['底部定住！别弹！这不是蹦床', '稳住！你的肌肉在尖叫是因为在长大', '停一秒！就一秒！你不行的吗？', '最低点稳住！你在跟地心引力谈恋爱'],
    transition: ['下一个！别歇太久，肉不会自己跑掉的', '来，继续！你的屁股还没累呢', '别愣着！你刚才那一下才热身'],
  },
  idle: commonTemplates.idle,
  warmup: [
    '深蹲时间！你的屁股准备好了吗？它已经等不及了',
    '来，蹲起来！你的大腿今天注定要燃烧',
    '深蹲走起！蹲下去是地狱，站起来是天堂',
    '准备好蹲了吗？你的椅子说你不需要它了',
  ],
};

// ============ 平板支撑专属 ============
const plankTemplates: CoachingTemplates = {
  milestones: {
    10: ['10秒？我憋气都比这久', '10秒...你是来体验生活的吗？', '10秒，你的核心刚打了个哈欠'],
    20: ['20秒！还行，但你的肥肉还在笑', '20秒，坚持住！这才刚开始热身'],
    30: ['30秒！你的核心终于醒过来了', '半分钟了，抖是正常的，你在变强'],
    45: ['45秒！你的核心在燃烧吧？好事！', '快一分钟了！你的肚子已经在投降了'],
    60: ['一分钟！给你鼓个掌，真的', '60秒！你比99%的人都强了，真的'],
    90: ['一分半！你核心是铁做的吗？', '90秒！你的腹肌在给你写感谢信'],
    120: ['两分钟！建议你去参加 plank 大赛', '120秒！你可以把平板支撑写进简历了'],
  },
  byQuality: {
    perfect: ['身体一条线！比尺子还直', '完美！你的核心硬得像我前任的心', '帅！你整个人跟地板平行得像PS过的', '标准！可以拿去当教学素材了'],
    good: ['不错！身体比较稳，别松劲', '还行，保持住，你的脂肪在抗议了', '继续！别松，你离帅就差一点坚持'],
    adjust: ['屁股别翘！你不是在做下犬式', '腰别塌！你不是在床上赖着', '肩胛骨撑开！别缩着，你不是乌龟'],
    warning: ['塌腰了！你是蛇还是人？', '屁股翘那么高，你是在等谁？', '抖什么抖！你是在跳舞吗？', '腰塌了！你这样练完腰比腿还酸'],
    error: ['都塌地上了！你叫平板支撑还是海豹式趴地？', '你这姿势，瑜伽老师看了要打人', '先跪姿练练吧！别硬撑，你腰不是铁的', '停！你这不是平板支撑，是平板趴着'],
  },
  byStage: {
    up: commonTemplates.byStage.up,
    down: commonTemplates.byStage.down,
    hold: [
      '稳住！你的抖是在燃烧',
      '呼吸！别憋气，你不是潜水',
      '再撑5秒！你可以的，我信你',
      '想想你的腹肌！它正在成型！',
      '别松！你的肉正在重新排队',
      '你的核心在尖叫，说明它在变强',
    ],
    transition: commonTemplates.byStage.transition,
  },
  idle: commonTemplates.idle,
  warmup: [
    '平板支撑！你的核心准备好被点燃了吗？',
    '来，撑住！你的肚腩说它不服',
    '平板走起！塌腰的人不配叫自己铁板',
    '准备！30秒起步，少一秒都不行',
  ],
};

// ============ 开合跳专属 ============
const jumpingJackTemplates: CoachingTemplates = {
  milestones: commonTemplates.milestones,
  byQuality: {
    perfect: ['手脚同步！你的协调性可以出道了', '完美！你跳得比你的心跳还整齐', '帅！这节奏感，可以去做爱豆了', '漂亮！整个人像朵花一样绽放'],
    good: ['节奏不错！继续保持这个feel', '还行，比较协调，别停下来', '继续这个速度！你的脂肪正在逃跑'],
    adjust: ['手举过头顶！你是在打招呼吗？', '跳开点！别小家子气的', '脚并拢要快！你又不是在跳芭蕾', '幅度大点！你这不是在做广播体操'],
    warning: ['手脚不同步！你是在跳freestyle吗？', '跳高点！你是在原地踏步吗？', '别偷懒半跳！你以为老师看不见？', '节奏乱了！你是不是在数钱？'],
    error: ['兄弟...你这是在跳什么舞？自创的？', '手脚各跳各的？你身体内部在闹独立？', '你是在跳还是在抽筋？我分不清', '先慢动作练练吧，你现在的样子像触电'],
  },
  byStage: {
    up: ['打开！像朵花一样绽放！', '跳开！手举起来！你是最亮的星', '展开！让你的脂肪无处可藏', '打开！大点！再大点！'],
    down: ['并拢！快！像夹汉堡一样', '收回来！迅速！', '合！你的节奏感呢？', '并！整齐点，别拖泥带水'],
    hold: ['保持节奏！你现在是人体节拍器', '别减速！你的脂肪还没哭够', '稳住节奏！像在蹦迪一样嗨起来', '继续！你已经停不下来了'],
    transition: ['继续跳！别停！你的脂肪在求饶', '加速！让你的心跳追上你的节奏', '别停！你的卡路里正在疯狂燃烧'],
  },
  idle: commonTemplates.idle,
  warmup: [
    '开合跳！手脚同步起来，别各玩各的',
    '跳起来！让你的肉跟着一起嗨',
    '开合跳走起！你就是最靓的星',
    '准备好！开合跳是你今天的开胃菜',
  ],
};

// ============ 保留其他运动的模板（未来算法就绪可直接使用） ============
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
  warmup: ['硬拉？有点猛！注意腰部', '来，硬拉走起！腰给我挺直了', '硬拉开始！背收紧，杠铃贴腿走'],
};

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
  warmup: ['俯卧撑走起！身体给我成一条线', '来，撑起来！别塌腰', '俯卧撑时间！先来几个标准的'],
};

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
  warmup: ['弓步蹲！注意前膝别超脚尖', '来，前后脚站稳了再下蹲', '弓步蹲走起！步子迈开点'],
};

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
  warmup: ['高抬腿！膝盖给我抬到腰', '来，跑起来！抬腿抬腿', '高抬腿走起！节奏跟上'],
};

// ============ 运动模板映射 ============
const followAlongTemplates: CoachingTemplates = {
  milestones: {
    5: ['节奏不错！跟上教练的步伐', '五组了！继续保持', '渐入佳境！就这样'],
    10: ['已经十组了！燃起来了', '非常好，你已经找到感觉了'],
    20: ['状态太好了！你已经完成了20组'],
    50: ['五！十！组！太强了！'],
  },
  byQuality: {
    perfect: ['完美同步！你比教练还标准', '动作简直一模一样！', '这同步率，满分！'],
    good: ['跟得不错！', '节奏掌握得很好', '动作很到位，继续保持'],
    adjust: ['手臂再抬高一点', '注意腿的幅度', '胯部动作再大一些', '看看教练的节奏'],
    warning: ['动作慢下来了，跟上！', '注意手臂位置', '腿部幅度不太对'],
    error: ['停一下，看教练怎么做', '动作偏差太大了，先放慢'],
  },
  byStage: {
    up: [], down: [], hold: [], transition: [],
  },
  idle: ['怎么停下来了？继续跳！', '别偷懒，教练还在跳呢', '喂！教练看了你一眼'],
  warmup: ['准备好开始跟练了吗？', '跟着教练一起！', '来，眼睛看屏幕，身体动起来！'],
};

const EXERCISE_TEMPLATES: Record<string, CoachingTemplates> = {
  squat: squatTemplates,
  deadlift: deadliftTemplates,
  pushup: pushupTemplates,
  push_up: pushupTemplates,
  lunge: lungeTemplates,
  plank: plankTemplates,
  high_knee: highKneeTemplates,
  high_knees: highKneeTemplates,
  jumping_jack: jumpingJackTemplates,
  follow_along: followAlongTemplates,
};

// 运动中文名
const EXERCISE_NAMES: Record<string, string> = {
  squat: '深蹲',
  deadlift: '硬拉',
  pushup: '俯卧撑',
  push_up: '俯卧撑',
  lunge: '弓步蹲',
  plank: '平板支撑',
  high_knee: '高抬腿',
  high_knees: '高抬腿',
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
 */
export function generateQuickCoaching(
  exercise: string,
  stage: string,
  quality: QualityLevel,
  repCount: number,
  prevRepCount: number = 0,
): { text: string; isMilestone: boolean } {
  const templates = EXERCISE_TEMPLATES[exercise] || commonTemplates;

  // 1. 里程碑检查
  if (repCount > prevRepCount) {
    const milestone = templates.milestones[repCount];
    if (milestone) {
      return { text: pickRandom(milestone), isMilestone: true };
    }
  }

  // 2. 质量话术
  if (quality === 'error' || quality === 'warning') {
    return { text: pickRandom(templates.byQuality[quality]), isMilestone: false };
  }

  if (quality === 'adjust') {
    if (Math.random() < 0.6) {
      return { text: pickRandom(templates.byQuality.adjust), isMilestone: false };
    }
  }

  if (quality === 'perfect' || quality === 'good') {
    if (Math.random() < 0.5) {
      return { text: pickRandom(templates.byQuality[quality]), isMilestone: false };
    }
  }

  // 3. 阶段话术
  if (Math.random() < 0.3) {
    const stageKey = stage as keyof typeof templates.byStage;
    if (templates.byStage[stageKey]) {
      return { text: pickRandom(templates.byStage[stageKey]), isMilestone: false };
    }
  }

  return { text: '', isMilestone: false };
}

/**
 * 生成空闲话术（太久没动）
 */
export function generateIdleCoaching(): string {
  return pickRandom(commonTemplates.idle);
}

/**
 * 生成暖场开场白（训练开始时）
 */
export function generateWarmupCoaching(exercise: string): string {
  const templates = EXERCISE_TEMPLATES[exercise] || commonTemplates;
  return pickRandom(templates.warmup || commonTemplates.warmup);
}

// ─── 跟练模式话术 ──────────────────────────────

const FOLLOW_TEMPLATES = {
  good: [
    '跟得漂亮！动作很到位',
    '节奏感不错，继续保持',
    '就是这个感觉！动作很标准',
    '很好，和教练几乎同步',
  ],
  adjust: [
    '手臂再抬高一点',
    '注意看教练，动作幅度再大些',
    '腿再张开一点，跟上节奏',
    '腰挺直，别偷懒',
    '动作稍微快一点，跟上节拍',
    '肩膀放松，别太僵硬',
    '手的位置注意一下，和教练对齐',
  ],
  correct: [
    '停一下，你这个动作偏差有点大',
    '先看教练怎么做，然后再跟',
    '慢一点，先把动作做对再加速',
    '注意看屏幕，和教练对比一下',
  ],
  encouragement: [
    '燃起来了！',
    '快跟上，别掉队！',
    '汗出来了没？这才到哪！',
    '跳起来，别站着不动！',
  ],
};

export function generateFollowCoaching(
  jointStatus: Record<string, 'good' | 'adjust' | 'correct'>,
  matchQuality: number,
): string | null {
  const worst = Object.entries(jointStatus)
    .filter(([, s]) => s !== 'good')
    .sort(([, a], [, b]) => {
      const order = { correct: 0, adjust: 1, good: 2 };
      return order[a] - order[b];
    });

  if (worst.length === 0) {
    if (matchQuality > 85) return pickRandom(FOLLOW_TEMPLATES.good);
    return null;
  }

  const [jointName, status] = worst[0];
  const templates = FOLLOW_TEMPLATES[status] || FOLLOW_TEMPLATES.adjust;

  // 50% chance to mention specific joint
  if (Math.random() < 0.5) {
    return `${jointName}：${pickRandom(templates)}`;
  }
  return pickRandom(templates);
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
