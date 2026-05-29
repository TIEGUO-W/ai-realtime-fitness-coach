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

/* =========================================================
   真实节拍合成器 — Web Audio API
   Kick / Snare / HiHat / Bass / Lead 全部程序合成
   ========================================================= */

type DrumStep = { kick: boolean; snare: boolean; hihat: boolean; openHat: boolean };

// 16-step drum patterns (1 bar = 16 sixteenth notes)
const DRUM_PATTERNS: Record<string, DrumStep[]> = {
  cyber: [
    { kick: true,  snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: true,  hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: true,  snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: true,  snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: true,  hihat: true,  openHat: true  },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: true,  snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
  ],
  rock: [
    { kick: true,  snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: true,  openHat: false },
    { kick: false, snare: true,  hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: true,  openHat: false },
    { kick: true,  snare: false, hihat: true,  openHat: false },
    { kick: true,  snare: false, hihat: true,  openHat: false },
    { kick: true,  snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: true,  openHat: false },
    { kick: false, snare: true,  hihat: true,  openHat: true  },
    { kick: false, snare: false, hihat: true,  openHat: false },
    { kick: true,  snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: true,  openHat: false },
  ],
  zen: [
    { kick: true,  snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: true,  openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: true,  snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: true,  openHat: true  },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
    { kick: false, snare: false, hihat: false, openHat: false },
  ],
};

// Bass note patterns (MIDI note numbers, 0 = rest)
const BASS_PATTERNS: Record<string, number[][]> = {
  cyber: [
    [36, 0, 0, 36, 0, 0, 36, 0, 36, 0, 0, 36, 0, 0, 36, 0],
    [36, 0, 0, 36, 0, 0, 38, 0, 36, 0, 0, 36, 0, 0, 34, 0],
  ],
  rock: [
    [28, 0, 0, 28, 0, 0, 28, 0, 28, 0, 0, 28, 0, 0, 31, 0],
    [28, 0, 0, 28, 0, 0, 31, 0, 28, 0, 0, 28, 0, 0, 26, 0],
  ],
  zen: [
    [36, 0, 0, 0, 0, 0, 0, 0, 36, 0, 0, 0, 0, 0, 0, 0],
    [38, 0, 0, 0, 0, 0, 0, 0, 36, 0, 0, 0, 0, 0, 0, 0],
  ],
};

// Lead melody patterns
const LEAD_PATTERNS: Record<string, number[][]> = {
  cyber: [
    [60, 0, 63, 0, 67, 0, 0, 72, 0, 0, 67, 0, 63, 0, 60, 0],
    [72, 0, 70, 0, 67, 0, 0, 63, 0, 0, 67, 0, 70, 0, 72, 0],
  ],
  rock: [
    [40, 0, 43, 0, 47, 0, 0, 52, 0, 0, 47, 0, 43, 0, 40, 0],
    [52, 0, 50, 0, 47, 0, 0, 43, 0, 0, 47, 0, 50, 0, 52, 0],
  ],
  zen: [
    [60, 0, 0, 0, 0, 0, 67, 0, 0, 0, 0, 0, 72, 0, 0, 0],
    [72, 0, 0, 0, 0, 0, 67, 0, 0, 0, 0, 0, 60, 0, 0, 0],
  ],
};

const TRACK_CONFIG: Record<string, { bpm: number; swing: number; vol: number }> = {
  cyber: { bpm: 128, swing: 0.0, vol: 0.18 },
  rock:  { bpm: 140, swing: 0.02, vol: 0.2 },
  zen:   { bpm: 70,  swing: 0.0, vol: 0.12 },
};

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function createMusicPlayer() {
  let ctx: AudioContext | null = null;
  let playing = false;
  let trackId = 'cyber';
  let timerId: number | null = null;
  let masterGain: GainNode | null = null;
  let step = 0;
  let bar = 0;
  let nextNoteTime = 0;

  // --- Synth helpers ---
  function playKick(time: number) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(30, time + 0.12);
    gain.gain.setValueAtTime(0.9, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    osc.connect(gain);
    gain.connect(masterGain!);
    osc.start(time);
    osc.stop(time + 0.3);
  }

  function playSnare(time: number) {
    if (!ctx) return;
    // Noise burst for snare
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.8;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    // Tone body
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 180;
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.35, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
    // Filter
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1000;
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(masterGain!);
    osc.connect(oscGain);
    oscGain.connect(masterGain!);
    noise.start(time);
    noise.stop(time + 0.12);
    osc.start(time);
    osc.stop(time + 0.08);
  }

  function playHiHat(time: number, open: boolean) {
    if (!ctx) return;
    const duration = open ? 0.15 : 0.04;
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(open ? 0.2 : 0.15, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain!);
    noise.start(time);
    noise.stop(time + duration);
  }

  function playBass(time: number, note: number) {
    if (!ctx || note === 0) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = midiToFreq(note);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    filter.Q.value = 5;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain!);
    osc.start(time);
    osc.stop(time + 0.18);
  }

  function playLead(time: number, note: number) {
    if (!ctx || note === 0) return;
    const osc = ctx.createOscillator();
    osc.type = trackId === 'cyber' ? 'square' : trackId === 'rock' ? 'sawtooth' : 'sine';
    osc.frequency.value = midiToFreq(note);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(trackId === 'zen' ? 0.12 : 0.1, time);
    gain.gain.setValueAtTime(trackId === 'zen' ? 0.12 : 0.1, time + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, time + (trackId === 'zen' ? 0.4 : 0.15));
    // Delay/echo for cyber
    if (trackId === 'cyber') {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 3000;
      osc.connect(filter);
      filter.connect(gain);
    } else {
      osc.connect(gain);
    }
    gain.connect(masterGain!);
    osc.start(time);
    osc.stop(time + 0.4);
  }

  // --- Sequencer ---
  function scheduleStep() {
    if (!ctx || !playing) return;

    const config = TRACK_CONFIG[trackId];
    const sixteenthDur = 60 / config.bpm / 4;
    const swingOffset = (step % 2 === 1) ? config.swing * sixteenthDur : 0;
    const noteTime = nextNoteTime + swingOffset;

    const drumPattern = DRUM_PATTERNS[trackId];
    const drum = drumPattern[step % drumPattern.length];
    if (drum.kick) playKick(noteTime);
    if (drum.snare) playSnare(noteTime);
    if (drum.hihat) playHiHat(noteTime, false);
    if (drum.openHat) playHiHat(noteTime, true);

    // Bass — pick bar variation
    const bassBars = BASS_PATTERNS[trackId];
    const bassBar = bassBars[bar % bassBars.length];
    const bassNote = bassBar[step % 16];
    if (bassNote) playBass(noteTime, bassNote);

    // Lead — pick bar variation
    const leadBars = LEAD_PATTERNS[trackId];
    const leadBar = leadBars[bar % leadBars.length];
    const leadNote = leadBar[step % 16];
    if (leadNote) playLead(noteTime, leadNote);

    step++;
    if (step % 16 === 0) bar++;
    nextNoteTime += sixteenthDur;
  }

  function scheduler() {
    if (!ctx || !playing) return;
    // Schedule ahead 100ms
    while (nextNoteTime < ctx.currentTime + 0.1) {
      scheduleStep();
    }
  }

  function start() {
    if (playing) return;
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = TRACK_CONFIG[trackId].vol;
    masterGain.connect(ctx.destination);
    playing = true;
    step = 0;
    bar = 0;
    nextNoteTime = ctx.currentTime;
    timerId = window.setInterval(scheduler, 25);
  }

  function stop() {
    playing = false;
    if (timerId !== null) { clearInterval(timerId); timerId = null; }
    if (ctx) { ctx.close(); ctx = null; masterGain = null; }
  }

  function setTrack(id: string) {
    trackId = id;
    if (masterGain && ctx) {
      masterGain.gain.value = TRACK_CONFIG[id].vol;
    }
    // Reset sequence for new track
    step = 0;
    bar = 0;
    nextNoteTime = ctx ? ctx.currentTime : 0;
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
