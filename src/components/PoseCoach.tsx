'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createWsConnection,
  type WsMessage,
  type CoachingFeedback,
  type Landmark,
  type RemoteFramePayload,
  type RpiStatusPayload,
} from '@/lib/ws-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';

// ─── MediaPipe Pose 连接定义 ─────────────────────
const POSE_CONNECTIONS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [15, 17], [16, 18], [15, 19],
  [16, 20], [17, 19], [18, 20], [27, 29], [28, 30],
  [29, 31], [30, 32], [27, 31], [28, 32],
];

// ─── 运动模式 ────────────────────────────────────
const EXERCISES = [
  { id: 'auto', label: '自动识别', icon: '🎯' },
  { id: 'squat', label: '深蹲', icon: '🏋' },
  { id: 'pushup', label: '俯卧撑', icon: '💪' },
  { id: 'deadlift', label: '硬拉', icon: '🔧' },
  { id: 'plank', label: '平板支撑', icon: '🧘' },
  { id: 'lunge', label: '弓步蹲', icon: '🦵' },
  { id: 'jumping_jack', label: '开合跳', icon: '⭐' },
] as const;

type ExerciseId = (typeof EXERCISES)[number]['id'];
type SourceMode = 'local' | 'remote';

function getSkeletonColor(quality: 'good' | 'warning' | 'error'): string {
  switch (quality) {
    case 'good': return '#22D3A7';
    case 'warning': return '#FF6B35';
    case 'error': return '#FF4757';
  }
}

interface FeedbackEntry {
  id: number;
  timestamp: number;
  feedback: CoachingFeedback;
}

// ─── 动态加载脚本 ────────────────────────────────
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export default function PoseCoach() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<unknown>(null);
  const wsRef = useRef<ReturnType<typeof createWsConnection> | null>(null);
  const frameBufferRef = useRef<Landmark[][]>([]);
  const sessionIdRef = useRef<string>('');
  const feedbackIdRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const poseInstanceRef = useRef<unknown>(null);
  const remoteImgRef = useRef<HTMLImageElement | null>(null);

  const [source, setSource] = useState<SourceMode>('local');
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedExercise, setSelectedExercise] = useState<ExerciseId>('auto');
  const [currentFeedback, setCurrentFeedback] = useState<CoachingFeedback | null>(null);
  const [feedbackHistory, setFeedbackHistory] = useState<FeedbackEntry[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [rpiConnected, setRpiConnected] = useState(false);
  const [repCount, setRepCount] = useState(0);
  const [detectedExercise, setDetectedExercise] = useState('');
  const [quality, setQuality] = useState<'good' | 'warning' | 'error'>('warning');
  const [poseDetected, setPoseDetected] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [remoteFps, setRemoteFps] = useState(0);

  // session ID
  useEffect(() => {
    sessionIdRef.current = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);

  // FPS 统计
  const fpsCounterRef = useRef({ count: 0, lastTick: Date.now() });
  useEffect(() => {
    const interval = setInterval(() => {
      const counter = fpsCounterRef.current;
      const now = Date.now();
      const elapsed = (now - counter.lastTick) / 1000;
      if (elapsed > 0) {
        setRemoteFps(Math.round(counter.count / elapsed));
      }
      counter.count = 0;
      counter.lastTick = now;
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // TTS
  const speakFeedback = useCallback(async (text: string) => {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const audioUrl: string | undefined = data.audioUrl;
      if (audioUrl) {
        if (audioRef.current) audioRef.current.pause();
        audioRef.current = new Audio(audioUrl);
        audioRef.current.play().catch(() => {});
      }
    } catch {
      // TTS 失败静默处理
    }
  }, []);

  // WS 消息处理
  const handleWsMessage = useCallback((msg: WsMessage) => {
    // 远程模式：接收服务端骨架检测的帧
    if (msg.type === 'remote:frame') {
      const payload = msg.payload as RemoteFramePayload;
      fpsCounterRef.current.count++;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      const img = remoteImgRef.current || new Image();
      remoteImgRef.current = img;

      img.onload = () => {
        canvas.width = img.naturalWidth || 640;
        canvas.height = img.naturalHeight || 480;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = `data:image/jpeg;base64,${payload.image}`;
      return;
    }

    // 远程模式：骨架坐标
    if (msg.type === 'remote:skeleton') {
      const payload = msg.payload as { landmarks: Landmark[] };
      if (payload.landmarks && payload.landmarks.length > 0) {
        setPoseDetected(true);
      }
      return;
    }

    // 远程模式：未检测到人体
    if (msg.type === 'remote:nopose') {
      setPoseDetected(false);
      return;
    }

    // RPi 连接状态
    if (msg.type === 'rpi:status') {
      const payload = msg.payload as RpiStatusPayload;
      setRpiConnected(payload.connected);
      return;
    }

    // 教练反馈
    if (msg.type === 'coaching:feedback') {
      const feedback = msg.payload as CoachingFeedback;
      setCurrentFeedback(feedback);
      setDetectedExercise(feedback.exercise);
      setRepCount(feedback.repCount);
      setQuality(feedback.quality);

      const entry: FeedbackEntry = {
        id: feedbackIdRef.current++,
        timestamp: Date.now(),
        feedback,
      };
      setFeedbackHistory(prev => [entry, ...prev].slice(0, 20));

      if (feedback.quality !== 'good' && feedback.tips.length > 0) {
        speakFeedback(feedback.tips[0]);
      } else if (feedback.encouragement) {
        speakFeedback(feedback.encouragement);
      }
    }
  }, [speakFeedback]);

  // 初始化 WS
  useEffect(() => {
    wsRef.current = createWsConnection({
      path: '/ws/coaching',
      onMessage: handleWsMessage,
      onOpen: () => setWsConnected(true),
      onClose: () => setWsConnected(false),
    });
    return () => wsRef.current?.close();
  }, [handleWsMessage]);

  // 发送运动类型到服务端（远程模式需要）
  useEffect(() => {
    if (wsRef.current && source === 'remote') {
      wsRef.current.send({
        type: 'set:exercise',
        payload: { exercise: selectedExercise === 'auto' ? '' : selectedExercise },
      });
    }
  }, [selectedExercise, source]);

  // 发送骨架帧（本地模式）
  const sendPoseBatch = useCallback(() => {
    if (!wsRef.current || frameBufferRef.current.length === 0) return;
    const frames = frameBufferRef.current.splice(0);
    wsRef.current.send({
      type: 'pose:batch',
      payload: {
        frames: frames.map(landmarks => ({ landmarks, timestamp: Date.now() })),
        exercise: selectedExercise === 'auto' ? undefined : selectedExercise,
        sessionId: sessionIdRef.current,
      },
    });
  }, [selectedExercise]);

  // 定时发送骨架帧（本地模式）
  useEffect(() => {
    if (!isRunning || source !== 'local') return;
    const interval = setInterval(sendPoseBatch, 2000);
    return () => clearInterval(interval);
  }, [isRunning, sendPoseBatch, source]);

  // 绘制骨架
  const drawSkeleton = useCallback((
    ctx: CanvasRenderingContext2D,
    landmarks: Array<{ x: number; y: number; z: number; visibility: number }>,
    w: number,
    h: number,
    currentQuality: 'good' | 'warning' | 'error',
  ) => {
    const color = getSkeletonColor(currentQuality);

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;

    for (const [start, end] of POSE_CONNECTIONS) {
      const a = landmarks[start];
      const b = landmarks[end];
      if (a && b && a.visibility > 0.5 && b.visibility > 0.5) {
        ctx.beginPath();
        ctx.moveTo(a.x * w, a.y * h);
        ctx.lineTo(b.x * w, b.y * h);
        ctx.stroke();
      }
    }

    ctx.shadowBlur = 12;
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (lm && lm.visibility > 0.5) {
        ctx.beginPath();
        ctx.arc(lm.x * w, lm.y * h, 5, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#0F1117';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  }, []);

  // 本地模式启动
  const handleStartLocal = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
      await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/pose/pose.js');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mpPose = (window as any).Pose;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mpCamera = (window as any).Camera;

      if (!mpPose || !mpCamera) {
        throw new Error('MediaPipe 加载失败');
      }

      const video = videoRef.current;
      if (!video) return;

      const pose = new mpPose({
        locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      });

      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      pose.onResults((results: { poseLandmarks: Array<{ x: number; y: number; z: number; visibility: number }> | null; image: HTMLVideoElement }) => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx || !video) return;

        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;

        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
        ctx.restore();

        if (results.poseLandmarks) {
          setPoseDetected(true);
          const mirroredLandmarks = results.poseLandmarks.map(lm => ({
            x: 1 - lm.x,
            y: lm.y,
            z: lm.z,
            visibility: lm.visibility,
          }));
          drawSkeleton(ctx, mirroredLandmarks, canvas.width, canvas.height, quality);

          const frame: Landmark[] = results.poseLandmarks.map(lm => ({
            x: lm.x,
            y: lm.y,
            z: lm.z,
            visibility: lm.visibility,
          }));
          frameBufferRef.current.push(frame);
          if (frameBufferRef.current.length > 30) {
            frameBufferRef.current = frameBufferRef.current.slice(-30);
          }
        } else {
          setPoseDetected(false);
        }
      });

      const camera = new mpCamera(video, {
        onFrame: async () => {
          await pose.send({ image: video });
        },
        width: 640,
        height: 480,
      });

      await camera.start();
      poseInstanceRef.current = pose;
      cameraRef.current = camera;
      setIsRunning(true);
      setRepCount(0);
      setFeedbackHistory([]);
      setCurrentFeedback(null);
    } catch (err) {
      console.error('启动失败:', err);
      setLoadError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setIsLoading(false);
    }
  }, [drawSkeleton, quality]);

  // 远程模式启动（无需摄像头，等 RPi 发帧）
  const handleStartRemote = useCallback(() => {
    setIsRunning(true);
    setRepCount(0);
    setFeedbackHistory([]);
    setCurrentFeedback(null);
  }, []);

  // 通用启动
  const handleStart = useCallback(() => {
    if (source === 'local') {
      handleStartLocal();
    } else {
      handleStartRemote();
    }
  }, [source, handleStartLocal, handleStartRemote]);

  const handleStop = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cam = cameraRef.current as any;
    if (cam?.stop) cam.stop();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pose = poseInstanceRef.current as any;
    if (pose?.close) pose.close();
    cameraRef.current = null;
    poseInstanceRef.current = null;
    setIsRunning(false);
    setPoseDetected(false);
    frameBufferRef.current = [];
  }, []);

  // 切换模式时停止
  const handleSourceChange = useCallback((newSource: SourceMode) => {
    if (isRunning) handleStop();
    setSource(newSource);
  }, [isRunning, handleStop]);

  const qualityColor = { good: 'text-[#22D3A7]', warning: 'text-[#FF6B35]', error: 'text-[#FF4757]' }[quality];
  const qualityBg = {
    good: 'bg-[#22D3A7]/10 border-[#22D3A7]/30',
    warning: 'bg-[#FF6B35]/10 border-[#FF6B35]/30',
    error: 'bg-[#FF4757]/10 border-[#FF4757]/30',
  }[quality];
  const qualityLabel = { good: '动作标准', warning: '需要调整', error: '注意安全' }[quality];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0F1117] text-[#E8E9ED]">
      {/* 左侧：摄像头/远程帧 + 骨架 */}
      <div className="flex flex-1 flex-col">
        <div className="relative flex-1 flex items-center justify-center bg-[#0A0C12]">
          <video ref={videoRef} className="hidden" playsInline muted />
          <canvas ref={canvasRef} className="h-full w-full object-contain" />

          {!isRunning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0A0C12]">
              <div className="text-6xl opacity-20">
                {source === 'local' ? '🏃' : '📡'}
              </div>
              <p className="text-[#8B8FA3] text-sm">
                {isLoading ? '正在初始化...' : source === 'local' ? '点击下方按钮开始训练' : '等待树莓派视频流...'}
              </p>
              {source === 'remote' && !rpiConnected && (
                <p className="text-[#FF4757]/70 text-xs">树莓派未连接 — 请先运行 rpi_client.py</p>
              )}
              {loadError && <p className="text-[#FF4757] text-xs">{loadError}</p>}
            </div>
          )}

          {/* 状态指示 */}
          <div className="absolute left-4 top-4 flex items-center gap-2">
            <Badge variant="outline" className={`text-xs ${wsConnected ? 'border-[#22D3A7]/40 text-[#22D3A7]' : 'border-[#FF4757]/40 text-[#FF4757]'}`}>
              <span className={`mr-1 inline-block h-2 w-2 rounded-full ${wsConnected ? 'bg-[#22D3A7]' : 'bg-[#FF4757]'} animate-pulse`} />
              云端
            </Badge>
            {source === 'remote' && (
              <Badge variant="outline" className={`text-xs ${rpiConnected ? 'border-[#22D3A7]/40 text-[#22D3A7]' : 'border-[#FF4757]/40 text-[#FF4757]'}`}>
                <span className={`mr-1 inline-block h-2 w-2 rounded-full ${rpiConnected ? 'bg-[#22D3A7]' : 'bg-[#FF4757]'} animate-pulse`} />
                RPi {rpiConnected ? '在线' : '离线'}
              </Badge>
            )}
            {isRunning && source === 'local' && (
              <Badge variant="outline" className="border-[#FF6B35]/40 text-[#FF6B35] text-xs">
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#FF6B35] animate-pulse" />
                LIVE
              </Badge>
            )}
            {isRunning && source === 'remote' && remoteFps > 0 && (
              <Badge variant="outline" className="border-[#22D3A7]/40 text-[#22D3A7] text-xs font-mono">
                {remoteFps} FPS
              </Badge>
            )}
          </div>

          {/* 右上角计数 */}
          {isRunning && (
            <div className="absolute right-4 top-4 text-right">
              <div className="font-mono text-5xl font-bold tabular-nums text-[#FF6B35] drop-shadow-[0_0_12px_rgba(255,107,53,0.4)]">
                {repCount}
              </div>
              <div className="text-xs text-[#8B8FA3]">
                {detectedExercise || (selectedExercise === 'auto' ? '识别中...' : EXERCISES.find(e => e.id === selectedExercise)?.label)}
              </div>
            </div>
          )}

          {/* 质量指示 */}
          {isRunning && poseDetected && (
            <div className="absolute bottom-4 left-4">
              <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${qualityBg}`}>
                <span className={`h-2.5 w-2.5 rounded-full ${
                  quality === 'good' ? 'bg-[#22D3A7]' : quality === 'warning' ? 'bg-[#FF6B35]' : 'bg-[#FF4757]'
                } animate-pulse`} />
                <span className={qualityColor}>{qualityLabel}</span>
              </div>
            </div>
          )}

          {/* 模式标识 */}
          {isRunning && (
            <div className="absolute bottom-4 right-4">
              <Badge variant="outline" className="border-[#8B8FA3]/30 text-[#8B8FA3] text-xs">
                {source === 'local' ? '📷 本地摄像头' : '📡 RPi → 云端检测'}
              </Badge>
            </div>
          )}
        </div>

        {/* 控制栏 */}
        <div className="flex items-center gap-3 border-t border-[#1A1D27] bg-[#0F1117] px-4 py-3">
          {/* 模式切换 */}
          <div className="flex items-center gap-1 rounded-lg bg-[#0A0C12] p-1">
            <button
              onClick={() => handleSourceChange('local')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                source === 'local'
                  ? 'bg-[#1A1D27] text-[#E8E9ED] shadow-sm'
                  : 'text-[#8B8FA3] hover:text-[#E8E9ED]'
              }`}
            >
              📷 本地
            </button>
            <button
              onClick={() => handleSourceChange('remote')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                source === 'remote'
                  ? 'bg-[#1A1D27] text-[#E8E9ED] shadow-sm'
                  : 'text-[#8B8FA3] hover:text-[#E8E9ED]'
              }`}
            >
              📡 远程
            </button>
          </div>

          <Separator orientation="vertical" className="h-6 bg-[#1A1D27]" />

          <Button
            onClick={isRunning ? handleStop : handleStart}
            disabled={isLoading || (source === 'remote' && !rpiConnected && !isRunning)}
            className={isRunning
              ? 'bg-[#FF4757] hover:bg-[#FF4757]/80 text-white'
              : 'bg-[#FF6B35] hover:bg-[#FF6B35]/80 text-white'}
          >
            {isLoading ? '初始化中...' : isRunning ? '停止训练' : source === 'local' ? '开始训练' : '开始接收'}
          </Button>

          <Separator orientation="vertical" className="h-6 bg-[#1A1D27]" />

          <div className="flex items-center gap-1.5 overflow-x-auto">
            {EXERCISES.map(ex => (
              <button
                key={ex.id}
                onClick={() => setSelectedExercise(ex.id)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  selectedExercise === ex.id
                    ? 'bg-[#FF6B35] text-white shadow-[0_0_12px_rgba(255,107,53,0.3)]'
                    : 'bg-[#1A1D27] text-[#8B8FA3] hover:bg-[#252836] hover:text-[#E8E9ED]'
                }`}
              >
                {ex.icon} {ex.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 右侧：教练面板 */}
      <div className="flex w-[380px] shrink-0 flex-col border-l border-[#1A1D27] bg-[#0F1117]">
        <div className="flex items-center justify-between border-b border-[#1A1D27] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">AI 教练</h2>
            <p className="text-xs text-[#8B8FA3]">实时动作分析 & 语音指导</p>
          </div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FF6B35]/10 text-sm">🤖</div>
        </div>

        {/* 当前反馈 */}
        <div className="border-b border-[#1A1D27] px-5 py-4">
          {currentFeedback ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#8B8FA3]">当前动作</span>
                <Badge className={`${qualityColor} border-0 bg-transparent font-semibold`}>
                  {currentFeedback.exercise}
                </Badge>
              </div>
              {currentFeedback.tips.length > 0 && (
                <div className="space-y-1.5">
                  {currentFeedback.tips.map((tip, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                        quality === 'error'
                          ? 'bg-[#FF4757]/10 text-[#FF4757]'
                          : quality === 'warning'
                          ? 'bg-[#FF6B35]/10 text-[#FF6B35]'
                          : 'bg-[#22D3A7]/10 text-[#22D3A7]'
                      }`}
                    >
                      <span className="mt-0.5 shrink-0 text-xs">{quality === 'good' ? '✓' : '⚠'}</span>
                      <span>{tip}</span>
                    </div>
                  ))}
                </div>
              )}
              {currentFeedback.encouragement && (
                <div className="text-center text-sm font-medium text-[#22D3A7]">
                  &ldquo;{currentFeedback.encouragement}&rdquo;
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-[#8B8FA3]">
              {isRunning ? '正在分析动作...' : '开始训练后，教练将实时指导你'}
            </div>
          )}
        </div>

        {/* 训练数据 */}
        <div className="grid grid-cols-2 gap-3 border-b border-[#1A1D27] px-5 py-4">
          <Card className="border-[#1A1D27] bg-[#1A1D27]/50">
            <CardContent className="p-3">
              <div className="text-xs text-[#8B8FA3]">完成次数</div>
              <div className="font-mono text-2xl font-bold text-[#FF6B35]">{repCount}</div>
            </CardContent>
          </Card>
          <Card className="border-[#1A1D27] bg-[#1A1D27]/50">
            <CardContent className="p-3">
              <div className="text-xs text-[#8B8FA3]">动作质量</div>
              <div className={`text-2xl font-bold ${qualityColor}`}>
                {quality === 'good' ? 'A' : quality === 'warning' ? 'B' : 'C'}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="px-5 py-3">
          <div className="flex items-center justify-between text-xs text-[#8B8FA3]">
            <span>质量评分</span>
            <span className={qualityColor}>
              {quality === 'good' ? '90%' : quality === 'warning' ? '60%' : '30%'}
            </span>
          </div>
          <Progress
            value={quality === 'good' ? 90 : quality === 'warning' ? 60 : 30}
            className="mt-1.5 h-1.5 bg-[#1A1D27]"
          />
        </div>

        {/* 反馈历史 */}
        <div className="flex-1 min-h-0">
          <div className="px-5 py-2 text-xs font-medium text-[#8B8FA3]">历史反馈</div>
          <ScrollArea className="h-full px-5">
            {feedbackHistory.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#8B8FA3]/50">暂无反馈记录</div>
            ) : (
              <div className="space-y-2 pb-4">
                {feedbackHistory.map(entry => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-[#1A1D27] bg-[#1A1D27]/30 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span style={{ color: getSkeletonColor(entry.feedback.quality) }}>
                        {entry.feedback.exercise}
                      </span>
                      <span className="text-[#8B8FA3]/50 font-mono">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    {entry.feedback.tips[0] && (
                      <p className="mt-1 text-[#8B8FA3]">{entry.feedback.tips[0]}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* 架构说明 */}
        <div className="border-t border-[#1A1D27] px-5 py-3">
          <div className="text-[10px] text-[#8B8FA3]/50 leading-relaxed">
            {source === 'local'
              ? '架构: 浏览器 MediaPipe Pose → WebSocket → 云端 LLM 推理 → TTS 语音反馈'
              : '架构: RPi 摄像头 → WebSocket → 云端骨架检测 + LLM + TTS → 浏览器显示'
            }
          </div>
        </div>
      </div>
    </div>
  );
}
