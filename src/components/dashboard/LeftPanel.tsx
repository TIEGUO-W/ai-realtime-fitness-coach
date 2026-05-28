'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import type { DashboardData, CoachPersonality, CoachVoice } from '@/types/dashboard';
import {
  MONSTER_MODELS,
  computeIntensity,
  pickModel,
  getModelById,
} from '@/data/monsters';
import type { MonsterModel } from '@/data/monsters';
import { PERSONALITY_LABELS, PERSONALITY_EMOJI, VOICE_LABELS } from '@/utils/coachVoice';

// Dynamic import Spline to avoid SSR issues
const Spline = dynamic(() => import('@splinetool/react-spline'), { ssr: false });

interface LeftPanelProps {
  data: DashboardData;
  personality: CoachPersonality;
  voice: CoachVoice;
  onPersonalityChange: (p: CoachPersonality) => void;
  onVoiceChange: (v: CoachVoice) => void;
  isSpeaking?: boolean;
  coachMessage?: string;
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
const VOICES: CoachVoice[] = ['female_soft', 'male_energetic', 'male_strict', 'anime_fire'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SplineApp = any;

export default function LeftPanel({
  data,
  personality,
  voice,
  onPersonalityChange,
  onVoiceChange,
  isSpeaking = false,
  coachMessage = '',
}: LeftPanelProps) {
  const { assistant, biometrics, workout } = data;

  const rawIntensity = computeIntensity(
    biometrics.heartRate,
    biometrics.hrThreshold,
    workout.isFormDeformed,
  );

  const [stableIntensity, setStableIntensity] = useState(rawIntensity);
  const prevIntensityRef = useRef(rawIntensity);

  useEffect(() => {
    if (Math.abs(rawIntensity - prevIntensityRef.current) >= 2) {
      prevIntensityRef.current = rawIntensity;
      setStableIntensity(rawIntensity);
    }
  }, [rawIntensity]);

  const autoModel = pickModel(stableIntensity);

  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [manualId, setManualId] = useState<string>(autoModel.id);
  const [popupOpen, setPopupOpen] = useState(false);
  const [splineLoading, setSplineLoading] = useState(true);
  const [splineKey, setSplineKey] = useState(0);
  const [showQr, setShowQr] = useState(false);
  const [qrUrl, setQrUrl] = useState('');

  const activeModel = mode === 'auto' ? autoModel : getModelById(manualId);

  // Mouth animation refs
  const splineAppRef = useRef<SplineApp | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSplineLoad = useCallback((app: any) => {
    stopTalking();
    splineAppRef.current = app;
    // Try multiple common mouth object names
    const allObjects = (app as any).getAllObjects();
    const mouth = allObjects.find(
      (o: any) => ['mouth', 'mouth_object', 'Mouth', 'jaw', 'Jaw'].includes(o.name),
    );
    if (mouth) {
      console.log('[Spline] Found mouth object:', mouth.name);
      mouthRef.current = mouth.scale;
      originalMouthScaleRef.current = { x: mouth.scale.x, y: mouth.scale.y, z: mouth.scale.z };
    } else {
      console.warn('[Spline] No mouth object found. Available objects:', allObjects.map((o: any) => o.name).join(', '));
      mouthRef.current = null;
      originalMouthScaleRef.current = null;
    }
    setSplineLoading(false);
  }, [stopTalking]);

  const handleSelectModel = useCallback(
    (id: string) => {
      stopTalking();
      setMode('manual');
      setManualId(id);
      setPopupOpen(false);
      setSplineKey(k => k + 1);
      setSplineLoading(true);
    },
    [stopTalking],
  );

  const handleAutoMode = useCallback(() => {
    setMode('auto');
    setPopupOpen(false);
    if (autoModel.id !== activeModel.id) {
      stopTalking();
      setSplineKey(k => k + 1);
      setSplineLoading(true);
    }
  }, [autoModel, activeModel, stopTalking]);

  // Track speaking state with ref to avoid re-render dependency issues
  const prevIsSpeakingRef = useRef(false);
  useEffect(() => {
    const speakingChanged = isSpeaking !== prevIsSpeakingRef.current;
    prevIsSpeakingRef.current = isSpeaking;
    if (isSpeaking && (coachMessage || assistant.message)) {
      startTalking(coachMessage || assistant.message);
    } else if (!isSpeaking && speakingChanged) {
      stopTalking();
    }
  }, [isSpeaking, assistant.message, startTalking, stopTalking, coachMessage]);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  useEffect(() => {
    // 优先用环境变量，其次用当前域名；localhost 替换为 LAN IP 供手机扫码
    let origin = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin;
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      origin = `http://${window.location.hostname}:5000`;  // fallback: 同端口当前host
      // 如果 hostname 也是 localhost，用固定 LAN IP
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        origin = 'http://172.27.9.109:5000';
      }
    }
    setQrUrl(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`${origin}/health`)}&bgcolor=0F1117&color=E8E9ED`);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Coach Message Panel */}
      <div
        className={`flex-[0.28] m-3 mb-2 rounded-2xl border backdrop-blur-md p-4 flex flex-col justify-center ${
          assistant.isAlert
            ? 'border-red-700/50 bg-red-950/70 shadow-[0_0_25px_rgba(220,38,38,0.3)]'
            : 'border-cyber-cyan/20 bg-slate-900/60 shadow-[0_0_25px_rgba(0,229,255,0.08)]'
        }`}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-xs font-bold uppercase tracking-[0.15em] ${assistant.isAlert ? 'text-red-400' : 'text-cyber-cyan'}`}>
            {'⚠'} AI 教练实时分析
          </span>
          {assistant.isAlert && (
            <span className="animate-pulse text-[10px] font-mono text-red-400/80 tracking-wider">
              ● WARNING
            </span>
          )}
        </div>
        <p className={`text-base font-semibold leading-relaxed ${assistant.isAlert ? 'text-red-100' : 'text-white'}`}>
          &ldquo;{assistant.message}&rdquo;
        </p>
        <div className="mt-3 flex items-center gap-4 text-[11px] text-slate-500 font-mono">
          <span>心率 {biometrics.heartRate} BPM</span>
          <span>分数 {workout.score}</span>
          <span>动作 {workout.currentAction}</span>
        </div>
      </div>

      {/* QR 码按钮 */}
      <div className="mx-3 mb-2">
        <button
          onClick={() => setShowQr(true)}
          className="w-full flex items-center gap-2 rounded-xl border border-[#00E5FF]/30 bg-[#00E5FF]/5 px-3 py-2 hover:bg-[#00E5FF]/10 transition-colors"
        >
          <span className="text-base">📱</span>
          <span className="text-xs text-[#E8E9ED]">扫码连接健康数据</span>
          <span className="ml-auto text-[10px] text-[#00E5FF]/60">QR</span>
        </button>
      </div>

      {/* QR 码弹窗 */}
      {showQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowQr(false)}>
          <div
            className="rounded-2xl bg-[#0F1117] border border-[#1A1D27] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center mb-4">
              <h3 className="text-base font-semibold text-[#E8E9ED]">扫码连接健康数据</h3>
              <p className="text-xs text-[#8B8FA3] mt-1">手机扫码 → 填资料 → 授权 Apple Health</p>
            </div>
            {qrUrl && (
              <img src={qrUrl} alt="QR码" className="h-52 w-52 rounded-xl border border-[#1A1D27] mx-auto" />
            )}
            <button
              onClick={() => setShowQr(false)}
              className="w-full mt-4 rounded-lg bg-[#1A1D27] hover:bg-[#252836] text-sm text-[#E8E9ED] py-2 transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* 3D Model */}
      <div className="flex-1 relative mx-3 mb-3">
        <div className="absolute inset-0">
          <Spline
            key={splineKey}
            scene={activeModel.url}
            onLoad={handleSplineLoad}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
        <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-cyber-cyan/25 via-cyber-cyan/5 to-transparent pointer-events-none" />
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-40 h-2.5 rounded-full bg-cyber-cyan/30 blur-[6px] pointer-events-none" />
        {splineLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center">
            <div className="w-10 h-10 border-2 border-cyber-cyan/30 border-t-cyber-cyan rounded-full animate-spin" />
            <span className="mt-3 text-xs text-cyber-cyan/60 tracking-wider font-mono">
              LOADING 3D MODEL
            </span>
          </div>
        )}
        <div className="absolute bottom-2 left-4 right-4 z-20 text-sm text-cyber-cyan/70 text-center truncate pointer-events-none font-mono tracking-wider">
          {activeModel.name}
        </div>
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
              mode === 'auto'
                ? 'bg-cyber-cyan shadow-[0_0_8px_rgba(0,229,255,0.7)]'
                : 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.5)]'
            }`}
            title={mode === 'auto' ? '自动模式' : '手动模式'}
          />
        </div>
      </div>

      {/* Popup: Monster Selector */}
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
                    mode === 'auto'
                      ? 'border-cyber-cyan/50 bg-cyber-cyan/15 text-cyber-cyan'
                      : 'border-slate-600/50 bg-slate-800/60 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  AUTO
                </button>
                <button onClick={() => setPopupOpen(false)} className="text-slate-400 hover:text-white transition-colors text-lg leading-none">
                  ✕
                </button>
              </div>
            </div>
            {mode === 'auto' && (
              <p className="text-[11px] text-slate-500 mb-3">
                自动匹配 · 强度指数 {stableIntensity}/10 · 当前 {autoModel.name}
              </p>
            )}
            <div className="grid grid-cols-4 gap-2.5">
              {MONSTER_MODELS.map((m) => (
                <MonsterCard
                  key={m.id}
                  model={m}
                  isActive={activeModel.id === m.id && mode === 'manual'}
                  onSelect={handleSelectModel}
                />
              ))}
            </div>
            {/* Personality & Voice */}
            <div className="mt-5 pt-4 border-t border-slate-700/50">
              <h4 className="text-xs font-semibold text-white tracking-wide mb-3">
                定制灵魂 <span className="text-slate-500 font-normal">Customize Personality & Voice</span>
              </h4>
              <div className="mb-3">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block">性格 Personality</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {PERSONALITIES.map((p) => (
                    <button
                      key={p}
                      onClick={() => onPersonalityChange(p)}
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
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block">音色 Voice</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {VOICES.map((v) => (
                    <button
                      key={v}
                      onClick={() => onVoiceChange(v)}
                      className={`text-xs px-3 py-2 rounded-lg border transition-all text-left ${
                        voice === v
                          ? 'border-cyber-cyan/50 bg-cyber-cyan/10 text-cyber-cyan'
                          : 'border-slate-600/40 bg-slate-800/50 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                      }`}
                    >
                      {VOICE_LABELS[v]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
