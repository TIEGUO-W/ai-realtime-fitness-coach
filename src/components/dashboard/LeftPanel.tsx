'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { Application } from '@splinetool/runtime';
import type { ExerciseType, CoachPersonality, FeedbackItem } from '@/types/dashboard';
import {
  MONSTER_MODELS,
  pickModel,
  getModelById,
} from '@/data/monsters';
import type { MonsterModel } from '@/data/monsters';
import { PERSONALITY_LABELS, PERSONALITY_EMOJI } from '@/utils/coachVoice';

// Dynamic import Spline (no SSR — browser-only)
const Spline = dynamic(() => import('@splinetool/react-spline'), { ssr: false });

interface LeftPanelProps {
  exercise: ExerciseType;
  personality: CoachPersonality;
  isTraining: boolean;
  currentAction: string;
  feedbackItems: FeedbackItem[];
  mode: 'local' | 'remote';
  reps: number;
  score: number;
  onToggleSession: () => void;
  onSetExercise: (e: ExerciseType) => void;
  onSetPersonality: (p: CoachPersonality) => void;
  onSetMode: (m: 'local' | 'remote') => void;
  onOpenPlanModal: () => void;
  voiceEnabled: boolean;
  onToggleVoice: (v: boolean) => void;
  onStartVoice: () => void;
  onStopVoice: () => void;
  isListening: boolean;
  voiceMessages: { from: 'user' | 'ai'; text: string }[];
}

function intensityColor(i: number): string {
  if (i <= 2) return 'from-cyan-400 to-blue-500';
  if (i <= 4) return 'from-green-400 to-cyan-400';
  if (i <= 6) return 'from-yellow-400 to-orange-500';
  if (i <= 8) return 'from-orange-500 to-red-500';
  return 'from-red-600 to-red-800';
}

function MonsterCard({
  model,
  isActive,
  onSelect,
}: {
  model: MonsterModel;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(model.id)}
      className={`relative group flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all duration-200 ${
        isActive
          ? 'border-cyber-cyan bg-cyber-cyan/10 shadow-[0_0_12px_rgba(0,229,255,0.25)]'
          : 'border-slate-700/50 bg-slate-800/60 hover:border-slate-500 hover:bg-slate-700/60'
      }`}
    >
      <div className={`w-full h-1.5 rounded-full bg-gradient-to-r ${intensityColor(model.intensity)}`} />
      <span className={`text-xs font-medium truncate w-full text-center ${isActive ? 'text-cyber-cyan' : 'text-slate-300'}`}>
        {model.name}
      </span>
      <span className="text-[10px] text-slate-500 tabular-nums">Lv.{model.intensity}</span>
    </button>
  );
}

// Mouth animation constants
const MOUTH_ANIM_SPEED = 0.025;
const MOUTH_MIN_SCALE = 0.82;
const MOUTH_MAX_SCALE = 1.18;
const TALK_MS_PER_CHAR = 70;
const TALK_MIN_MS = 1500;
const TALK_MAX_MS = 4500;

const PERSONALITIES: CoachPersonality[] = ['gentle', 'strict', 'toxic', 'energetic'];

const EXERCISES: { type: ExerciseType; label: string; emoji: string }[] = [
  { type: 'squat', label: '深蹲', emoji: '🏋️' },
  { type: 'pushup', label: '俯卧撑', emoji: '💪' },
  { type: 'lunge', label: '弓步蹲', emoji: '🦵' },
  { type: 'plank', label: '平板支撑', emoji: '🧘' },
  { type: 'jumping_jack', label: '开合跳', emoji: '⭐' },
  { type: 'high_knees', label: '高抬腿', emoji: '🏃' },
  { type: 'idle', label: '自由', emoji: '🎯' },
];

// Exercise → intensity mapping
const EXERCISE_INTENSITY: Record<ExerciseType, number> = {
  idle: 1, squat: 5, pushup: 6, lunge: 5, plank: 4, jumping_jack: 8, high_knees: 9,
};

export default function LeftPanel({
  exercise,
  personality,
  isTraining,
  currentAction,
  feedbackItems,
  mode,
  reps,
  score,
  onToggleSession,
  onSetExercise,
  onSetPersonality,
  onSetMode,
  onOpenPlanModal,
  voiceEnabled,
  onToggleVoice,
  onStartVoice,
  onStopVoice,
  isListening,
  voiceMessages,
}: LeftPanelProps) {
  // Monster model state
  const [monsterMode, setMonsterMode] = useState<'auto' | 'manual'>('auto');
  const [manualId, setManualId] = useState<string>(MONSTER_MODELS[0].id);
  const [popupOpen, setPopupOpen] = useState(false);
  const [splineLoading, setSplineLoading] = useState(true);
  const [splineKey, setSplineKey] = useState(0);

  // Stable intensity: only update when change >= 2
  const rawIntensity = EXERCISE_INTENSITY[exercise] ?? 3;
  const [stableIntensity, setStableIntensity] = useState(rawIntensity);
  useEffect(() => {
    setStableIntensity((prev) => Math.abs(rawIntensity - prev) >= 2 ? rawIntensity : prev);
  }, [rawIntensity]);

  const autoModel = pickModel(stableIntensity);
  const activeModel = monsterMode === 'auto' ? autoModel : getModelById(manualId);

  // Mouth animation refs
  const splineAppRef = useRef<Application | null>(null);
  const mouthRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const originalMouthScaleRef = useRef<{ x: number; y: number; z: number } | null>(null);
  const animFrameRef = useRef<number>(0);

  const stopTalking = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (mouthRef.current && originalMouthScaleRef.current) {
      const o = originalMouthScaleRef.current;
      mouthRef.current.x = o.x;
      mouthRef.current.y = o.y;
      mouthRef.current.z = o.z;
    }
  }, []);

  const startTalking = useCallback(
    (message: string) => {
      if (!mouthRef.current || !originalMouthScaleRef.current) return;
      stopTalking();
      const orig = originalMouthScaleRef.current;
      const startTime = Date.now();
      const duration = Math.min(TALK_MAX_MS, Math.max(TALK_MIN_MS, message.length * TALK_MS_PER_CHAR));
      const animate = () => {
        if (!mouthRef.current) return;
        const elapsed = Date.now() - startTime;
        if (elapsed >= duration) { stopTalking(); return; }
        const t = elapsed * MOUTH_ANIM_SPEED;
        const amplitude = (MOUTH_MAX_SCALE - MOUTH_MIN_SCALE) / 2;
        const center = (MOUTH_MAX_SCALE + MOUTH_MIN_SCALE) / 2;
        mouthRef.current.y = orig.y * (center + Math.sin(t) * amplitude);
        splineAppRef.current?.requestRender();
        animFrameRef.current = requestAnimationFrame(animate);
      };
      animFrameRef.current = requestAnimationFrame(animate);
    },
    [stopTalking],
  );

  const handleSplineLoad = useCallback((app: Application) => {
    stopTalking();
    splineAppRef.current = app;
    const mouth = app.getAllObjects().find((o) => o.name.toLowerCase() === 'mouth');
    if (mouth) {
      mouthRef.current = mouth.scale;
      originalMouthScaleRef.current = { x: mouth.scale.x, y: mouth.scale.y, z: mouth.scale.z };
    } else {
      mouthRef.current = null;
      originalMouthScaleRef.current = null;
    }
    setSplineLoading(false);
  }, [stopTalking]);

  const handleSelectModel = useCallback(
    (id: string) => {
      stopTalking();
      setMonsterMode('manual');
      setManualId(id);
      setPopupOpen(false);
      setSplineKey((k) => k + 1);
      setSplineLoading(true);
    },
    [stopTalking],
  );

  const handleAutoMode = useCallback(() => {
    setMonsterMode('auto');
    setPopupOpen(false);
    if (autoModel.id !== activeModel.id) {
      stopTalking();
      setSplineKey((k) => k + 1);
      setSplineLoading(true);
    }
  }, [autoModel, activeModel, stopTalking]);

  // Watch last feedback → mouth animation
  const lastFeedbackRef = useRef<string>('');
  useEffect(() => {
    const latest = feedbackItems.length > 0 ? feedbackItems[feedbackItems.length - 1].text : '';
    if (latest && latest !== lastFeedbackRef.current) {
      lastFeedbackRef.current = latest;
      startTalking(latest);
    }
  }, [feedbackItems, startTalking]);

  useEffect(() => {
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, []);

  // Latest coach message
  const latestFeedback = feedbackItems.length > 0 ? feedbackItems[feedbackItems.length - 1] : null;
  const isAlert = latestFeedback?.type === 'warning' || latestFeedback?.type === 'error';
  const coachMessage = latestFeedback?.text ?? '等待开始训练...';

  return (
    <div className="flex flex-col h-full">
      {/* ── TOP: Coach Message Panel ──────────────────────────── */}
      <div
        className={`flex-[0.28] m-3 mb-2 rounded-2xl border backdrop-blur-md p-4 flex flex-col justify-center ${
          isAlert
            ? 'border-red-700/50 bg-red-950/70 shadow-[0_0_25px_rgba(220,38,38,0.3)]'
            : 'border-cyber-cyan/20 bg-slate-900/60 shadow-[0_0_25px_rgba(0,229,255,0.08)]'
        }`}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-xs font-bold uppercase tracking-[0.15em] ${isAlert ? 'text-red-400' : 'text-cyber-cyan'}`}>
            ⚠ AI 教练实时分析
          </span>
          {isAlert && (
            <span className="animate-pulse text-[10px] font-mono text-red-400/80 tracking-wider">● WARNING</span>
          )}
        </div>
        <p className={`text-base font-semibold leading-relaxed ${isAlert ? 'text-red-100' : 'text-white'}`}>
          &ldquo;{coachMessage}&rdquo;
        </p>
        <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-500 font-mono">
          <span>分数 {score}</span>
          <span>动作 {currentAction}</span>
          <span>次数 {reps}</span>
        </div>
      </div>

      {/* ── BOTTOM: 3D Model ──────────────────────────────────── */}
      <div className="flex-1 relative mx-3 mb-3">
        <div className="absolute inset-0">
          <Spline
            key={splineKey}
            scene={activeModel.url}
            onLoad={handleSplineLoad}
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        {/* Floor glow */}
        <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-cyber-cyan/25 via-cyber-cyan/5 to-transparent pointer-events-none" />
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-40 h-2.5 rounded-full bg-cyber-cyan/30 blur-[6px] pointer-events-none" />

        {/* Loading */}
        {splineLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center">
            <div className="w-10 h-10 border-2 border-cyber-cyan/30 border-t-cyber-cyan rounded-full animate-spin" />
            <span className="mt-3 text-xs text-cyber-cyan/60 tracking-wider font-mono">LOADING 3D MODEL</span>
          </div>
        )}

        {/* Model name */}
        <div className="absolute bottom-2 left-4 right-4 z-20 text-sm text-cyber-cyan/70 text-center truncate pointer-events-none font-mono tracking-wider">
          {activeModel.name}
        </div>

        {/* Controls */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
          <button
            onClick={() => setPopupOpen((v) => !v)}
            className="w-8 h-8 rounded-full border border-cyber-cyan/40 bg-cyber-dark/60 flex items-center justify-center hover:border-cyber-cyan hover:bg-cyber-dark/80 transition-all"
            title="切换怪兽"
          >
            <svg className="w-4 h-4 text-cyber-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6h16.5M3.75 12h16.5M12 17.25h8.25" />
            </svg>
          </button>
          <div
            className={`w-3 h-3 rounded-full flex-shrink-0 ${
              monsterMode === 'auto'
                ? 'bg-cyber-cyan shadow-[0_0_8px_rgba(0,229,255,0.7)]'
                : 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.5)]'
            }`}
            title={monsterMode === 'auto' ? '自动模式' : '手动模式'}
          />
        </div>
      </div>

      {/* ── Bottom Control Bar ────────────────────────────── */}
      <div className="mx-3 mb-3 p-3 rounded-xl border border-slate-700/40 bg-slate-900/60 backdrop-blur-md space-y-2.5">
        {/* Mode toggle */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 font-mono w-10 flex-shrink-0">模式</span>
          <div className="flex gap-1 flex-1">
            {(['local', 'remote'] as const).map((m) => (
              <button
                key={m}
                onClick={() => onSetMode(m)}
                className={`flex-1 text-xs py-1.5 rounded-lg border transition-all ${
                  mode === m
                    ? 'border-cyber-cyan/50 bg-cyber-cyan/10 text-cyber-cyan'
                    : 'border-slate-600/40 bg-slate-800/50 text-slate-400 hover:text-slate-200'
                }`}
              >
                {m === 'local' ? '摄像头' : '树莓派'}
              </button>
            ))}
          </div>
        </div>

        {/* Exercise selector */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 font-mono w-10 flex-shrink-0">运动</span>
          <div className="flex gap-1 flex-1 overflow-x-auto no-scrollbar">
            {EXERCISES.map((ex) => (
              <button
                key={ex.type}
                onClick={() => onSetExercise(ex.type)}
                className={`flex-shrink-0 text-xs px-2 py-1.5 rounded-lg border transition-all ${
                  exercise === ex.type
                    ? 'border-cyber-cyan/50 bg-cyber-cyan/10 text-cyber-cyan'
                    : 'border-slate-600/40 bg-slate-800/50 text-slate-400 hover:text-slate-200'
                }`}
              >
                {ex.emoji} {ex.label}
              </button>
            ))}
          </div>
        </div>

        {/* Personality selector */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 font-mono w-10 flex-shrink-0">性格</span>
          <div className="flex gap-1 flex-1">
            {PERSONALITIES.map((p) => (
              <button
                key={p}
                onClick={() => onSetPersonality(p)}
                className={`flex-1 text-xs py-1.5 rounded-lg border transition-all ${
                  personality === p
                    ? 'border-cyber-cyan/50 bg-cyber-cyan/10 text-cyber-cyan'
                    : 'border-slate-600/40 bg-slate-800/50 text-slate-400 hover:text-slate-200'
                }`}
              >
                {PERSONALITY_EMOJI[p]} {PERSONALITY_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Voice + Plan + Start/Stop */}
        <div className="flex items-center gap-2 pt-1 border-t border-slate-700/30">
          <button
            onClick={() => onToggleVoice(!voiceEnabled)}
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
              voiceEnabled
                ? 'border-cyber-cyan/50 bg-cyber-cyan/10 text-cyber-cyan'
                : 'border-slate-600/40 bg-slate-800/50 text-slate-400'
            }`}
          >
            {voiceEnabled ? '🔊' : '🔇'}
          </button>

          <button
            onMouseDown={onStartVoice}
            onMouseUp={onStopVoice}
            onTouchStart={onStartVoice}
            onTouchEnd={onStopVoice}
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
              isListening
                ? 'border-red-500/50 bg-red-500/10 text-red-400 animate-pulse'
                : 'border-slate-600/40 bg-slate-800/50 text-slate-400'
            }`}
          >
            {isListening ? '🎙️...' : '🎙️'}
          </button>

          <button
            onClick={onOpenPlanModal}
            className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-600/40 bg-slate-800/50 text-slate-400 hover:text-slate-200 transition-all"
          >
            📋 计划
          </button>

          <button
            onClick={onToggleSession}
            className={`flex-1 text-xs py-2 rounded-lg font-semibold tracking-wider transition-all ${
              isTraining
                ? 'bg-red-600/80 text-white border border-red-500/50 hover:bg-red-500/90 shadow-[0_0_15px_rgba(239,68,68,0.3)]'
                : 'bg-cyber-cyan/20 text-cyber-cyan border border-cyber-cyan/40 hover:bg-cyber-cyan/30 shadow-[0_0_15px_rgba(0,229,255,0.2)]'
            }`}
          >
            {isTraining ? '⏹ 暂停' : '▶ 开始训练'}
          </button>
        </div>
      </div>

      {/* ── Voice messages ────────────────────────────────── */}
      {voiceMessages.length > 0 && (
        <div className="mx-3 mb-3 max-h-24 overflow-y-auto space-y-1 no-scrollbar">
          {voiceMessages.slice(-4).map((msg, i) => (
            <div key={i} className={`text-[11px] font-mono px-2.5 py-1.5 rounded-lg ${
              msg.from === 'user' ? 'bg-slate-800/50 text-slate-400' : 'bg-cyber-cyan/10 text-cyber-cyan/80'
            }`}>
              {msg.from === 'user' ? '🗣️' : '🤖'} {msg.text}
            </div>
          ))}
        </div>
      )}

      {/* ── Popup: Monster Selector ───────────────────────────── */}
      {popupOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-start p-6" onClick={() => setPopupOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg mb-8 ml-4 rounded-2xl border border-slate-700/60 bg-slate-900/85 backdrop-blur-xl shadow-2xl p-5 animate-slide-up"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white tracking-wide">选择 AI 教练形象</h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleAutoMode}
                  className={`text-xs px-3 py-1 rounded-full border transition-all ${
                    monsterMode === 'auto'
                      ? 'border-cyber-cyan/50 bg-cyber-cyan/15 text-cyber-cyan'
                      : 'border-slate-600/50 bg-slate-800/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  AUTO
                </button>
                <button onClick={() => setPopupOpen(false)} className="text-slate-400 hover:text-white transition-colors text-lg leading-none">✕</button>
              </div>
            </div>

            {monsterMode === 'auto' && (
              <p className="text-[11px] text-slate-500 mb-3">
                自动匹配 · 强度指数 {stableIntensity}/10 · 当前 {autoModel.name}
              </p>
            )}

            <div className="grid grid-cols-4 gap-2.5">
              {MONSTER_MODELS.map((m) => (
                <MonsterCard
                  key={m.id}
                  model={m}
                  isActive={activeModel.id === m.id && monsterMode === 'manual'}
                  onSelect={handleSelectModel}
                />
              ))}
            </div>

            {/* Personality selector inside popup */}
            <div className="mt-5 pt-4 border-t border-slate-700/50">
              <h4 className="text-xs font-semibold text-white tracking-wide mb-3">
                定制灵魂 <span className="text-slate-500 font-normal">Customize Personality</span>
              </h4>
              <div className="grid grid-cols-2 gap-1.5">
                {PERSONALITIES.map((p) => (
                  <button
                    key={p}
                    onClick={() => onSetPersonality(p)}
                    className={`text-xs px-3 py-2 rounded-lg border transition-all text-left ${
                      personality === p
                        ? 'border-cyber-cyan/50 bg-cyber-cyan/10 text-cyber-cyan'
                        : 'border-slate-600/40 bg-slate-800/50 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                    }`}
                  >
                    <span className="mr-1.5">{PERSONALITY_EMOJI[p]}</span>
                    {PERSONALITY_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
