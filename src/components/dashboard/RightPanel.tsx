'use client';

import { useRef, useEffect } from 'react';
import StatsRow from './StatsRow';
import type { Workout, Biometrics, Environment } from '@/types/dashboard';

interface RightPanelProps {
  workout: Workout;
  biometrics: Biometrics;
  environment: Environment;
  connectionError?: string | null;
  onOpenPlanModal: () => void;
  onEndWorkout: () => void;
  onStartWorkout: () => void;
  isRunning: boolean;
  // Camera + canvas refs passed from parent
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  // Exercise controls
  selectedExercise: string;
  onExerciseChange: (exercise: string) => void;
  // Voice toggle
  voiceEnabled: boolean;
  voiceListening?: boolean;
  onVoiceToggle: () => void;
  // Status indicators
  poseDetected: boolean;
  modelReady: boolean;
  loadStage: string;
}

const EXERCISES = [
  { id: 'squat', label: '深蹲', icon: '🏋', backend: 'squat' },
  { id: 'plank', label: '平板支撑', icon: '🧘', backend: 'plank' },
  { id: 'jumping_jack', label: '开合跳', icon: '⭐', backend: 'jumping_jack' },
] as const;

/** 后端 key → 中文名映射 */
export const EXERCISE_LABELS: Record<string, string> = Object.fromEntries(
  EXERCISES.map(e => [e.id, e.label]),
);

export default function RightPanel({
  workout,
  biometrics,
  environment,
  connectionError,
  onOpenPlanModal,
  onEndWorkout,
  onStartWorkout,
  isRunning,
  videoRef: externalVideoRef,
  canvasRef: externalCanvasRef,
  selectedExercise,
  onExerciseChange,
  voiceEnabled,
  voiceListening,
  onVoiceToggle,
  poseDetected,
  modelReady,
  loadStage,
}: RightPanelProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = externalVideoRef ?? localVideoRef;
  const canvasRef = externalCanvasRef ?? localCanvasRef;

  const cs = environment.connectionStatus;

  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div className="flex items-center justify-between px-5 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-pulse-dot ${
                cs === 'connected' ? 'bg-cyber-cyan' : cs === 'connecting' ? 'bg-yellow-400' : 'bg-red-500'
              }`}
            />
            <span
              className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                cs === 'connected' ? 'bg-cyber-cyan' : cs === 'connecting' ? 'bg-yellow-400' : 'bg-red-500'
              }`}
            />
          </span>
          <span
            className={`text-xs font-semibold tracking-[0.2em] font-mono ${
              cs === 'connected' ? 'text-cyber-cyan' : cs === 'connecting' ? 'text-yellow-400' : 'text-red-400'
            }`}
          >
            {cs === 'connected' ? 'LIVE TRACKING' : cs === 'connecting' ? 'CONNECTING...' : 'OFFLINE'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Voice toggle */}
          <button
            onClick={onVoiceToggle}
            className={`text-xs px-3 py-1 rounded-full border transition-all font-mono ${
              voiceEnabled
                ? 'border-cyber-cyan/50 bg-cyber-cyan/15 text-cyber-cyan'
                : 'border-slate-600/50 bg-slate-800/60 text-slate-400'
            }`}
          >
            {voiceEnabled ? '🎙 语音ON' : '🎙 语音OFF'}
          </button>
          {voiceEnabled && voiceListening && (
            <span className="flex items-center gap-1 text-[10px] font-mono text-cyber-cyan">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyber-cyan opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyber-cyan"></span>
              </span>
              监听中
            </span>
          )}

          {modelReady && (
            <span className={`text-[10px] font-mono ${poseDetected ? 'text-green-400' : 'text-slate-500'}`}>
              {poseDetected ? '● 骨架检测' : '○ 等待检测'}
            </span>
          )}
        </div>
      </div>

      {/* Connection error */}
      {connectionError && cs === 'disconnected' && (
        <div className="mx-4 mb-1 px-3 py-1.5 rounded-lg bg-red-950/40 border border-red-800/40 text-[11px] text-red-300/80 font-mono">
          {connectionError}
        </div>
      )}

      {/* Stats + Controls */}
      <StatsRow
        workout={workout}
        biometrics={biometrics}
        onOpenPlanModal={onOpenPlanModal}
        isRunning={isRunning}
      />

      {/* Camera / Skeleton View */}
      <div className="flex-1 relative mx-4 mb-4 rounded-xl overflow-hidden border border-slate-700/40 bg-slate-900">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950" />
        {/* Tech grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0, 229, 255, 0.5) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0, 229, 255, 0.5) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
          }}
        />
        {/* Corner brackets */}
        <div className="absolute top-0 left-0 w-14 h-14 border-t-2 border-l-2 border-cyber-cyan/30 rounded-tl-lg" />
        <div className="absolute top-0 right-0 w-14 h-14 border-t-2 border-r-2 border-cyber-cyan/30 rounded-tr-lg" />
        <div className="absolute bottom-0 left-0 w-14 h-14 border-b-2 border-l-2 border-cyber-cyan/30 rounded-bl-lg" />
        <div className="absolute bottom-0 right-0 w-14 h-14 border-b-2 border-r-2 border-cyber-cyan/30 rounded-br-lg" />

        {/* Video element (hidden - used for MediaPipe capture) */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          muted
          playsInline
          autoPlay
          style={{ display: isRunning ? 'block' : 'none' }}
        />

        {/* Canvas overlay for skeleton drawing */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ display: isRunning ? 'block' : 'none' }}
        />

        {/* Loading / Placeholder */}
        {!isRunning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {!modelReady && loadStage ? (
              <>
                <div className="w-12 h-12 border-2 border-cyber-cyan/30 border-t-cyber-cyan rounded-full animate-spin mb-4" />
                <p className="text-slate-400 text-sm font-mono tracking-[0.15em]">{loadStage}</p>
              </>
            ) : (
              <>
                <div className="w-28 h-28 rounded-full border-2 border-cyber-cyan/10 flex items-center justify-center mb-5">
                  <svg className="w-12 h-12 text-cyber-cyan/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
                <p className="text-slate-400 text-sm font-mono tracking-[0.2em] mb-1.5">
                  实时骨架 / 视频流接口区域
                </p>
                <p className="text-slate-600 text-xs font-mono mb-4">
                  Camera & Pose Estimation — Ready
                </p>
              </>
            )}
          </div>
        )}

        {/* Backend connection status */}
        {cs === 'connected' && (
          <div className="absolute top-4 right-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyber-cyan/10 backdrop-blur-sm px-3 py-1 text-[10px] text-cyber-cyan font-mono border border-cyber-cyan/30">
              <span className="w-1.5 h-1.5 rounded-full bg-cyber-cyan animate-pulse" />
              BACKEND LIVE
            </span>
          </div>
        )}

        {/* REC indicator */}
        <div className="absolute bottom-16 left-4 flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur-sm px-3 py-1.5 text-xs text-slate-400 font-mono border border-slate-700/40">
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse-dot ${isRunning ? 'bg-red-500' : 'bg-slate-600'}`} />
            REC
          </span>
          <span className="text-xs text-slate-500 font-mono">
            LOCAL · {workout.currentAction}
          </span>
        </div>

        {/* Exercise selector */}
        <div className="absolute bottom-16 right-4 flex gap-1">
          {EXERCISES.map((ex) => (
            <button
              key={ex.id}
              onClick={() => onExerciseChange(ex.id)}
              className={`text-[10px] px-2 py-1 rounded-lg border transition-all font-mono ${
                selectedExercise === ex.id
                  ? 'border-cyber-cyan/50 bg-cyber-cyan/15 text-cyber-cyan'
                  : 'border-slate-600/40 bg-slate-800/50 text-slate-500 hover:text-slate-300'
              }`}
              title={ex.label}
            >
              {ex.icon}
            </button>
          ))}
        </div>

        {/* Start / End Workout Button */}
        <div className="absolute bottom-4 right-4">
          {isRunning ? (
            <button
              onClick={onEndWorkout}
              className="group inline-flex items-center gap-2 rounded-xl
                         bg-red-950/40 backdrop-blur-sm border border-red-500/30
                         hover:border-red-500/60 hover:bg-red-950/60
                         hover:shadow-[0_0_20px_rgba(239,68,68,0.4)]
                         px-4 py-2 transition-all duration-300"
            >
              <span className="text-sm">🛑</span>
              <span className="text-xs font-semibold text-red-300 tracking-wide group-hover:text-red-200 transition-colors">
                结束训练
              </span>
            </button>
          ) : (
            <button
              onClick={onStartWorkout}
              className="group inline-flex items-center gap-2 rounded-xl
                         bg-cyber-cyan/10 backdrop-blur-sm border border-cyber-cyan/30
                         hover:border-cyber-cyan/60 hover:bg-cyber-cyan/20
                         hover:shadow-[0_0_20px_rgba(0,229,255,0.3)]
                         px-4 py-2 transition-all duration-300"
            >
              <span className="text-sm">▶</span>
              <span className="text-xs font-semibold text-cyber-cyan tracking-wide group-hover:text-white transition-colors">
                开始训练
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
