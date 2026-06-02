'use client';

import { useRef, useState, useCallback } from 'react';
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
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  selectedExercise: string;
  onExerciseChange: (exercise: string) => void;
  voiceEnabled: boolean;
  voiceListening?: boolean;
  onVoiceToggle: () => void;
  poseDetected: boolean;
  modelReady: boolean;
  loadStage: string;
  followAlongMode?: boolean;
  matchQuality?: number;
  coachVideoRef?: React.RefObject<HTMLVideoElement | null>;
  coachVideoUrl?: string | null;
  pipVideoRef?: React.RefObject<HTMLVideoElement | null>;
}

const EXERCISES = [
  { id: 'squat', label: '深蹲', icon: '🏋', backend: 'squat' },
  { id: 'plank', label: '平板支撑', icon: '🧘', backend: 'plank' },
  { id: 'jumping_jack', label: '开合跳', icon: '⭐', backend: 'jumping_jack' },
] as const;

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
  followAlongMode,
  matchQuality,
  coachVideoRef,
  coachVideoUrl,
  pipVideoRef,
}: RightPanelProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = externalVideoRef ?? localVideoRef;
  const canvasRef = externalCanvasRef ?? localCanvasRef;

  // ─── PIP resize ───────────────────────────────────────
  const [pipWidth, setPipWidth] = useState(160);
  const resizeRef = useRef<{ startX: number; startY: number; startWidth: number } | null>(null);

  const handlePipResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startWidth: pipWidth };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = resizeRef.current.startX - ev.clientX;
      const dy = resizeRef.current.startY - ev.clientY;
      // Use the larger delta (diagonal drag), clamped
      const delta = Math.max(dx, dy);
      const newWidth = Math.max(100, Math.min(400, resizeRef.current.startWidth + delta));
      setPipWidth(newWidth);
    };

    const handleMouseUp = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [pipWidth]);

  const cs = environment.connectionStatus;

  return (
    <div className="flex flex-col h-full">
      {/* ═══ Status Bar ════════════════════════════ */}
      <div className="flex items-center justify-between px-5 py-2">
        <div className="flex items-center gap-3">
          {/* Connection indicator */}
          <span className="relative flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-pulse-dot ${
              cs === 'connected' ? 'bg-mint-green' : cs === 'connecting' ? 'bg-yellow-400' : 'bg-coral-red'
            }`} />
            <span className={`relative inline-flex h-2 w-2 rounded-full ${
              cs === 'connected' ? 'bg-mint-green' : cs === 'connecting' ? 'bg-yellow-400' : 'bg-coral-red'
            }`} />
          </span>
          <span className="text-[10px] font-bold tracking-[0.2em] font-mono uppercase text-slate-400">
            {cs === 'connected' ? 'LIVE' : cs === 'connecting' ? 'SYNC' : 'OFFLINE'}
          </span>
          {followAlongMode && matchQuality !== undefined && (
            <span className={`text-[10px] font-bold tracking-[0.1em] font-mono uppercase ${
              matchQuality >= 80 ? 'text-green-400' : matchQuality >= 50 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              匹配 {matchQuality}%
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Voice toggle */}
          <button
            onClick={onVoiceToggle}
            className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full border transition-all font-mono ${
              voiceEnabled
                ? 'border-cyber-cyan/30 bg-cyber-cyan/8 text-cyber-cyan'
                : 'border-white/[0.06] bg-cyber-panel text-slate-500 hover:text-slate-300'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
            {voiceEnabled ? 'ON' : 'OFF'}
          </button>

          {/* Mic active indicator */}
          {voiceEnabled && voiceListening && (
            <span className="flex items-center gap-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyber-cyan opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyber-cyan" />
              </span>
              <span className="text-[9px] font-mono text-cyber-cyan/60">MIC</span>
            </span>
          )}

          {/* Pose detection indicator */}
          {modelReady && (
            <span className={`text-[9px] font-mono ${poseDetected ? 'text-mint-green' : 'text-slate-600'}`}>
              {poseDetected ? '● 骨架' : '○ 待检'}
            </span>
          )}
        </div>
      </div>

      {/* Connection error */}
      {connectionError && cs === 'disconnected' && (
        <div className="mx-5 mb-2 px-3 py-1.5 rounded-lg bg-coral-red/8 border border-coral-red/15 text-[10px] text-coral-red/80 font-mono">
          {connectionError}
        </div>
      )}

      {/* ═══ Stats Row ════════════════════════════ */}
      <div className="px-5 py-1">
        <StatsRow
          workout={workout}
          biometrics={biometrics}
          onOpenPlanModal={onOpenPlanModal}
          isRunning={isRunning}
        />
      </div>

      {/* ═══ Camera View ════════════════════════════ */}
      <div className="flex-1 relative mx-5 mb-4 mt-2 rounded-2xl overflow-hidden bg-[#080C14] border border-white/[0.04]">
        {/* Subtle tech grid */}
        <div
          className="absolute inset-0 opacity-[0.025] pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(rgba(0,229,255,0.6) 1px, transparent 1px),
              linear-gradient(90deg, rgba(0,229,255,0.6) 1px, transparent 1px)
            `,
            backgroundSize: '48px 48px',
          }}
        />

        {/* Corner brackets */}
        <div className="absolute top-2 left-2 w-8 h-8 border-t border-l border-cyber-cyan/20 rounded-tl-md" />
        <div className="absolute top-2 right-2 w-8 h-8 border-t border-r border-cyber-cyan/20 rounded-tr-md" />
        <div className="absolute bottom-2 left-2 w-8 h-8 border-b border-l border-cyber-cyan/20 rounded-bl-md" />
        <div className="absolute bottom-2 right-2 w-8 h-8 border-b border-r border-cyber-cyan/20 rounded-br-md" />

        {/* Coach video (follow-along mode) — shown on top, replaces camera view */}
        {followAlongMode && coachVideoRef && coachVideoUrl && (
          <video
            ref={coachVideoRef}
            src={coachVideoUrl}
            className="absolute inset-0 w-full h-full object-contain bg-black z-10"
            playsInline
            autoPlay
            loop
          />
        )}

        {/* User camera — ALWAYS rendered (mirrored, hidden behind coach video in follow-along mode) */}
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          muted
          playsInline
          autoPlay
          style={{ display: isRunning ? 'block' : 'none', transform: followAlongMode ? 'scaleX(-1)' : 'scaleX(-1)' }}
        />

        {/* Skeleton canvas — works in both modes */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none z-20"
          style={{ display: (isRunning || followAlongMode) ? 'block' : 'none' }}
        />

        {/* PIP: user camera in corner during follow-along (resizable) */}
        {followAlongMode && isRunning && pipVideoRef && (
          <div
            className="absolute bottom-3 right-3 rounded-lg overflow-hidden border border-cyber-cyan/20 shadow-lg shadow-black/50 z-30"
            style={{ width: pipWidth }}
          >
            {/* Resize handle — top-left corner */}
            <div
              className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize z-40 group"
              onMouseDown={handlePipResizeStart}
            >
              {/* Diagonal grip lines */}
              <svg
                className="absolute top-0.5 left-0.5 opacity-40 group-hover:opacity-90 transition-opacity"
                width="10" height="10" viewBox="0 0 10 10"
              >
                <line x1="8" y1="2" x2="2" y2="8" stroke="#00E5FF" strokeWidth="1" />
                <line x1="6" y1="2" x2="2" y2="6" stroke="#00E5FF" strokeWidth="0.8" />
                <line x1="9" y1="2" x2="2" y2="9" stroke="#00E5FF" strokeWidth="0.6" />
              </svg>
            </div>
            {/* Header bar */}
            <div className="bg-black/60 px-1.5 py-0.5 flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-cyber-cyan animate-pulse" />
              <span className="text-[8px] font-mono text-cyber-cyan/60 uppercase">你</span>
              <span className="ml-auto text-[8px] text-slate-600 font-mono">{pipWidth}px</span>
            </div>
            <video
              ref={pipVideoRef}
              className="w-full aspect-[4/3] object-cover"
              muted
              playsInline
              autoPlay
              style={{ transform: 'scaleX(-1)' }}
            />
          </div>
        )}

        {/* Placeholder when not running */}
        {!isRunning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {!modelReady && loadStage ? (
              <>
                <div className="w-10 h-10 border-2 border-cyber-cyan/20 border-t-cyber-cyan rounded-full animate-spin mb-4" />
                <p className="text-slate-500 text-[11px] font-mono tracking-[0.15em]">{loadStage}</p>
              </>
            ) : (
              <>
                <div className="w-20 h-20 rounded-full border border-cyber-cyan/10 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-cyber-cyan/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round"
                      d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
                <p className="text-slate-500 text-[11px] font-mono tracking-[0.15em]">
                  CAMERA & POSE READY
                </p>
              </>
            )}
          </div>
        )}

        {/* HUD overlays */}
        {cs === 'connected' && (
          <div className="absolute top-3 right-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/30 backdrop-blur-sm px-2 py-0.5 text-[9px] text-mint-green font-mono border border-mint-green/15">
              <span className="w-1 h-1 rounded-full bg-mint-green animate-pulse" />
              LIVE
            </span>
          </div>
        )}

        {/* Bottom bar with exercise + controls */}
        <div className="absolute bottom-0 inset-x-0">
          <div className="flex items-end justify-between p-3">
            {/* Left: REC + action */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-black/30 backdrop-blur-sm px-2 py-0.5 text-[9px] font-mono border border-white/[0.04]">
                <span className={`w-1 h-1 rounded-full ${isRunning ? 'bg-coral-red animate-pulse-dot' : 'bg-slate-600'}`} />
                {isRunning ? 'REC' : 'IDLE'}
              </span>
              <span className="text-[9px] text-slate-500 font-mono">
                {workout.currentAction}
              </span>
            </div>

            {/* Center: Exercise selector */}
            <div className="flex items-center gap-1">
              {EXERCISES.map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => onExerciseChange(ex.id)}
                  className={`text-[10px] px-2.5 py-1 rounded-lg border transition-all font-mono ${
                    selectedExercise === ex.id
                      ? 'border-cyber-cyan/25 bg-cyber-cyan/8 text-cyber-cyan'
                      : 'border-white/[0.04] bg-black/20 text-slate-500 hover:text-slate-300 hover:border-white/[0.08]'
                  }`}
                >
                  {ex.label}
                </button>
              ))}
            </div>

            {/* Right: Start/End button */}
            <div>
              {isRunning ? (
                <button
                  onClick={onEndWorkout}
                  className="group inline-flex items-center gap-1.5 rounded-xl
                             bg-coral-red/10 border border-coral-red/20
                             hover:border-coral-red/40 hover:bg-coral-red/15
                             px-3.5 py-1.5 transition-all duration-200"
                >
                  <span className="w-1.5 h-1.5 rounded-sm bg-coral-red" />
                  <span className="text-[10px] font-semibold text-coral-red tracking-wide">
                    结束
                  </span>
                </button>
              ) : (
                <button
                  onClick={onStartWorkout}
                  className="group inline-flex items-center gap-1.5 rounded-xl
                             bg-cyber-cyan/8 border border-cyber-cyan/20
                             hover:border-cyber-cyan/40 hover:bg-cyber-cyan/15
                             hover:glow-cyan
                             px-3.5 py-1.5 transition-all duration-200"
                >
                  <span className="text-[10px] text-cyber-cyan">▶</span>
                  <span className="text-[10px] font-semibold text-cyber-cyan tracking-wide">
                    开始
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
