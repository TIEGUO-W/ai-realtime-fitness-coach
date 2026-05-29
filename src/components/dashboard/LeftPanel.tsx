'use client';

import { useState, useEffect, useRef, useCallback, useSyncExternalStore, type ComponentProps } from 'react';
import { LazySpline } from './SplineLoader';
import type { DashboardData, CoachPersonality, CoachVoice, ChatMessage } from '@/types/dashboard';
import type { Application as SplineApp } from '@splinetool/runtime';

/* ─── Hydration-safe client detection ─── */
const emptySubscribe = () => () => {};
const useIsClient = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

/* ─── Monster Models ─── */
const MONSTERS = [
  { name: 'Flame', splineUrl: 'https://prod.spline.design/6Wq1Q7YGyM-iab9i/scene.splinecode' },
  { name: 'Aqua', splineUrl: 'https://prod.spline.design/YxVlKTICvsE5rO3P/scene.splinecode' },
  { name: 'Shadow', splineUrl: 'https://prod.spline.design/4tX2NbBfymmMEP6R/scene.splinecode' },
];

const PERSONALITY_CONFIG: Record<CoachPersonality, { label: string; emoji: string; color: string }> = {
  gentle: { label: '温柔', emoji: '🌸', color: 'text-pink-400' },
  strict: { label: '严格', emoji: '🎯', color: 'text-orange-400' },
  toxic: { label: '毒舌', emoji: '🔥', color: 'text-red-400' },
  energetic: { label: '活力', emoji: '⚡', color: 'text-yellow-400' },
};

const VOICE_CONFIG: Record<CoachVoice, { label: string; emoji: string }> = {
  female_soft: { label: '温柔女声', emoji: '👩' },
  male_energetic: { label: '活力男声', emoji: '🧑' },
  male_strict: { label: '严格男声', emoji: '👨‍🏫' },
  anime_fire: { label: '热血动漫', emoji: '🔥' },
};

/* ─── Types ─── */
interface LeftPanelProps {
  data: DashboardData;
  personality: CoachPersonality;
  voice: CoachVoice;
  onPersonalityChange: (p: CoachPersonality) => void;
  onVoiceChange: (v: CoachVoice) => void;
  isSpeaking: boolean;
  coachMessage: string;
  chatMessages: ChatMessage[];
}

/* ─── Component ─── */
export default function LeftPanel({
  data,
  personality,
  voice,
  onPersonalityChange,
  onVoiceChange,
  isSpeaking,
  coachMessage,
  chatMessages,
}: LeftPanelProps) {
  const isClient = useIsClient();
  const [activeModel, setActiveModel] = useState(0);
  const [splineLoading, setSplineLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const splineRef = useRef<SplineApp | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /* ─── Spline mouth animation ─── */
  const stopTalking = useCallback(() => {
    const app = splineRef.current;
    if (!app) return;
    try {
      const mouth = app.findObjectByName('mouth');
      if (mouth && 'scale' in mouth) {
        (mouth.scale as { y: number }).y = 1;
      }
    } catch { /* ignore */ }
  }, []);

  const startTalking = useCallback(() => {
    const app = splineRef.current;
    if (!app) return;
    try {
      const mouth = app.findObjectByName('mouth');
      if (!mouth) return;
      let frame = 0;
      const animate = () => {
        if (!splineRef.current) return;
        frame++;
        if (mouth && 'scale' in mouth) {
          (mouth.scale as { y: number }).y = 1 + Math.sin(frame * 0.5) * 0.3;
        }
        if (splineRef.current) requestAnimationFrame(animate);
      };
      animate();
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (isSpeaking) { startTalking(); }
    else { stopTalking(); }
  }, [isSpeaking, startTalking, stopTalking]);

  /* ─── Scroll chat to bottom ─── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const currentMonster = MONSTERS[activeModel];
  const pConfig = PERSONALITY_CONFIG[personality];

  return (
    <div className="flex flex-col h-full bg-cyber-panel/40">
      {/* ═══ Monster Zone ════════════════════════════ */}
      <div className="relative w-full aspect-square max-h-[320px]">
        {splineLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-cyber-cyan/20 border-t-cyber-cyan rounded-full animate-spin" />
          </div>
        )}
        <LazySpline
          scene={currentMonster.splineUrl}
          onLoad={(spline) => {
            splineRef.current = spline as SplineApp;
            setSplineLoading(false);
            const mouth = (spline as { findObjectByName?: (n: string) => Record<string, unknown> })?.findObjectByName?.('mouth');
            if (mouth) console.log('[Spline] Found mouth object');
            else console.warn('[Spline] No mouth object found');
          }}
        />

        {/* Speaking indicator */}
        {isSpeaking && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyber-cyan/10 backdrop-blur-sm px-2 py-0.5 text-[9px] text-cyber-cyan font-mono border border-cyber-cyan/15 animate-pulse">
              <span className="w-1 h-1 rounded-full bg-cyber-cyan" />
              说话中
            </span>
          </div>
        )}
      </div>

      {/* ═══ Monster Selector ════════════════════════════ */}
      <div className="flex items-center justify-center gap-1.5 px-4 py-2">
        {MONSTERS.map((m, i) => (
          <button
            key={m.name}
            onClick={() => { setActiveModel(i); setSplineLoading(true); }}
            className={`text-[10px] px-2.5 py-1 rounded-lg border transition-all font-mono ${
              activeModel === i
                ? 'border-cyber-cyan/25 bg-cyber-cyan/8 text-cyber-cyan'
                : 'border-white/[0.04] bg-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {m.name}
          </button>
        ))}
      </div>

      {/* ═══ Coach Message ════════════════════════════ */}
      <div className="px-4 py-2">
        <div className="rounded-xl bg-cyber-dark/60 border border-white/[0.04] p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-cyber-cyan/60 font-mono">
              AI Coach
            </span>
            <span className={`text-[9px] ${pConfig.color}`}>{pConfig.emoji}</span>
          </div>
          <p className="text-[13px] leading-relaxed text-white/90">
            {isClient ? (coachMessage || '准备好了吗？') : '准备好了吗？'}
          </p>
        </div>
      </div>

      {/* ═══ Chat Bubbles ════════════════════════════ */}
      <div className="flex-1 overflow-y-auto px-4 py-1 space-y-1.5 min-h-0">
        {isClient && chatMessages.slice(-8).map((msg, i) => (
          <div key={msg.timestamp + '-' + i} className={`flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-1.5 text-[11px] leading-relaxed ${
              msg.from === 'user'
                ? 'bg-cyber-cyan/12 border border-cyber-cyan/15 text-cyber-cyan'
                : 'bg-white/[0.04] border border-white/[0.04] text-slate-300'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* ═══ Settings Panel ════════════════════════════ */}
      <div className="px-4 py-3 border-t border-white/[0.04]">
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 hover:text-slate-300 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.107-1.204l-.527-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          教练设置
          <svg className={`w-2.5 h-2.5 transition-transform ${settingsOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {settingsOpen && (
          <div className="mt-3 space-y-3 animate-in slide-in-from-bottom-2 duration-200">
            {/* Personality */}
            <div>
              <span className="text-[9px] font-mono text-slate-500 tracking-wider uppercase">性格</span>
              <div className="flex gap-1 mt-1">
                {(Object.entries(PERSONALITY_CONFIG) as [CoachPersonality, typeof PERSONALITY_CONFIG.gentle][]).map(([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => onPersonalityChange(key)}
                    className={`flex-1 text-[10px] px-1.5 py-1 rounded-lg border transition-all ${
                      personality === key
                        ? `border-white/10 bg-white/[0.06] ${cfg.color}`
                        : 'border-white/[0.04] text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {cfg.emoji} {cfg.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Voice */}
            <div>
              <span className="text-[9px] font-mono text-slate-500 tracking-wider uppercase">语音</span>
              <div className="grid grid-cols-2 gap-1 mt-1">
                {(Object.entries(VOICE_CONFIG) as [CoachVoice, typeof VOICE_CONFIG.female_soft][]).map(([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => onVoiceChange(key)}
                    className={`text-[10px] px-1.5 py-1 rounded-lg border transition-all text-left ${
                      voice === key
                        ? 'border-cyber-cyan/20 bg-cyber-cyan/8 text-cyber-cyan'
                        : 'border-white/[0.04] text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {cfg.emoji} {cfg.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
