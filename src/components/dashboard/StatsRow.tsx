'use client';

import { useState } from 'react';
import HeartIcon from './HeartIcon';
import ProgressRing from './ProgressRing';
import type { Workout, Biometrics } from '@/types/dashboard';

interface StatsRowProps {
  workout: Workout;
  biometrics: Biometrics;
  onOpenPlanModal: () => void;
}

const MUSIC_TRACKS = ['赛博电音', '热血燃曲', '禅意拉伸'] as const;

export default function StatsRow({ workout, biometrics, onOpenPlanModal }: StatsRowProps) {
  const isHrHigh = biometrics.heartRate > biometrics.hrThreshold;
  const [musicTrack, setMusicTrack] = useState<string>(MUSIC_TRACKS[0]);
  const [musicOpen, setMusicOpen] = useState(false);

  return (
    <div className="flex items-stretch gap-3 px-4 py-2">

      {/* Control Group: Music + Plan */}
      <div className="flex flex-col gap-2 w-[150px] flex-shrink-0">
        {/* Music selector */}
        <div className="relative flex-1">
          <button
            onClick={() => setMusicOpen((v) => !v)}
            className="w-full h-full flex items-center justify-between gap-1.5 rounded-xl bg-slate-900/40 backdrop-blur-md
                       border border-cyber-cyan/20 hover:border-cyber-cyan/40
                       px-3 py-2 transition-all text-left"
          >
            <span className="text-[9px] text-slate-500 font-mono uppercase tracking-wider leading-tight">
              背景音乐
            </span>
            <span className="text-[10px] text-cyber-cyan font-mono truncate">
              {musicTrack}
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
                    key={t}
                    onClick={() => { setMusicTrack(t); setMusicOpen(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-mono transition-colors ${
                      t === musicTrack
                        ? 'text-cyber-cyan bg-cyber-cyan/10'
                        : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                    }`}
                  >
                    {t === '赛博电音' ? '🎧' : t === '热血燃曲' ? '🔥' : '🧘'} {t}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* AI Custom Plan button */}
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

      {/* Action Card */}
      <div className="flex-1 rounded-xl bg-slate-900/50 backdrop-blur-md
                      border-t border-t-cyan-500/50
                      border-x border-x-slate-700/30
                      border-b border-b-slate-700/30
                      p-3 flex flex-col justify-center">
        <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">动作</span>
        <p className="mt-1 text-base font-semibold text-white truncate">{workout.currentAction}</p>
      </div>

      {/* Heart Rate Card */}
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
          <span
            className={`text-xl font-bold font-mono tabular-nums ${
              isHrHigh ? 'text-red-400' : 'text-white'
            }`}
          >
            {biometrics.heartRate}
          </span>
          <span className="text-[10px] text-slate-400 font-mono">BPM</span>
        </div>
      </div>

      {/* Reps Card */}
      <div className="flex-1 rounded-xl bg-slate-900/50 backdrop-blur-md
                      border-t border-t-cyan-500/50
                      border-x border-x-slate-700/30
                      border-b border-b-slate-700/30
                      p-3 flex flex-col justify-center">
        <div className="flex items-start justify-between">
          <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">次数</span>
          {workout.isFormDeformed && (
            <span className="inline-flex items-center gap-1 rounded-md bg-red-900/60 px-1.5 py-0.5 text-[9px] font-semibold text-red-300 border border-red-700/40">
              {'⚠'} 变形
            </span>
          )}
        </div>
        <div className="flex items-baseline gap-1 mt-1">
          <span className="text-xl font-bold text-cyber-cyan font-mono tabular-nums">
            {workout.reps}
          </span>
          <span className="text-[10px] text-slate-500 font-mono tabular-nums">
            / {workout.targetReps}
          </span>
        </div>
      </div>

      {/* Score Card */}
      <div className="flex-1 rounded-xl bg-slate-900/50 backdrop-blur-md
                      border-t border-t-cyan-500/50
                      border-x border-x-slate-700/30
                      border-b border-b-slate-700/30
                      p-3 flex flex-col justify-center">
        <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">分数</span>
        <div className="flex items-center justify-between mt-1">
          <p className="text-xs font-medium text-cyber-cyan">
            {workout.score >= 80 ? '表现良好' : workout.score >= 60 ? '继续加油' : '需要注意'}
          </p>
          <ProgressRing value={workout.score} max={100} />
        </div>
      </div>

    </div>
  );
}
