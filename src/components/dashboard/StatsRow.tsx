'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import HeartIcon from './HeartIcon';
import ProgressRing from './ProgressRing';
import type { Workout, Biometrics } from '@/types/dashboard';

interface StatsRowProps {
  workout: Workout;
  biometrics: Biometrics;
  onOpenPlanModal: () => void;
  isRunning: boolean;
}

const MUSIC_TRACKS = [
  { id: 'cyber', label: '赛博电音', icon: '🎧' },
  { id: 'rock', label: '热血燃曲', icon: '🔥' },
  { id: 'zen', label: '禅意拉伸', icon: '🧘' },
] as const;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** Web Audio API 简单节奏生成器 */
function createMusicPlayer() {
  let ctx: AudioContext | null = null;
  let playing = false;
  let trackId = 'cyber';
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let gainNode: GainNode | null = null;

  const patterns: Record<string, { bpm: number; notes: number[]; freq: number }> = {
    cyber: { bpm: 128, notes: [0, 0.5, 1, 0.5, 0.75, 0.25], freq: 80 },
    rock: { bpm: 140, notes: [1, 0.75, 0.5, 1, 0.5, 0.25], freq: 100 },
    zen: { bpm: 60, notes: [0.5, 0, 0.25, 0, 0.5, 0, 0.25, 0], freq: 60 },
  };

  function start() {
    if (playing) return;
    ctx = new AudioContext();
    gainNode = ctx.createGain();
    gainNode.gain.value = 0.08;
    gainNode.connect(ctx.destination);
    playing = true;
    playLoop();
  }

  function stop() {
    playing = false;
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    if (ctx) { ctx.close(); ctx = null; }
  }

  function setTrack(id: string) { trackId = id; }

  function playLoop() {
    if (!ctx || !gainNode) return;
    const pattern = patterns[trackId];
    const beatMs = (60 / pattern.bpm) * 1000;
    let step = 0;

    function tick() {
      if (!ctx || !gainNode) return;
      const vol = pattern.notes[step % pattern.notes.length];
      if (vol > 0) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = trackId === 'zen' ? 'sine' : 'square';
        osc.frequency.value = pattern.freq * (1 + (step % 4) * 0.5);
        g.gain.setValueAtTime(vol * 0.06, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.connect(g);
        g.connect(gainNode!);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      }
      step++;
    }

    intervalId = setInterval(tick, beatMs / 4);
    tick();
  }

  return { start, stop, setTrack };
}

export default function StatsRow({ workout, biometrics, onOpenPlanModal, isRunning }: StatsRowProps) {
  const isHrHigh = biometrics.heartRate > biometrics.hrThreshold;
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);
  const playerRef = useRef(createMusicPlayer());
  const [musicOn, setMusicOn] = useState(false);
  const [musicTrack, setMusicTrack] = useState('cyber');
  const [musicOpen, setMusicOpen] = useState(false);

  // 训练计时
  useEffect(() => {
    if (isRunning) {
      startRef.current = Date.now();
      setElapsed(0);
      const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
      return () => clearInterval(timer);
    }
    setElapsed(0);
  }, [isRunning]);

  // 音乐开关
  const toggleMusic = useCallback(() => {
    if (musicOn) {
      playerRef.current.stop();
      setMusicOn(false);
    } else {
      playerRef.current = createMusicPlayer();
      playerRef.current.setTrack(musicTrack);
      playerRef.current.start();
      setMusicOn(true);
    }
  }, [musicOn, musicTrack]);

  const changeTrack = useCallback((id: string) => {
    setMusicTrack(id);
    setMusicOpen(false);
    if (musicOn) {
      playerRef.current.stop();
      const p = createMusicPlayer();
      playerRef.current = p;
      p.setTrack(id);
      p.start();
    }
  }, [musicOn]);

  // 训练停止时关音乐
  useEffect(() => {
    if (!isRunning && musicOn) {
      playerRef.current.stop();
      setMusicOn(false);
    }
  }, [isRunning, musicOn]);

  return (
    <div className="flex items-stretch gap-3 px-4 py-2">
      {/* 控制按钮组 */}
      <div className="flex flex-col gap-2 w-[150px] flex-shrink-0">
        {/* 音乐选择器 */}
        <div className="relative flex-1">
          <button
            onClick={() => setMusicOpen((v) => !v)}
            className={`w-full h-full flex items-center justify-between gap-1.5 rounded-xl backdrop-blur-md px-3 py-2 transition-all text-left ${
              musicOn
                ? 'bg-cyber-cyan/15 border border-cyber-cyan/40'
                : 'bg-slate-900/40 border border-cyber-cyan/20 hover:border-cyber-cyan/40'
            }`}
          >
            <span className="text-[9px] text-slate-500 font-mono uppercase tracking-wider leading-tight">
              音乐
            </span>
            <span className={`text-[10px] font-mono truncate ${musicOn ? 'text-cyber-cyan' : 'text-slate-400'}`}>
              {MUSIC_TRACKS.find(t => t.id === musicTrack)?.label || '无'}
            </span>
            <svg className="w-3 h-3 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
          {musicOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMusicOpen(false)} />
              <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-lg border border-slate-600/50 bg-slate-800/95 backdrop-blur-xl shadow-xl py-1 overflow-hidden">
                {MUSIC_TRACKS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => changeTrack(t.id)}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-mono transition-colors ${
                      t.id === musicTrack
                        ? 'text-cyber-cyan bg-cyber-cyan/10'
                        : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                    }`}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* 音乐播放/暂停 + 计时器 */}
        <button
          onClick={toggleMusic}
          className={`flex-1 group relative rounded-xl backdrop-blur-md px-3 py-2 transition-all duration-300 overflow-hidden ${
            musicOn
              ? 'bg-cyber-cyan/15 border border-cyber-cyan/40'
              : 'bg-slate-900/40 border border-cyber-cyan/20 hover:border-cyber-cyan/50'
          }`}
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-sm">{musicOn ? '⏸' : '▶'}</span>
            <span className="text-[10px] font-mono text-cyber-cyan tabular-nums">
              {isRunning ? formatTime(elapsed) : '--:--'}
            </span>
          </div>
        </button>
        <button
          onClick={onOpenPlanModal}
          className="flex-1 group relative rounded-xl bg-slate-900/40 backdrop-blur-md
                     border border-cyber-cyan/20 hover:border-cyber-cyan/50
                     px-3 py-2 transition-all duration-300 overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-cyber-cyan/0 via-cyber-cyan/5 to-cyber-cyan/0 opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative flex items-center justify-center gap-1.5">
            <span className="text-xs group-hover:animate-pulse">⚡</span>
            <span className="text-[10px] font-semibold text-cyber-cyan tracking-wide group-hover:drop-shadow-[0_0_6px_rgba(0,229,255,0.5)] transition-all whitespace-nowrap">
              AI 定制计划
            </span>
          </div>
        </button>
      </div>

      {/* 动作 */}
      <div className="flex-1 rounded-xl bg-slate-900/50 backdrop-blur-md border-t border-t-cyan-500/50 border-x border-x-slate-700/30 border-b border-b-slate-700/30 p-3 flex flex-col justify-center">
        <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">动作</span>
        <p className="mt-1 text-base font-semibold text-white truncate">{workout.currentAction}</p>
      </div>

      {/* 心率 */}
      <div
        className={`flex-1 rounded-xl backdrop-blur-md p-3 flex flex-col justify-center ${
          isHrHigh
            ? 'bg-red-950/50 border-t border-t-red-500/50 border-x border-x-red-800/30 border-b border-b-red-800/30'
            : 'bg-slate-900/50 border-t border-t-cyan-500/50 border-x border-x-slate-700/30 border-b border-b-slate-700/30'
        }`}
      >
        <div className="flex items-start justify-between">
          <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">心率</span>
          <HeartIcon />
        </div>
        <div className="flex items-baseline gap-1 mt-1">
          <span className={`text-xl font-bold font-mono tabular-nums ${isHrHigh ? 'text-red-400' : 'text-white'}`}>
            {biometrics.heartRate || '--'}
          </span>
          {biometrics.heartRate > 0 && <span className="text-[10px] text-slate-400 font-mono">BPM</span>}
        </div>
      </div>

      {/* 次数 */}
      <div className="flex-1 rounded-xl bg-slate-900/50 backdrop-blur-md border-t border-t-cyan-500/50 border-x border-x-slate-700/30 border-b border-b-slate-700/30 p-3 flex flex-col justify-center">
        <div className="flex items-start justify-between">
          <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">次数</span>
          {workout.isFormDeformed && (
            <span className="inline-flex items-center gap-1 rounded-md bg-red-900/60 px-1.5 py-0.5 text-[9px] font-semibold text-red-300 border border-red-700/40">
              ⚠ 变形
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1 mt-1">
          <span className="text-xl font-bold text-cyber-cyan font-mono tabular-nums">{workout.reps}</span>
          <span className="text-[10px] text-slate-500 font-mono tabular-nums">/ {workout.targetReps}</span>
        </div>
      </div>

      {/* 分数 */}
      <div className="flex-1 rounded-xl bg-slate-900/50 backdrop-blur-md border-t border-t-cyan-500/50 border-x border-x-slate-700/30 border-b border-b-slate-700/30 p-3 flex flex-col justify-center">
        <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">分数</span>
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs font-medium text-cyber-cyan">
            {workout.score >= 80 ? '优秀' : workout.score >= 60 ? '继续' : '加油'}
          </p>
          <ProgressRing value={workout.score} max={100} />
        </div>
      </div>
    </div>
  );
}
