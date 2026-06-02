'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Play, Video, X } from 'lucide-react';

interface PresetCoachVideo {
  recordingId: string;
  title: string;
  coachVideoUrl: string;
  hasSkeleton: boolean;
}

interface Props {
  onUploadComplete: (recordingId: string, coachVideoUrl: string) => void;
  onStartFollowAlong: (recordingId: string, coachVideoUrl?: string) => void;
  onStopFollowAlong: () => void;
  followAlongActive: boolean;
}

export default function CoachVideoUploader({
  onUploadComplete,
  onStartFollowAlong,
  onStopFollowAlong,
  followAlongActive,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [videos, setVideos] = useState<PresetCoachVideo[]>([]);
  const [selected, setSelected] = useState<PresetCoachVideo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadVideos() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/upload/coach-video/presets');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '读取预置视频失败');
        if (!cancelled) setVideos(data.videos || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取预置视频失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadVideos();
    return () => { cancelled = true; };
  }, []);

  const handleSelect = (video: PresetCoachVideo) => {
    setSelected(video);
    setError(null);
    setExpanded(true);
    onUploadComplete(video.recordingId, video.coachVideoUrl);
  };

  const handleRemove = () => {
    setSelected(null);
    setError(null);
    if (followAlongActive) onStopFollowAlong();
  };

  const handleStart = () => {
    if (selected) onStartFollowAlong(selected.recordingId, selected.coachVideoUrl);
  };

  const statusLabel = followAlongActive ? '跟练中' : selected ? '就绪' : '';

  return (
    <div className="w-full">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 text-xs font-mono text-cyber-cyan/50 hover:text-cyber-cyan/70 tracking-wider uppercase transition-colors py-1"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        AI 跟练
        {statusLabel && (
          <span className="text-[10px] ml-auto text-green-400">
            {statusLabel}
          </span>
        )}
      </button>

      {expanded && (
        <div className="pb-2 space-y-2">
          <div className="rounded border border-white/[0.06] bg-white/[0.02] p-2">
            <div className="flex items-center gap-1.5 text-[10px] text-white/40 mb-2">
              <Video className="h-3 w-3 text-cyber-cyan/50" />
              选择一个预置视频开始跟练
            </div>

            {loading && (
              <div className="flex items-center gap-1.5 text-[10px] text-cyber-cyan/60">
                <Loader2 className="h-3 w-3 animate-spin" />
                读取视频列表...
              </div>
            )}

            {!loading && videos.length === 0 && !error && (
              <p className="text-[10px] leading-relaxed text-white/25">
                暂无预置视频。请把视频放到 public/uploads/coach-videos 后刷新页面。
              </p>
            )}

            {!loading && videos.length > 0 && (
              <div className="grid grid-cols-1 gap-1.5">
                {videos.map(video => (
                  <button
                    key={video.recordingId}
                    onClick={() => handleSelect(video)}
                    className={`flex items-center gap-2 rounded border px-2 py-2 text-left transition-all ${
                      selected?.recordingId === video.recordingId
                        ? 'border-cyber-cyan/30 bg-cyber-cyan/[0.08] text-cyber-cyan'
                        : 'border-white/[0.06] bg-transparent text-white/45 hover:border-cyber-cyan/20 hover:text-white/70'
                    }`}
                  >
                    <Video className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-[10px] font-mono">{video.title}</span>
                    {video.hasSkeleton && <span className="text-[9px] text-green-400/70">AI</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selected && (
            <div className="rounded border border-cyber-cyan/20 bg-cyber-cyan/[0.04] p-2">
              <div className="flex items-center gap-1.5 mb-2">
                <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
                <span className="text-[10px] text-green-400/80 truncate">{selected.title}</span>
                <button onClick={handleRemove} className="ml-auto text-white/20 hover:text-white/50">
                  <X className="h-3 w-3" />
                </button>
              </div>
              {!followAlongActive ? (
                <button
                  onClick={handleStart}
                  className="w-full flex items-center justify-center gap-1.5 rounded py-1.5 bg-cyber-cyan/15 hover:bg-cyber-cyan/25 text-cyber-cyan text-xs font-mono transition-all border border-cyber-cyan/20 hover:border-cyber-cyan/40"
                >
                  <Play className="h-3 w-3" />开始跟练
                </button>
              ) : (
                <button
                  onClick={onStopFollowAlong}
                  className="w-full flex items-center justify-center gap-1.5 rounded py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-mono border border-red-500/20"
                >
                  <X className="h-3 w-3" />退出跟练
                </button>
              )}
            </div>
          )}

          {error && (
            <div className="rounded border border-red-500/20 bg-red-500/[0.04] p-2">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="h-3 w-3 text-red-400" />
                <span className="text-[10px] text-red-400/80">{error}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
