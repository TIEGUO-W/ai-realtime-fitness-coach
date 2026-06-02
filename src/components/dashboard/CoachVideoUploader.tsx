'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, X, Play, Loader2, AlertCircle, CheckCircle2, Link, ChevronDown, ChevronRight } from 'lucide-react';

type InputMode = 'upload' | 'link';

interface UploadStatus {
  status: string;
  progress?: number;
  error?: string;
  title?: string;
}

interface Props {
  onUploadComplete: (recordingId: string, coachVideoUrl: string) => void;
  onStartFollowAlong: (recordingId: string) => void;
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
  const [mode, setMode] = useState<InputMode>('link');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [coachVideoUrl, setCoachVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [dragOver, setDragOver] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Auto-expand when processing or ready
  useEffect(() => {
    if (status !== 'idle') setExpanded(true);
  }, [status]);

  // Poll processing status
  useEffect(() => {
    if ((status !== 'processing' && status !== 'downloading') || !recordingId) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/upload/coach-video/status?recordingId=${recordingId}`);
        const data: UploadStatus = await res.json();
        if (data.status === 'ready') {
          setStatus('ready'); setUploadProgress(100);
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (data.status === 'error') {
          setStatus('error'); setError(data.error || '处理失败');
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (data.progress) {
          setUploadProgress(data.progress);
          if (data.status === 'detecting') setStatus('processing');
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status, recordingId]);

  const handleUpload = useCallback(async (file: File) => {
    setError(null); setIsUploading(true); setStatus('uploading'); setUploadProgress(0);
    try {
      const formData = new FormData(); formData.append('video', file);
      const res = await fetch('/api/upload/coach-video', { method: 'POST', body: formData });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || '上传失败'); }
      const data = await res.json();
      setRecordingId(data.recordingId); setCoachVideoUrl(data.coachVideoUrl);
      setVideoTitle(file.name); setStatus('processing');
      onUploadComplete(data.recordingId, data.coachVideoUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败'); setStatus('error');
    } finally { setIsUploading(false); }
  }, [onUploadComplete]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (file) handleUpload(file);
  };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); const file = e.dataTransfer.files[0]; if (file) handleUpload(file); };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  // Extract URL from mixed text (e.g. "【标题】https://xxx" → just the URL)
  const extractUrl = (raw: string): string => {
    const match = raw.match(/https?:\/\/[^\s)]+/);
    if (!match) return raw.trim();
    // Strip tracking params (vd_source, si, spm, etc.)
    const url = match[0];
    try {
      const u = new URL(url);
      u.searchParams.delete('vd_source');
      u.searchParams.delete('si');
      u.searchParams.delete('spm_id_from');
      u.searchParams.delete('share_source');
      u.searchParams.delete('utm_source');
      u.searchParams.delete('utm_medium');
      return u.toString();
    } catch { return url; }
  };

  const handleLinkSubmit = async () => {
    const url = extractUrl(linkUrl);
    if (!url) return;
    setError(null); setIsUploading(true); setStatus('downloading'); setUploadProgress(0);
    try {
      const res = await fetch('/api/upload/coach-video-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || '链接分析失败'); }
      const data = await res.json();
      setRecordingId(data.recordingId); setCoachVideoUrl(data.coachVideoUrl);
      setVideoTitle(data.title || '教练视频'); setStatus('downloading');
      onUploadComplete(data.recordingId, data.coachVideoUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : '链接处理失败'); setStatus('error');
    } finally { setIsUploading(false); }
  };

  const handleRemove = () => {
    setRecordingId(null); setCoachVideoUrl(null); setVideoTitle(null);
    setStatus('idle'); setError(null); setUploadProgress(0); setLinkUrl('');
    if (followAlongActive) onStopFollowAlong();
  };

  const handleStart = () => {
    if (recordingId) onStartFollowAlong(recordingId);
  };

  const statusLabel = status === 'idle' ? '' :
    status === 'uploading' ? '上传中...' :
    status === 'downloading' ? '下载中...' :
    status === 'processing' ? '提取骨架...' :
    status === 'ready' ? '就绪' :
    status === 'error' ? '失败' : '';

  const statusColor = status === 'ready' ? 'text-green-400' :
    status === 'error' ? 'text-red-400' :
    status === 'idle' ? '' : 'text-cyber-cyan/60';

  return (
    <div className="w-full">
      {/* Compact header — always visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-1.5 text-xs font-mono text-cyber-cyan/50 hover:text-cyber-cyan/70 tracking-wider uppercase transition-colors py-1"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        AI 跟练
        {statusLabel && (
          <span className={`text-[10px] ml-auto ${statusColor}`}>
            {status === 'processing' && <Loader2 className="h-2.5 w-2.5 inline animate-spin mr-1" />}
            {statusLabel}
          </span>
        )}
      </button>

      {/* Expandable content */}
      {expanded && (
        <div className="pb-2 space-y-2">
          {/* Idle: mode tabs + input */}
          {status === 'idle' && (
            <>
              <div className="flex rounded-md border border-white/[0.06] overflow-hidden">
                <button onClick={() => setMode('link')} className={`flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-mono transition-colors ${mode === 'link' ? 'bg-cyber-cyan/10 text-cyber-cyan' : 'text-white/30 hover:text-white/50'}`}>
                  <Link className="h-2.5 w-2.5" />粘贴链接
                </button>
                <button onClick={() => setMode('upload')} className={`flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-mono transition-colors ${mode === 'upload' ? 'bg-cyber-cyan/10 text-cyber-cyan' : 'text-white/30 hover:text-white/50'}`}>
                  <Upload className="h-2.5 w-2.5" />上传文件
                </button>
              </div>
              {mode === 'link' && (
                <div className="flex gap-1">
                  <input type="url" value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleLinkSubmit()}
                    placeholder="粘贴 B站 / 抖音 / YouTube 链接..."
                    className="flex-1 bg-transparent border border-white/[0.08] rounded px-2 py-1 text-[10px] text-white/60 font-mono placeholder:text-white/15 focus:outline-none focus:border-cyber-cyan/30" />
                  <button onClick={handleLinkSubmit} disabled={!linkUrl.trim() || isUploading}
                    className="shrink-0 px-2 py-1 rounded bg-cyber-cyan/10 text-cyber-cyan/70 text-[10px] font-mono border border-cyber-cyan/20 hover:bg-cyber-cyan/20 disabled:opacity-30 disabled:cursor-not-allowed">分析</button>
                </div>
              )}
              {mode === 'upload' && (
                <div
                  className={`border-2 border-dashed rounded p-3 text-center cursor-pointer transition-all ${dragOver ? 'border-cyber-cyan/60 bg-cyber-cyan/5' : 'border-white/[0.06] hover:border-cyber-cyan/30'}`}
                  onClick={() => fileInputRef.current?.click()} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
                  <Upload className="mx-auto h-5 w-5 text-cyber-cyan/20 mb-1" />
                  <p className="text-[10px] text-white/30">拖放或点击上传 <span className="text-white/15">MP4 ≤300MB</span></p>
                  <input ref={fileInputRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={handleFileChange} />
                </div>
              )}
            </>
          )}

          {/* Downloading / Processing */}
          {(status === 'downloading' || status === 'processing' || status === 'uploading') && (
            <div className="rounded border border-cyber-cyan/10 bg-cyber-cyan/[0.02] p-2">
              <div className="flex items-center gap-1.5 text-[10px] text-cyber-cyan/60 mb-1">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                {status === 'downloading' ? '下载视频...' : status === 'uploading' ? '上传中...' : '提取骨架...'}
              </div>
              {videoTitle && <p className="text-[9px] text-white/20 truncate mb-1">{videoTitle}</p>}
              {status === 'processing' && (
                <div className="h-0.5 bg-white/[0.04] rounded-full overflow-hidden">
                  <div className="h-full bg-cyber-cyan/60 rounded-full transition-all" style={{ width: `${Math.max(5, uploadProgress)}%` }} />
                </div>
              )}
            </div>
          )}

          {/* Ready */}
          {status === 'ready' && recordingId && (
            <div className="rounded border border-cyber-cyan/20 bg-cyber-cyan/[0.04] p-2">
              <div className="flex items-center gap-1.5 mb-2">
                <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
                <span className="text-[10px] text-green-400/80 truncate">{videoTitle || '就绪'}</span>
                <button onClick={handleRemove} className="ml-auto text-white/20 hover:text-white/50"><X className="h-3 w-3" /></button>
              </div>
              {!followAlongActive ? (
                <button onClick={handleStart}
                  className="w-full flex items-center justify-center gap-1.5 rounded py-1.5 bg-cyber-cyan/15 hover:bg-cyber-cyan/25 text-cyber-cyan text-xs font-mono transition-all border border-cyber-cyan/20 hover:border-cyber-cyan/40">
                  <Play className="h-3 w-3" />开始跟练
                </button>
              ) : (
                <button onClick={onStopFollowAlong}
                  className="w-full flex items-center justify-center gap-1.5 rounded py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-mono border border-red-500/20">
                  <X className="h-3 w-3" />退出跟练
                </button>
              )}
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="rounded border border-red-500/20 bg-red-500/[0.04] p-2">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="h-3 w-3 text-red-400" />
                <span className="text-[10px] text-red-400/80">失败</span>
                <button onClick={handleRemove} className="ml-auto text-white/20 hover:text-white/50"><X className="h-3 w-3" /></button>
              </div>
              {error && <p className="text-[9px] text-red-400/50 mt-1">{error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
