'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { CoachPersonality } from '@/types/dashboard';
import type { WatchHealthData } from '@/lib/health-store';
import { PERSONALITY_LABELS, PERSONALITY_EMOJI } from '@/utils/coachVoice';

interface CustomPlanModalProps {
  open: boolean;
  onClose: () => void;
  personality: CoachPersonality;
  healthData: WatchHealthData | null;
  currentHR: number;
  currentExercise: string;
}

type Step = 'syncing' | 'metrics' | 'plan';

export default function CustomPlanModal({
  open, onClose, personality, healthData, currentHR, currentExercise,
}: CustomPlanModalProps) {
  const [step, setStep] = useState<Step>('syncing');
  const [syncProgress, setSyncProgress] = useState(0);
  const [planText, setPlanText] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only real available data: profile (age, fitnessLevel, goal) + heartRate
  const profile = healthData?.profile;
  const age = profile?.age ?? 0;
  const fitnessLevel = profile?.fitnessLevel ?? 'intermediate';
  const goal = profile?.goal ?? 'general';
  const hr = currentHR || healthData?.heartRate || 0;

  // Max HR calculation
  const maxHR = age > 0 ? 220 - age : 0;
  const hrPercent = maxHR > 0 && hr > 0 ? Math.round((hr / maxHR) * 100) : 0;

  // Target HR zones based on goal
  const targetZone = (() => {
    if (age === 0) return { low: 0, high: 0, label: '未知' };
    const base = 220 - age;
    switch (goal) {
      case 'lose_weight': return { low: Math.round(base * 0.6), high: Math.round(base * 0.7), label: '燃脂区 60-70%' };
      case 'build_muscle': return { low: Math.round(base * 0.65), high: Math.round(base * 0.8), label: '增肌区 65-80%' };
      case 'endurance': return { low: Math.round(base * 0.7), high: Math.round(base * 0.85), label: '耐力区 70-85%' };
      default: return { low: Math.round(base * 0.6), high: Math.round(base * 0.75), label: '健康区 60-75%' };
    }
  })();

  const GOAL_MAP: Record<string, string> = {
    lose_weight: '减脂', build_muscle: '增肌', endurance: '耐力', general: '综合健身',
  };
  const LEVEL_MAP: Record<string, string> = {
    beginner: '初学', intermediate: '进阶', advanced: '高级',
  };

  // Reset and start flow when opened
  useEffect(() => {
    if (!open) {
      setStep('syncing');
      setSyncProgress(0);
      setPlanText('');
      setPlanLoading(false);
      return;
    }

    const t1 = setInterval(() => {
      setSyncProgress((p) => {
        if (p >= 100) {
          clearInterval(t1);
          return 100;
        }
        return p + Math.random() * 25;
      });
    }, 200);

    const t2 = setTimeout(() => {
      clearInterval(t1);
      setSyncProgress(100);
      setStep('metrics');
    }, 1800);

    return () => {
      clearInterval(t1);
      clearTimeout(t2);
    };
  }, [open]);

  // Step 2 → 3: After metrics display, fetch AI plan
  useEffect(() => {
    if (step !== 'metrics') return;
    const t = setTimeout(() => {
      setStep('plan');
      fetchAIPlan();
    }, 1500);
    return () => clearTimeout(t);
  }, [step]);

  // Fetch AI-generated plan from backend
  const fetchAIPlan = useCallback(async () => {
    setPlanLoading(true);
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          age, fitnessLevel, goal, heartRate: hr,
          currentExercise, personality,
        }),
      });
      const data = await res.json();
      if (data.plan?.content) {
        setPlanText(data.plan.content);
      } else if (typeof data.plan === 'string') {
        setPlanText(data.plan);
      } else {
        setPlanText(generateFallbackPlan());
      }
    } catch {
      setPlanText(generateFallbackPlan());
    } finally {
      setPlanLoading(false);
    }
  }, [age, fitnessLevel, goal, hr, currentExercise, personality]);

  // Fallback plan if API fails
  const generateFallbackPlan = useCallback(() => {
    const goalText = GOAL_MAP[goal] || '综合健身';
    const levelText = LEVEL_MAP[fitnessLevel] || '进阶';
    const lines = [
      `基于你的档案（${age || '?'}岁 · ${levelText} · ${goalText}），建议心率控制在 ${targetZone.low || '?'}-${targetZone.high || '?'} BPM（${targetZone.label}）。`,
      '',
      '📋 今日训练建议：',
      '1. 热身 3 分钟 → 全身关节活化',
      '2. 主训练 → ' + (currentExercise || '深蹲') + ' 4组',
      '3. 心率目标 → ' + (targetZone.low || '?') + '-' + (targetZone.high || '?') + ' BPM',
      '4. 组间休息 45-60 秒 → 心率回落后再继续',
      '5. 训练后拉伸 5 分钟 → 静态拉伸放松',
    ];
    if (hr <= 0) {
      lines.push('', '⚠️ 心率未连接，建议连接 Apple Health 获取实时监测');
    }
    return lines.join('\n');
  }, [age, fitnessLevel, goal, hr, currentExercise, targetZone]);

  const handleClose = useCallback(() => {
    setStep('syncing');
    setSyncProgress(0);
    onClose();
  }, [onClose]);

  if (!open) return null;

  const hasProfile = !!profile;
  const hasHR = hr > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6" onClick={handleClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" />

      {/* Modal */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-2xl border border-slate-700/60 bg-slate-900/90 backdrop-blur-xl shadow-2xl overflow-hidden animate-slide-up"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/40">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">{step === 'syncing' ? '🔄' : step === 'metrics' ? '📊' : '⚡'}</span>
            <h2 className="text-sm font-semibold text-white tracking-wide">
              {step === 'syncing' ? '读取健康档案' : step === 'metrics' ? '身体状态评估' : 'AI 定制计划'}
            </h2>
          </div>
          <button onClick={handleClose} className="text-slate-500 hover:text-white transition-colors text-lg leading-none">
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 min-h-[280px] max-h-[60vh] overflow-y-auto">
          {/* ═══ STEP 1: Syncing ═══ */}
          {step === 'syncing' && (
            <div className="flex flex-col items-center justify-center py-6">
              <div className="relative w-24 h-24 mb-6">
                <div className="absolute inset-0 rounded-full border-2 border-slate-700/50" />
                <div
                  className="absolute inset-0 rounded-full border-2 border-cyber-cyan/40 animate-spin"
                  style={{ clipPath: `inset(0 0 ${100 - syncProgress}% 0)` }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-mono font-bold text-cyber-cyan tabular-nums">
                    {Math.round(syncProgress)}%
                  </span>
                </div>
              </div>

              <p className="text-sm text-slate-300 font-mono tracking-wide mb-1">
                正在读取健康档案
              </p>
              <p className="text-[11px] text-slate-500 font-mono">
                {hasProfile ? 'Profile · Heart Rate' : '尚未连接 Apple Health...'}
              </p>

              <div className="mt-5 w-full space-y-2">
                {[
                  { label: '健康档案', ok: hasProfile, val: hasProfile ? `${age}岁 · ${LEVEL_MAP[fitnessLevel]}` : '未填写' },
                  { label: '实时心率', ok: hasHR, val: hasHR ? `${hr} BPM` : '未连接' },
                  { label: '训练目标', ok: hasProfile, val: hasProfile ? GOAL_MAP[goal] || goal : '未设置' },
                ].map((item, i) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/30"
                    style={{ opacity: syncProgress > i * 25 ? 1 : 0.3, transition: 'opacity 0.3s' }}
                  >
                    <span className="text-[11px] text-slate-400 font-mono">{item.label}</span>
                    {syncProgress > i * 25 + 10 ? (
                      <span className={`text-[11px] font-mono tabular-nums ${item.ok ? 'text-cyber-cyan' : 'text-slate-500'}`}>
                        {item.val}
                      </span>
                    ) : (
                      <span className="inline-block w-12 h-3 rounded bg-slate-700/60 animate-pulse" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ STEP 2: Metrics Review ═══ */}
          {step === 'metrics' && (
            <div className="space-y-3 animate-slide-up">
              <p className="text-[11px] text-slate-500 font-mono mb-2">
                {hasProfile ? `档案同步完成 · ${age}岁 · ${LEVEL_MAP[fitnessLevel]} · ${GOAL_MAP[goal]}` : '暂无健康档案 · 使用默认参数'}
              </p>

              {/* Real-time HR card */}
              <div className={`flex items-center justify-between p-3 rounded-xl border ${
                hasHR
                  ? hrPercent > 85 ? 'border-red-700/40 bg-red-950/25'
                    : hrPercent > 70 ? 'border-orange-700/40 bg-orange-950/30'
                    : 'border-cyber-cyan/20 bg-slate-800/40'
                  : 'border-slate-700/30 bg-slate-800/30'
              }`}>
                <div className="flex items-center gap-2.5">
                  <span className="text-base">{hasHR ? '💓' : '💤'}</span>
                  <div>
                    <p className="text-xs text-slate-300 font-medium">
                      {hasHR ? '实时心率' : '心率未连接'}
                    </p>
                    <p className="text-[10px] font-mono">
                      {hasHR
                        ? maxHR > 0
                          ? `最大 ${maxHR} BPM · 当前 ${hrPercent}%`
                          : '正在监测'
                        : '连接 Apple Health 获取实时心率'}
                    </p>
                  </div>
                </div>
                {hasHR && (
                  <span className={`text-lg font-bold font-mono tabular-nums ${
                    hrPercent > 85 ? 'text-red-400' : hrPercent > 70 ? 'text-orange-400' : 'text-cyber-cyan'
                  }`}>
                    {hr}<span className="text-xs font-normal opacity-60"> BPM</span>
                  </span>
                )}
              </div>

              {/* Target zone card */}
              {age > 0 && (
                <div className="flex items-center justify-between p-3 rounded-xl border border-cyber-cyan/15 bg-cyber-cyan/5">
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">🎯</span>
                    <div>
                      <p className="text-xs text-slate-300 font-medium">目标心率区间</p>
                      <p className="text-[10px] text-cyber-cyan/60 font-mono">{targetZone.label}</p>
                    </div>
                  </div>
                  <span className="text-lg font-bold text-cyber-cyan font-mono tabular-nums">
                    {targetZone.low}-{targetZone.high}<span className="text-xs font-normal text-cyber-cyan/60"> BPM</span>
                  </span>
                </div>
              )}

              {/* No profile warning */}
              {!hasProfile && (
                <div className="flex items-center gap-2 p-3 rounded-xl border border-orange-700/30 bg-orange-950/20">
                  <span className="text-base">⚠️</span>
                  <div>
                    <p className="text-xs text-orange-300 font-medium">尚未填写健康档案</p>
                    <p className="text-[10px] text-orange-400/60 font-mono">扫码填写可获得更精准的训练建议</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ STEP 3: AI Plan ═══ */}
          {step === 'plan' && (
            <div className="animate-slide-up space-y-4">
              {/* Coach verdict */}
              <div className="p-4 rounded-xl border border-cyber-cyan/20 bg-cyber-cyan/5">
                <div className="flex items-center gap-2 mb-2">
                  <span>{PERSONALITY_EMOJI[personality]}</span>
                  <span className="text-xs font-semibold text-cyber-cyan">
                    {PERSONALITY_LABELS[personality]} · AI 评估结论
                  </span>
                </div>
                {planLoading ? (
                  <div className="space-y-2">
                    <div className="h-4 w-3/4 rounded bg-slate-700/40 animate-pulse" />
                    <div className="h-4 w-1/2 rounded bg-slate-700/40 animate-pulse" />
                  </div>
                ) : (
                  <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-line">
                    {planText}
                  </div>
                )}
              </div>

              {/* Quick HR zone reference */}
              {age > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-white tracking-wide mb-2.5 flex items-center gap-1.5">
                    <span className="w-1 h-4 rounded-full bg-flame-orange inline-block" />
                    心率区间参考
                  </h4>
                  <div className="space-y-1.5">
                    {[
                      { label: '热身', range: `${Math.round(maxHR * 0.5)}-${Math.round(maxHR * 0.6)}`, color: 'bg-blue-500/20 border-blue-700/30', text: 'text-blue-400' },
                      { label: '燃脂', range: `${Math.round(maxHR * 0.6)}-${Math.round(maxHR * 0.7)}`, color: 'bg-green-500/20 border-green-700/30', text: 'text-green-400' },
                      { label: '有氧', range: `${Math.round(maxHR * 0.7)}-${Math.round(maxHR * 0.8)}`, color: 'bg-cyan-500/20 border-cyan-700/30', text: 'text-cyber-cyan' },
                      { label: '无氧', range: `${Math.round(maxHR * 0.8)}-${Math.round(maxHR * 0.9)}`, color: 'bg-orange-500/20 border-orange-700/30', text: 'text-flame-orange' },
                      { label: '极限', range: `${Math.round(maxHR * 0.9)}-${maxHR}`, color: 'bg-red-500/20 border-red-700/30', text: 'text-coral-red' },
                    ].map((zone) => (
                      <div
                        key={zone.label}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg border ${zone.color}`}
                      >
                        <span className="text-[11px] text-slate-300 font-mono">{zone.label}</span>
                        <span className={`text-[11px] font-mono tabular-nums font-bold ${zone.text}`}>{zone.range} BPM</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Disclaimer */}
              <p className="text-[10px] text-slate-600 font-mono text-center">
                {hasProfile ? '基于真实健康档案 + AI 分析' : '暂无健康档案 · 使用默认参数评估'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-700/40 flex items-center justify-between">
          <span className="text-[10px] text-slate-600 font-mono">
            {step === 'syncing'
              ? hasProfile ? 'Health Data · Real-time' : 'No Health Data Connected'
              : step === 'metrics'
                ? hasProfile ? '数据来源：Apple Health + 档案' : '使用默认参数评估'
                : `🎯 ${PERSONALITY_LABELS[personality]} 生成`}
          </span>
          {step === 'plan' && (
            <button
              onClick={handleClose}
              className="px-4 py-1.5 rounded-full text-xs font-medium bg-cyber-cyan/15 text-cyber-cyan border border-cyber-cyan/40 hover:bg-cyber-cyan/25 transition-all"
            >
              确认计划
            </button>
          )}
        </div>

        {/* Top glow line */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-cyber-cyan/50 to-transparent" />
      </div>
    </div>
  );
}
