'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { createWsConnection, type WsMessage, type Landmark, type CoachingFeedback } from '@/lib/ws-client';

// ─── 常量 ───
const EXERCISES = [
  { id: 'squat', label: '深蹲', icon: '🏋️' },
  { id: 'pushup', label: '俯卧撑', icon: '💪' },
  { id: 'lunge', label: '弓步蹲', icon: '🦵' },
  { id: 'plank', label: '平板支撑', icon: '🧘' },
  { id: 'jumpjack', label: '开合跳', icon: '⭐' },
  { id: 'highknees', label: '高抬腿', icon: '🏃' },
  { id: 'situp', label: '仰卧起坐', icon: '🔄' },
];

type SourceMode = 'local' | 'remote';

type FeedbackEntry = {
  id: number;
  timestamp: number;
  feedback: CoachingFeedback;
};

type RpiStatusPayload = {
  connected: boolean;
  fps?: number;
};

// 骨架连线（MediaPipe 33 点）
const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26],
  [25, 27], [26, 28], [15, 17], [16, 18], [27, 29],
  [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
];

function getSkeletonColor(q: 'good' | 'warning' | 'error') {
  return q === 'good' ? '#22D3A7' : q === 'warning' ? '#FF6B35' : '#FF4757';
}

// fetch+blob 音频播放（绕过浏览器跨域 autoplay 限制）
async function playAudioViaBlob(audioUrl: string) {
  try {
    const response = await fetch(audioUrl);
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const audio = new Audio(blobUrl);
    audio.onended = () => URL.revokeObjectURL(blobUrl);
    await audio.play();
  } catch {
    // 降级：直接播放
    try {
      await new Audio(audioUrl).play();
    } catch { /* 忽略 */ }
  }
}

export default function PoseCoach() {
  // ─── 状态 ───
  const [source, setSource] = useState<SourceMode>('local');
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadStage, setLoadStage] = useState('');
  const [modelReady, setModelReady] = useState(false);

  const [repCount, setRepCount] = useState(0);
  const [quality, setQuality] = useState<'good' | 'warning' | 'error'>('good');
  const [poseDetected, setPoseDetected] = useState(false);
  const [detectedExercise, setDetectedExercise] = useState('');
  const [selectedExercise, setSelectedExercise] = useState('squat');

  const [currentFeedback, setCurrentFeedback] = useState<CoachingFeedback | null>(null);
  const [feedbackHistory, setFeedbackHistory] = useState<FeedbackEntry[]>([]);
  const feedbackIdRef = useRef(0);

  const [effectFlash, setEffectFlash] = useState<'perfect' | 'excellent' | 'good' | 'adjust' | 'warning' | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [rpiConnected, setRpiConnected] = useState(false);
  const [remoteFps, setRemoteFps] = useState(0);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);

  // 训练时长
  const [trainingSeconds, setTrainingSeconds] = useState(0);
  const trainingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 语音交互
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceText, setVoiceText] = useState('');
  const voiceListeningRef = useRef(false);
  const recognitionRef = useRef<ReturnType<typeof createSpeechRecognition> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const fallbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wsRef = useRef<ReturnType<typeof createWsConnection> | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const poseInstanceRef = useRef<any>(null);
  const poseWarmRef = useRef<any>(null);
  const frameBufferRef = useRef<Landmark[][]>([]);
  const remoteImgRef = useRef<HTMLImageElement | null>(null);

  // ─── 摄像头枚举 ───
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then(devices => {
      setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
    });
  }, []);

  // ─── 模型预热 ───
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadStage('加载 MediaPipe Pose...');
        const vision = await import('@mediapipe/tasks-vision');
        const { PoseLandmarker, FilesetResolver } = vision;
        const visionRes = await FilesetResolver.forVisionTasks(
          '/models'
        );
        setLoadStage('下载骨架检测模型...');
        const landmarker = await PoseLandmarker.createFromOptions(visionRes, {
          baseOptions: {
            modelAssetPath: '/models/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          numPoses: 1,
          runningMode: 'VIDEO',
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (!cancelled) {
          poseWarmRef.current = landmarker;
          setModelReady(true);
          setLoadStage('');
        }
      } catch {
        if (!cancelled) {
          setLoadStage('');
          setLoadError('模型预热失败');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── 训练计时器 ───
  useEffect(() => {
    if (isRunning) {
      trainingTimerRef.current = setInterval(() => {
        setTrainingSeconds(s => s + 1);
      }, 1000);
    } else {
      if (trainingTimerRef.current) clearInterval(trainingTimerRef.current);
      trainingTimerRef.current = null;
    }
    return () => {
      if (trainingTimerRef.current) clearInterval(trainingTimerRef.current);
    };
  }, [isRunning]);

  // ─── 格式化时间 ───
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // ─── Web Speech API 语音识别工厂 ───
  function createSpeechRecognition() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return null;
    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'zh-CN';
    return recognition;
  }

  // ─── 语音交互开关 ───
  const toggleVoiceMode = useCallback(async () => {
    if (voiceEnabled) {
      // 关闭
      voiceListeningRef.current = false;
      setVoiceEnabled(false);
      try { recognitionRef.current?.stop(); } catch { /* ok */ }
      try { mediaRecorderRef.current?.stop(); } catch { /* ok */ }
      try { mediaStreamRef.current?.getTracks().forEach(t => t.stop()); } catch { /* ok */ }
      if (fallbackIntervalRef.current) clearInterval(fallbackIntervalRef.current);
      fallbackIntervalRef.current = null;
      return;
    }

    // 开启
    const recognition = createSpeechRecognition();
    if (recognition) {
      recognitionRef.current = recognition;
      recognition.onresult = (e: any) => {
        const text = Array.from(e.results).map((r: any) => r[0].transcript).join('').trim();
        if (text && wsRef.current) {
          setVoiceText(text);
          wsRef.current.send({ type: 'voice_command', payload: { text } });
        }
      };
      recognition.onend = () => {
        if (voiceListeningRef.current) {
          try { recognition.start(); } catch { /* ok */ }
        }
      };
      try {
        recognition.start();
        voiceListeningRef.current = true;
        setVoiceEnabled(true);
        return;
      } catch { /* fallback below */ }
    }

    // 降级：MediaRecorder + 后端 ASR
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0 && wsRef.current) {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            wsRef.current!.send({ type: 'voice_command', payload: { audio: base64 } });
          };
          reader.readAsDataURL(e.data);
        }
      };
      recorder.start();
      // 每3秒一段
      fallbackIntervalRef.current = setInterval(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
          recorder.start();
        }
      }, 3000);
      voiceListeningRef.current = true;
      setVoiceEnabled(true);
    } catch (err) {
      console.error('麦克风访问失败:', err);
      setVoiceEnabled(false);
    }
  }, [voiceEnabled]);

  // ─── WS 消息处理 ───
  const handleWsMessage = useCallback((msg: WsMessage) => {
    // 远程帧
    if (msg.type === 'remote:frame') {
      const payload = msg.payload as { image: string };
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

    if (msg.type === 'remote:skeleton') {
      const payload = msg.payload as { landmarks: Landmark[] };
      if (payload.landmarks && payload.landmarks.length > 0) setPoseDetected(true);
      return;
    }

    if (msg.type === 'remote:nopose') {
      setPoseDetected(false);
      return;
    }

    if (msg.type === 'rpi:status') {
      const payload = msg.payload as RpiStatusPayload;
      setRpiConnected(payload.connected);
      if (payload.fps) setRemoteFps(payload.fps);
      return;
    }

    // 实时算法更新
    if (msg.type === 'algorithm_update') {
      const payload = msg.payload as {
        exercise: string; stage: string; repCount: number;
        quality: 'good' | 'warning' | 'error';
        effect: 'perfect' | 'excellent' | 'good' | null;
        kneeAngle: number | null; hipAngle: number | null;
      };
      setDetectedExercise(payload.exercise);
      setRepCount(payload.repCount);
      setQuality(payload.quality);
      return;
    }

    // 完成动作特效
    if (msg.type === 'rep_completed') {
      const payload = msg.payload as { repCount: number; effect: 'perfect' | 'excellent' | 'good' | null; quality: number };
      setRepCount(payload.repCount);
      if (payload.effect) {
        setEffectFlash(payload.effect);
        setTimeout(() => setEffectFlash(null), 1500);
      }
      return;
    }

    // 教练反馈
    if (msg.type === 'coaching_feedback') {
      const feedback = msg.payload as CoachingFeedback;
      setCurrentFeedback(feedback);
      setDetectedExercise(feedback.exercise);
      setRepCount(feedback.repCount);
      setQuality(feedback.quality);
      const entry: FeedbackEntry = { id: feedbackIdRef.current++, timestamp: Date.now(), feedback };
      setFeedbackHistory(prev => [entry, ...prev].slice(0, 20));
      if (feedback.effect) {
        setEffectFlash(feedback.effect);
        setTimeout(() => setEffectFlash(null), 1500);
      }
    }

    // TTS 语音播放（fetch+blob 方式）
    if (msg.type === 'tts_ready') {
      const payload = msg.payload as { audioUrl?: string; text?: string };
      if (payload.audioUrl) {
        playAudioViaBlob(payload.audioUrl);
      }
    }

    // 语音识别结果
    if (msg.type === 'voice_recognized') {
      const payload = msg.payload as { text: string };
      setVoiceText(payload.text);
    }

    // 语音回复文本
    if (msg.type === 'voice_reply') {
      const payload = msg.payload as { text: string };
      setCurrentFeedback(prev => prev ? { ...prev, tips: [payload.text], encouragement: '' } : null);
    }

    // 语音回复 TTS
    if (msg.type === 'voice_reply_tts') {
      const payload = msg.payload as { audioUrl?: string; text?: string };
      if (payload.audioUrl) {
        playAudioViaBlob(payload.audioUrl);
      }
    }
  }, []);

  // ─── 初始化 WS ───
  useEffect(() => {
    wsRef.current = createWsConnection({
      path: '/ws/coaching',
      onMessage: handleWsMessage,
      onOpen: () => setWsConnected(true),
      onClose: () => setWsConnected(false),
    });
    return () => wsRef.current?.close();
  }, [handleWsMessage]);

  // ─── 发送运动类型（远程模式） ───
  useEffect(() => {
    if (wsRef.current && source === 'remote') {
      wsRef.current.send({
        type: 'set:exercise',
        payload: { exercise: selectedExercise === 'auto' ? '' : selectedExercise },
      });
    }
  }, [selectedExercise, source]);

  // ─── 发送骨架帧 ───
  const sendPoseFrame = useCallback((landmarks: Landmark[]) => {
    if (!wsRef.current) return;
    wsRef.current.send({ type: 'pose_frame', payload: { landmarks, timestamp: Date.now() } });
  }, []);

  // ─── 发送运动类型（本地模式） ───
  useEffect(() => {
    if (!wsRef.current || source !== 'local') return;
    wsRef.current.send({
      type: 'set_exercise',
      payload: { exercise: selectedExercise === 'auto' ? 'squat' : selectedExercise },
    });
  }, [selectedExercise, source]);

  // ─── 绘制骨架 ───
  const drawSkeleton = useCallback((
    ctx: CanvasRenderingContext2D,
    landmarks: Array<{ x: number; y: number; z: number; visibility: number }>,
    w: number, h: number,
    currentQuality: 'good' | 'warning' | 'error',
  ) => {
    const color = getSkeletonColor(currentQuality);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    for (const [start, end] of POSE_CONNECTIONS) {
      const a = landmarks[start]; const b = landmarks[end];
      if (a && b && a.visibility > 0.5 && b.visibility > 0.5) {
        ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke();
      }
    }
    ctx.shadowBlur = 12;
    for (let i = 0; i < landmarks.length; i++) {
      const lm = landmarks[i];
      if (lm && lm.visibility > 0.5) {
        ctx.beginPath(); ctx.arc(lm.x * w, lm.y * h, 5, 0, 2 * Math.PI);
        ctx.fillStyle = color; ctx.fill();
        ctx.strokeStyle = '#0F1117'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  }, []);

  // ─── 本地模式启动 ───
  const handleStartLocal = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const video = videoRef.current;
      if (!video) return;
      const landmarker = poseWarmRef.current;
      if (!landmarker) { setLoadError('模型未就绪，请稍候重试'); return; }
      const constraints: MediaStreamConstraints = {
        video: { width: { ideal: 640 }, height: { ideal: 480 }, ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}) },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      poseInstanceRef.current = landmarker;
      setIsRunning(true);
      setRepCount(0);
      setTrainingSeconds(0);
      setFeedbackHistory([]);
      setCurrentFeedback(null);
      setLoadStage('');

      let lastTime = -1;
      const processFrame = () => {
        if (!videoRef.current || videoRef.current.paused) return;
        const now = performance.now();
        if (now === lastTime) { requestAnimationFrame(processFrame); return; }
        const result = landmarker.detectForVideo(video, now);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;
          ctx.save(); ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          ctx.restore();
          if (result.landmarks && result.landmarks.length > 0) {
            setPoseDetected(true);
            const lm = result.landmarks[0];
            const mirroredLandmarks = lm.map((p: { x: number; y: number; z: number; visibility?: number }) => ({
              x: 1 - p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0,
            }));
            drawSkeleton(ctx, mirroredLandmarks, canvas.width, canvas.height, quality);
            const frame: Landmark[] = lm.map((p: { x: number; y: number; z: number; visibility?: number }) => ({
              x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 0,
            }));
            sendPoseFrame(frame);
          } else {
            setPoseDetected(false);
          }
        }
        lastTime = now;
        requestAnimationFrame(processFrame);
      };
      requestAnimationFrame(processFrame);
      cameraRef.current = stream;
    } catch (err) {
      console.error('启动失败:', err);
      setLoadError(err instanceof Error ? err.message : '未知错误');
      setLoadStage('');
    } finally {
      setIsLoading(false);
    }
  }, [drawSkeleton, quality, selectedDeviceId, sendPoseFrame]);

  // ─── 远程模式启动 ───
  const handleStartRemote = useCallback(() => {
    setIsRunning(true);
    setRepCount(0);
    setTrainingSeconds(0);
    setFeedbackHistory([]);
    setCurrentFeedback(null);
  }, []);

  const handleStart = useCallback(() => {
    if (source === 'local') handleStartLocal();
    else handleStartRemote();
  }, [source, handleStartLocal, handleStartRemote]);

  const handleStop = useCallback(() => {
    const stream = cameraRef.current as MediaStream | null;
    if (stream) stream.getTracks().forEach(t => t.stop());
    cameraRef.current = null;
    poseInstanceRef.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setIsRunning(false);
    setPoseDetected(false);
    frameBufferRef.current = [];
  }, []);

  const handleSourceChange = useCallback((newSource: SourceMode) => {
    if (isRunning) handleStop();
    setSource(newSource);
  }, [isRunning, handleStop]);

  // ─── 派生值 ───
  const qualityColor = { good: 'text-[#22D3A7]', warning: 'text-[#FF6B35]', error: 'text-[#FF4757]' }[quality];
  const qualityBg = {
    good: 'bg-[#22D3A7]/10 border-[#22D3A7]/30',
    warning: 'bg-[#FF6B35]/10 border-[#FF6B35]/30',
    error: 'bg-[#FF4757]/10 border-[#FF4757]/30',
  }[quality];
  const qualityLabel = { good: '动作标准', warning: '需要调整', error: '注意安全' }[quality];

  // ─── 渲染 ───
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0F1117] text-[#E8E9ED]">
      {/* 左侧：摄像头/远程帧 + 骨架 */}
      <div className="flex flex-1 flex-col">
        <div className="relative flex-1 flex items-center justify-center bg-[#0A0C12]">
          <video ref={videoRef} className="hidden" playsInline muted />
          <canvas ref={canvasRef} className="h-full w-full object-contain" />

          {/* 完成动作特效 */}
          {effectFlash && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className="animate-bounce text-5xl font-black tracking-wider"
                style={{
                  color: effectFlash === 'perfect' ? '#FFD700' : effectFlash === 'excellent' ? '#22D3A7' : '#FF6B35',
                  textShadow: `0 0 30px ${effectFlash === 'perfect' ? '#FFD70080' : effectFlash === 'excellent' ? '#22D3A780' : '#FF6B3580'}`,
                }}
              >
                {effectFlash === 'perfect' ? 'PERFECT!' : effectFlash === 'excellent' ? 'EXCELLENT!' : 'GOOD!'}
              </div>
            </div>
          )}

          {!isRunning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0A0C12]">
              <div className="text-6xl opacity-20">{source === 'local' ? '🏃' : '📡'}</div>
              {source === 'local' && loadStage ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#FF6B35] border-t-transparent" />
                    <p className="text-sm text-[#FF6B35]">{loadStage}</p>
                  </div>
                  {loadStage.includes('模型') && (
                    <p className="text-xs text-[#8B8FA3]/50">首次加载需下载 ~5MB 模型文件，后续常驻内存</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-[#8B8FA3]">
                  {isLoading ? '正在初始化...' : source === 'local' ? (modelReady ? '模型已就绪，点击开始训练' : '等待模型加载...') : '等待树莓派视频流...'}
                </p>
              )}
              {source === 'remote' && !rpiConnected && (
                <p className="text-xs text-[#FF4757]/70">树莓派未连接 — 请先运行 rpi_client.py</p>
              )}
              {loadError && <p className="text-xs text-[#FF4757]">{loadError}</p>}
              {source === 'local' && modelReady && !isRunning && !isLoading && (
                <div className="mt-2 flex items-center gap-2 text-xs text-[#22D3A7]/70">
                  <span className="inline-block h-2 w-2 rounded-full bg-[#22D3A7]" />
                  骨架检测模型已常驻内存
                </div>
              )}
            </div>
          )}

          {/* 状态指示 */}
          <div className="absolute left-4 top-4 flex items-center gap-2">
            {source === 'local' && !modelReady && loadStage && (
              <Badge variant="outline" className="border-[#FF6B35]/40 text-xs text-[#FF6B35] animate-pulse">
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#FF6B35]" />
                {loadStage.includes('模型') ? '下载模型中' : '加载中'}
              </Badge>
            )}
            {source === 'local' && modelReady && !isRunning && (
              <Badge variant="outline" className="border-[#22D3A7]/40 text-xs text-[#22D3A7]">
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#22D3A7]" />
                模型就绪
              </Badge>
            )}
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
              <Badge variant="outline" className="border-[#FF6B35]/40 text-xs text-[#FF6B35] animate-pulse">
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#FF6B35]" />
                LIVE
              </Badge>
            )}
            {isRunning && source === 'remote' && remoteFps > 0 && (
              <Badge variant="outline" className="border-[#22D3A7]/40 text-xs font-mono text-[#22D3A7]">
                {remoteFps} FPS
              </Badge>
            )}
          </div>

          {/* 右上角计数 + 计时 */}
          {isRunning && (
            <div className="absolute right-4 top-4 text-right">
              <div className="font-mono text-5xl font-bold tabular-nums text-[#FF6B35] drop-shadow-[0_0_12px_rgba(255,107,53,0.4)]">
                {repCount}
              </div>
              <div className="text-xs text-[#8B8FA3]">
                {detectedExercise || EXERCISES.find(e => e.id === selectedExercise)?.label}
              </div>
              <div className="mt-1 font-mono text-sm text-[#8B8FA3]/70">
                {formatTime(trainingSeconds)}
              </div>
            </div>
          )}

          {/* 质量指示 */}
          {isRunning && poseDetected && (
            <div className="absolute bottom-4 left-4">
              <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${qualityBg}`}>
                <span className={`h-2.5 w-2.5 rounded-full ${quality === 'good' ? 'bg-[#22D3A7]' : quality === 'warning' ? 'bg-[#FF6B35]' : 'bg-[#FF4757]'} animate-pulse`} />
                <span className={qualityColor}>{qualityLabel}</span>
              </div>
            </div>
          )}

          {/* 模式标识 */}
          {isRunning && (
            <div className="absolute bottom-4 right-4">
              <Badge variant="outline" className="border-[#8B8FA3]/30 text-xs text-[#8B8FA3]">
                {source === 'local' ? '📷 本地摄像头' : '📡 RPi → 云端检测'}
              </Badge>
            </div>
          )}

          {/* 语音识别文字 */}
          {voiceEnabled && voiceText && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <div className="rounded-full bg-[#1A1D27]/90 px-4 py-1.5 text-sm text-[#E8E9ED] shadow-lg">
                &ldquo;{voiceText}&rdquo;
              </div>
            </div>
          )}
        </div>

        {/* 控制栏 */}
        <div className="flex items-center gap-3 border-t border-[#1A1D27] bg-[#0F1117] px-4 py-3">
          {/* 模式切换 */}
          <div className="flex items-center gap-1 rounded-lg bg-[#0A0C12] p-1">
            <button
              onClick={() => handleSourceChange('local')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${source === 'local' ? 'bg-[#1A1D27] text-[#E8E9ED] shadow-sm' : 'text-[#8B8FA3] hover:text-[#E8E9ED]'}`}
            >
              本地
            </button>
            <button
              onClick={() => handleSourceChange('remote')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${source === 'remote' ? 'bg-[#1A1D27] text-[#E8E9ED] shadow-sm' : 'text-[#8B8FA3] hover:text-[#E8E9ED]'}`}
            >
              远程
            </button>
          </div>

          {/* 摄像头选择 */}
          {source === 'local' && videoDevices.length > 1 && (
            <>
              <Separator orientation="vertical" className="h-6 bg-[#1A1D27]" />
              <select
                value={selectedDeviceId}
                onChange={(e) => {
                  setSelectedDeviceId(e.target.value);
                  if (isRunning) { handleStop(); setTimeout(handleStartLocal, 300); }
                }}
                className="max-w-[160px] rounded-lg border border-[#1A1D27] bg-[#1A1D27] px-2 py-1.5 text-xs text-[#E8E9ED] outline-none focus:border-[#FF6B35]/50"
              >
                {videoDevices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>{d.label || `摄像头 ${videoDevices.indexOf(d) + 1}`}</option>
                ))}
              </select>
            </>
          )}

          <Separator orientation="vertical" className="h-6 bg-[#1A1D27]" />

          <Button
            onClick={isRunning ? handleStop : handleStart}
            disabled={isLoading || (source === 'local' && !modelReady) || (source === 'remote' && !rpiConnected && !isRunning)}
            className={isRunning ? 'bg-[#FF4757] hover:bg-[#FF4757]/80 text-white' : 'bg-[#FF6B35] hover:bg-[#FF6B35]/80 text-white'}
          >
            {isLoading ? (loadStage || '初始化中...') : isRunning ? '停止训练' : source === 'local' ? (modelReady ? '开始训练' : '加载模型...') : '开始接收'}
          </Button>

          <Separator orientation="vertical" className="h-6 bg-[#1A1D27]" />

          {/* 运动选择 */}
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
                        quality === 'error' ? 'bg-[#FF4757]/10 text-[#FF4757]'
                          : quality === 'warning' ? 'bg-[#FF6B35]/10 text-[#FF6B35]'
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
        <div className="grid grid-cols-3 gap-3 border-b border-[#1A1D27] px-5 py-4">
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
          <Card className="border-[#1A1D27] bg-[#1A1D27]/50">
            <CardContent className="p-3">
              <div className="text-xs text-[#8B8FA3]">训练时长</div>
              <div className="font-mono text-2xl font-bold text-[#E8E9ED]">{formatTime(trainingSeconds)}</div>
            </CardContent>
          </Card>
        </div>

        {/* 质量进度条 */}
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
                      <span className="font-mono text-[#8B8FA3]/50">
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

        {/* 语音控制 + 架构说明 */}
        <div className="border-t border-[#1A1D27] px-5 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleVoiceMode}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                voiceEnabled
                  ? 'bg-[#FF6B35] text-white shadow-[0_0_12px_rgba(255,107,53,0.3)]'
                  : 'bg-[#1A1D27] text-[#8B8FA3] hover:bg-[#252836] hover:text-[#E8E9ED]'
              }`}
            >
              {voiceEnabled ? '🎤 监听中(点击关闭)' : '🎤 语音控制(点击开启)'}
            </button>
            {voiceEnabled && (
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#FF6B35]" />
            )}
          </div>
          <div className="mt-2 text-[10px] text-[#8B8FA3]/50 leading-relaxed">
            {source === 'local'
              ? '架构: 浏览器 MediaPipe Pose → WebSocket → 云端 LLM 推理 → TTS 语音反馈'
              : '架构: RPi 摄像头 → WebSocket → 云端骨架检测 + LLM + TTS → 浏览器显示'}
          </div>
        </div>
      </div>
    </div>
  );
}
