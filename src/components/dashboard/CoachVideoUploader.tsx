'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Play, Video, X } from 'lucide-react';

interface PresetCoachVideo {
  recordingId: string;
  title: string;
  s3Key: string;
  coachVideoUrl?: string;
  hasSkeleton: boolean;
}

// Hardcoded preset list — no API dependency for displaying the list
const PRESET_VIDEOS: PresetCoachVideo[] = [
  {
    recordingId: 'pamela-12min-slim-legs',
    title: '帕梅拉 12分钟瘦腿训练',
    s3Key: 'presets/coach-videos/pamela-12min-slim-legs_44dc64f8.mp4',
    hasSkeleton: false,
  },
  {
    recordingId: 'pamela-10min-cardio-bottle',
    title: '帕梅拉 10分钟活力有氧+水瓶',
    s3Key: 'presets/coach-videos/pamela-10min-cardio-bottle_460ca1ee.mp4',
    hasSkeleton: false,
  },
  {
    recordingId: 'pamela-10min-abs-legs',
    title: '帕梅拉 10分钟站立瘦腹+纤腿',
    s3Key: 'presets/coach-videos/pamela-10min-abs-legs_f52e2c03.mp4',
    hasSkeleton: false,
  },
  {
    recordingId: 'pamela-15min-jumping-cardio',
    title: '帕梅拉 15分钟跳跃有氧',
    s3Key: 'presets/coach-videos/pamela-15min-jumping-cardio_f44bafeb.mp4',
    hasSkeleton: false,
  },
  {
    recordingId: 'zhouye-10min-standing-abs',
    title: '周六野 10分钟站立马甲线瘦腰',
    s3Key: 'presets/coach-videos/zhouye-10min-standing-abs_87e49ce5.mp4',
    hasSkeleton: false,
  },
];

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
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState<PresetCoachVideo | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = followAlongActive ? '跟练中' : selected ? '就绪' : '';

  const handleSelect = async (video: PresetCoachVideo) => {
    setLoadingUrl(true);
    setError(null);
    try {
      const res = await fetch('/api/upload/coach-video/presets');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '获取视频地址失败');
      const match = (data.videos || []).find((v: { recordingId: string }) => v.recordingId === video.recordingId);
      const url = match?.coachVideoUrl || `/uploads/coach-videos/${video.s3Key.split('/').pop()}`;
      setSelected({ ...video, coachVideoUrl: url });
      setExpanded(true);
      onUploadComplete(video.recordingId, url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取视频地址失败');
    } finally {
      setLoadingUrl(false);
    }
  };

  const handleRemove = () => {
    setSelected(null);
    setError(null);
    if (followAlongActive) onStopFollowAlong();
  };

  const handleStart = () => {
    if (selected) onStartFollowAlong(selected.recordingId, selected.coachVideoUrl);
  };

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

            {error && (
              <div className="flex items-center gap-1.5 text-[10px] text-red-400 mb-2">
                <AlertCircle className="h-3 w-3" />
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 gap-1.5">
              {PRESET_VIDEOS.map(video => (
                <button
                  key={video.recordingId}
                  onClick={() => handleSelect(video)}
                  disabled={loadingUrl}
                  className={`flex items-center gap-2 rounded border px-2 py-2 text-left transition-all ${
                    selected?.recordingId === video.recordingId
                      ? 'border-cyber-cyan/30 bg-cyber-cyan/[0.08] text-cyber-cyan'
                      : 'border-white/[0.06] bg-transparent text-white/45 hover:border-cyber-cyan/20 hover:text-white/70'
                  } ${loadingUrl ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <Video className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-[11px]">{video.title}</span>
                  {selected?.recordingId === video.recordingId && loadingUrl && (
                    <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                  )}
                  {video.hasSkeleton && <span className="text-[9px] text-green-400/70">AI</span>}
                </button>
              ))}
            </div>
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
                  className="w-full flex items-center justify-center gap-1.5 rounded bg-cyber-cyan/20 py-1.5 text-[11px] font-mono text-cyber-cyan hover:bg-cyber-cyan/30 transition-colors"
                >
                  <Play className="h-3 w-3" />
                  开始跟练
                </button>
              ) : (
                <button
                  onClick={onStopFollowAlong}
                  className="w-full flex items-center justify-center gap-1.5 rounded bg-red-500/20 py-1.5 text-[11px] font-mono text-red-400 hover:bg-red-500/30 transition-colors"
                >
                  <X className="h-3 w-3" />
                  停止跟练
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
