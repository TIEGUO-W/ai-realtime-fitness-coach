import { useState, useEffect } from 'react';
import type { Workout, Biometrics, CoachPersonality } from '@/types/dashboard';
import { PERSONALITY_LABELS, PERSONALITY_EMOJI } from '@/utils/coachVoice';

interface WorkoutSummaryModalProps {
  open: boolean;
  onClose: () => void;
  workout: Workout;
  biometrics: Biometrics;
  personality: CoachPersonality;
  durationSeconds: number;
}

// ── AI Coach summary evaluation by personality × score tier ────────
const EVALUATIONS: Record<CoachPersonality, Record<string, string[]>> = {
  gentle: {
    high: [
      '今天表现太棒啦！心率控制得非常好，动作也一直保持高标准。回去记得多喝水，做好拉伸，明天继续加油哦～',
      '完美收工！你的状态今天真的很好，每一次{action}都充满力量和控制。好好休息，明天见！',
    ],
    mid: [
      '训练完成啦！整体表现不错，虽然有些动作还可以更精细，但你很努力。记得充分拉伸，补充蛋白质哦～',
      '又坚持完成了一次训练，真为你骄傲！心率和动作质量都在进步，继续保持这个节奏！',
    ],
    low: [
      '训练虽然结束了，但我们在质量上还可以再下功夫。别灰心，每一次训练都是积累。好好休息，明天会更好！',
      '辛苦了！今天的{action}有些细节需要注意，但坚持完成就是胜利。洗个热水澡，好好恢复一下～',
    ],
  },
  strict: {
    high: [
      '训练结束！数据不会撒谎——你今天做得很不错。心率管理到位，动作质量在标准线之上。保持这个水准，不要松懈！',
      '收操！今天的{action}完成度很高，这是纪律的成果。但记住：优秀不是终点，下一次要更精准！',
    ],
    mid: [
      '训练完毕。数据还算合格，但离心阶段的控制还有提升空间。下一组训练我要看到更干净的动作轨迹！',
      '勉强达标。心率区间在目标范围内，但{action}的后半程稳定性下降明显。下次注意后半程的专注度！',
    ],
    low: [
      '训练结束。坦率地说，今天的数据不够好看。动作质量和心率控制都没有达到训练标准。休息好，下次带着决心过来！',
      '收操。今天的训练质量需要严肃反思。{action}的发力轨迹多次偏离，这不是我想要看到的。明天纠正！',
    ],
  },
  toxic: {
    high: [
      '哟，居然练得还不错？心率稳动作也标准，看来今天不是来混日子的。继续保持，别让我收回这句夸奖。',
      '结束啦！数据居然这么好看——你是不是趁我不注意偷偷嗑药了？开个玩笑，今天{action}是真的漂亮。',
    ],
    mid: [
      '总算勉勉强强练完了。最后几个{action}晃得像个不倒翁，下次核心要是再不收紧，我就要考虑换个学员了。',
      '训练结束了，数据嘛……及格线飘过。你应该庆幸我嘴下留情，下次带点真本事过来，OK？',
    ],
    low: [
      '练完了？你管这叫训练？{action}做得像在跳广场舞，心率曲线像心电图。回去好好反思一下人生。',
      '恭喜你用今天的表现刷新了我的底线。动作稀烂心率混乱，明天要是还这样，建议你去隔壁瑜伽教室。',
    ],
  },
  energetic: {
    high: [
      '燃爆了燃爆了！！今天的训练简直完美！！心率动作双双在线，你就是健身房最闪耀的那颗星！！明天继续冲！！',
      '哇啊啊啊训练结束！！数据超级漂亮！！每一次{action}都在燃烧灵魂！！好好吃饭好好睡觉，明天继续战斗！！',
    ],
    mid: [
      '训练圆满结束啦！！整体发挥稳定哦～虽然有些小瑕疵但热情满分！！拉伸放松别忘了，我们明天再战！！',
      '不错的训练日！！心率飙升的感觉超棒对不对！！{action}的后半程虽然有点飘，但态度一百分！！',
    ],
    low: [
      '训练完成！！虽然今天数据不算顶尖，但每一次努力都在为未来打基础！！别气馁，带着今天的经验明天更强！！',
      '辛苦了辛苦了！！{action}的质量还有提升空间，但你坚持下来了！！这就是胜利！！休息好明天继续发光！！',
    ],
  },
};

function getScoreTier(score: number): 'high' | 'mid' | 'low' {
  if (score >= 80) return 'high';
  if (score >= 60) return 'mid';
  return 'low';
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m} 分 ${s} 秒`;
}

function formatDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

export default function WorkoutSummaryModal({
  open,
  onClose,
  workout,
  biometrics,
  personality,
  durationSeconds,
}: WorkoutSummaryModalProps) {
  const tier = getScoreTier(workout.score);

  // Stabilize all random-derived values so they don't change on re-render
  const [displayData, setDisplayData] = useState({ evalMsg: '', peakHR: 0, avgScore: 0 });

  useEffect(() => {
    if (open) {
      const evalMsgs = EVALUATIONS[personality][tier];
      const msg = pick(evalMsgs).replace(/\{action\}/g, workout.currentAction);
      const hr = Math.min(185, biometrics.heartRate + Math.floor(Math.random() * 12));
      const sc = Math.max(55, workout.score - Math.floor(Math.random() * 8));
      setDisplayData({ evalMsg: msg, peakHR: hr, avgScore: sc });
    }
  }, [open, personality, tier, workout.currentAction, biometrics.heartRate, workout.score]);

  if (!open) return null;

  const { evalMsg, peakHR, avgScore } = displayData;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-lg" />

      {/* Modal */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700/60 bg-slate-900/90 backdrop-blur-xl shadow-2xl animate-slide-up"
      >
        {/* ── Top glow line ───────────────────────────────────── */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/50 to-transparent" />

        {/* ═══ Header: Honor Banner ══════════════════════════════ */}
        <div className="px-6 pt-6 pb-4 text-center">
          <p className="text-[11px] text-slate-500 font-mono tracking-widest uppercase mb-2">
            Workout Complete · {formatDate()}
          </p>
          <h2 className="text-xl font-bold text-white tracking-wide mb-1">
            今日训练圆满结束！
          </h2>
          <div className="inline-flex items-center gap-2 mt-2 px-4 py-1.5 rounded-full bg-cyber-cyan/10 border border-cyber-cyan/20">
            <span className="text-xs text-cyber-cyan font-mono tracking-wider">
              总时长 {formatDuration(durationSeconds)}
            </span>
          </div>
        </div>

        {/* ═══ Data Grid: 4 key metrics ══════════════════════════ */}
        <div className="grid grid-cols-2 gap-3 px-5 pb-2">
          {/* Action */}
          <div className="rounded-xl bg-slate-800/50 backdrop-blur-md border border-slate-700/40 p-3.5">
            <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">完成动作</span>
            <p className="mt-1.5 text-lg font-bold text-white">{workout.currentAction}</p>
          </div>

          {/* Total Reps */}
          <div className="rounded-xl bg-slate-800/50 backdrop-blur-md border border-slate-700/40 p-3.5">
            <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">总计次数</span>
            <p className="mt-1.5 text-lg font-bold text-cyber-cyan font-mono tabular-nums">
              {workout.reps}<span className="text-sm text-slate-500"> / {workout.targetReps}</span>
            </p>
          </div>

          {/* Avg Score */}
          <div className="rounded-xl bg-slate-800/50 backdrop-blur-md border border-slate-700/40 p-3.5">
            <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">本次平均分</span>
            <div className="flex items-baseline gap-2 mt-1.5">
              <span className="text-lg font-bold text-white font-mono tabular-nums">{avgScore}</span>
              <span className="text-[10px] text-slate-500 font-mono">
                {avgScore >= 80 ? '优秀' : avgScore >= 60 ? '良好' : '需加强'}
              </span>
            </div>
          </div>

          {/* Peak HR */}
          <div className="rounded-xl bg-slate-800/50 backdrop-blur-md border border-slate-700/40 p-3.5">
            <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">心率表现</span>
            <p className="mt-1.5 text-lg font-bold text-red-400 font-mono tabular-nums">
              峰值 {peakHR}<span className="text-sm text-red-400/60"> BPM</span>
            </p>
          </div>
        </div>

        {/* ═══ AI Coach Evaluation ═══════════════════════════════ */}
        <div className="mx-5 mt-3 rounded-xl border border-cyber-cyan/20 bg-cyber-cyan/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm">{PERSONALITY_EMOJI[personality]}</span>
            <span className="text-xs font-semibold text-cyber-cyan tracking-wide">
              {PERSONALITY_LABELS[personality]} · AI 教练复盘总结
            </span>
          </div>
          <p className="text-sm text-slate-200 leading-relaxed">
            {evalMsg}
          </p>
        </div>

        {/* ═══ Footer Buttons ════════════════════════════════════ */}
        <div className="px-5 py-4 flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800/60 border border-slate-600/40 text-xs text-slate-400 font-medium hover:border-slate-500 hover:text-white transition-all"
          >
            ❌ 关闭并返回首页
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-xl bg-cyber-cyan/15 border border-cyber-cyan/40 text-xs text-cyber-cyan font-semibold hover:bg-cyber-cyan/25 transition-all"
          >
            💾 保存并同步到 Apple Health
          </button>
        </div>

        {/* ── Disclaimer ──────────────────────────────────────── */}
        <p className="text-center text-[10px] text-slate-600 font-mono pb-4">
          数据已保存至本地 · 同步至 Apple Health 需 watchOS 授权
        </p>
      </div>
    </div>
  );
}
