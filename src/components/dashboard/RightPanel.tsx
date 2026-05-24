'use client';

import { useRef, useEffect } from 'react';
import StatsRow from './StatsRow';
import type { Workout, Biometrics, Environment } from '@/types/dashboard';

interface RightPanelProps {
  workout: Workout;
  biometrics: Biometrics;
  environment: Environment;
  streamUrl?: string;
  connectionError?: string | null;
  onOpenPlanModal: () => void;
  onEndWorkout: () => void;
  /** Remote frame with skeleton overlay (base64 JPEG) */
  remoteFrameSrc?: string | null;
  /** Canvas ref for local camera + MediaPipe */
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  /** Video ref for local camera */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}

export default function RightPanel({
  workout,
  biometrics,
  environment,
  streamUrl,
  connectionError,
  onOpenPlanModal,
  onEndWorkout,
  remoteFrameSrc,
  canvasRef,
  videoRef,
}: RightPanelProps) {
  const internalVideoRef = useRef<HTMLVideoElement>(null);
  const activeVideoRef = videoRef ?? internalVideoRef;

  useEffect(() => {
    const video = activeVideoRef.current;
    if (!video || !streamUrl) return;
    video.src = streamUrl;
    video.play().catch(() => {});
  }, [streamUrl, activeVideoRef]);

  const cs = environment.connectionStatus;

  return (
    <div className="flex flex-col h-full">
      {/* Status bar */}
      <div className="flex items-center justify-between px-5 py-2.5">
        {/* Left: live tracking indicator */}
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

        {/* Right: env info + connection status */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-slate-400">
            {'☀'} {environment.temp}°C
          </span>
          <span
            className={`inline-flex items-center gap-1 ${
              cs === 'connected'
                ? 'text-cyber-cyan'
                : cs === 'connecting'
                  ? 'text-yellow-400'
                  : 'text-red-400'
            }`}
          >
            {cs === 'connected' ? '🔗 Connected' : cs === 'connecting' ? '⏳ Connecting' : '⚠️ Offline'}
          </span>
        </div>
      </div>

      {/* Connection error banner */}
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
      />

      {/* Camera / Skeleton Area */}
      <div className="flex-1 relative mx-4 mb-4 rounded-xl overflow-hidden border border-slate-700/40 bg-slate-900">
        {/* Dark gradient background */}
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

        {/* Four corner brackets */}
        <div className="absolute top-0 left-0 w-14 h-14 border-t-2 border-l-2 border-cyber-cyan/30 rounded-tl-lg" />
        <div className="absolute top-0 right-0 w-14 h-14 border-t-2 border-r-2 border-cyber-cyan/30 rounded-tr-lg" />
        <div className="absolute bottom-0 left-0 w-14 h-14 border-b-2 border-l-2 border-cyber-cyan/30 rounded-bl-lg" />
        <div className="absolute bottom-0 right-0 w-14 h-14 border-b-2 border-r-2 border-cyber-cyan/30 rounded-br-lg" />

        {/* Video stream (for remote mode with stream URL) */}
        <video
          ref={activeVideoRef}
          className="absolute inset-0 w-full h-full object-cover"
          muted
          playsInline
          autoPlay
        />

        {/* Canvas overlay for local MediaPipe skeleton drawing */}
        {canvasRef && (
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        {/* Remote frame with skeleton overlay */}
        {remoteFrameSrc && (
          <img
            src={remoteFrameSrc}
            alt="Skeleton overlay"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        {/* Center placeholder — shown when no stream or remote frame is connected */}
        {!streamUrl && !remoteFrameSrc && !canvasRef && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-28 h-28 rounded-full border-2 border-cyber-cyan/10 flex items-center justify-center mb-5">
              <svg
                className="w-12 h-12 text-cyber-cyan/20"
                fill="none" viewBox="0 0 24 24"
                stroke="currentColor" strokeWidth={1}
              >
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <p className="text-slate-400 text-sm font-mono tracking-[0.2em] mb-1.5">
              实时骨架 / 视频流接口区域
            </p>
            <p className="text-slate-600 text-xs font-mono">
              点击下方 &ldquo;开始训练&rdquo; 启动摄像头
            </p>
          </div>
        )}

        {/* Backend connection status overlay */}
        {cs === 'connected' && (
          <div className="absolute top-4 right-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-cyber-cyan/10 backdrop-blur-sm px-3 py-1 text-[10px] text-cyber-cyan font-mono border border-cyber-cyan/30">
              <span className="w-1.5 h-1.5 rounded-full bg-cyber-cyan animate-pulse" />
              BACKEND LIVE
            </span>
          </div>
        )}

        {/* REC indicator */}
        <div className="absolute bottom-4 left-4 flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/50 backdrop-blur-sm px-3 py-1.5 text-xs text-slate-400 font-mono border border-slate-700/40">
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse-dot ${cs === 'connected' ? 'bg-red-500' : 'bg-slate-600'}`} />
            REC
          </span>
        </div>

        {/* End Workout Button */}
        <button
          onClick={onEndWorkout}
          className="absolute bottom-4 right-4 group inline-flex items-center gap-2 rounded-xl
                     bg-red-950/40 backdrop-blur-sm border border-red-500/30
                     hover:border-red-500/60 hover:bg-red-950/60
                     hover:shadow-[0_0_20px_rgba(239,68,68,0.4)]
                     px-4 py-2 transition-all duration-300"
        >
          <span className="text-sm group-hover:animate-pulse">🛑</span>
          <span className="text-xs font-semibold text-red-300 tracking-wide group-hover:text-red-200 transition-colors">
            结束训练
          </span>
        </button>
      </div>
    </div>
  );
}
