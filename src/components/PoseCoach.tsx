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

// ─── MediaPipe Tasks Vision CDN URL ─────────────
const MP_VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';

export default function PoseCoach() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<unknown>(null);
  const wsRef = useRef<ReturnType<typeof createWsConnection> | null>(null);
  const frameBufferRef = useRef<Landmark[][]>([]); // 仅远程模式使用
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
  const [loadStage, setLoadStage] = useState('');
  const [remoteFps, setRemoteFps] = useState(0);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [modelReady, setModelReady] = useState(false);
  const [effectFlash, setEffectFlash] = useState<'perfect' | 'excellent' | 'good' | 'adjust' | 'warning' | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceMessages, setVoiceMessages] = useState<Array<{ role: 'user' | 'coach'; text: string }>>([]);

  // ─── 模型预热：页面加载后自动初始化 MediaPipe，常驻内存 ───
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poseWarmRef = useRef<any>(null);  // 常驻 PoseLandmarker 实例
  const warmUpRef = useRef(false);

  useEffect(() => {
    if (source !== 'local' || warmUpRef.current) return;
    warmUpRef.current = true;

    setLoadStage('加载骨架检测引擎...');

    (async () => {
      try {
        // 动态导入 @mediapipe/tasks-vision（浏览器端用 ES module）
        const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');

        setLoadStage('初始化 WASM 运行时...');
        const vision = await FilesetResolver.forVisionTasks(MP_VISION_CDN);

        setLoadStage('加载本地骨架模型（~3MB）...');
        poseWarmRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            // 模型本地托管在 /public/models/，同源秒加载
            modelAssetPath: '/models/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });

        setModelReady(true);
        setLoadStage('');
      } catch (err) {
        console.error('模型预热失败:', err);
        setLoadStage('模型预热失败，点击开始将重试');
        warmUpRef.current = false;
      }
    })();
  }, [source]);

  // 枚举摄像头设备
  useEffect(() => {
    const enumerate = async () => {
      try {
        // 先请求一次权限，否则 label 为空
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach(t => t.stop());

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(d => d.kind === 'videoinput');
        setVideoDevices(videoInputs);
        if (videoInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      } catch {
        // 权限被拒绝时静默处理
      }
    };
    if (source === 'local') enumerate();
  }, [source]);

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
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = '';
        }
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audio.play().catch((err) => {
          console.warn('[TTS] speakText 播放失败:', err?.name || err);
        });
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

    // 实时算法更新（规则算法毫秒级推送，零延迟计数/阶段/质量）
    if (msg.type === 'algorithm_update') {
      const payload = msg.payload as {
        exercise: string;
        stage: string;
        repCount: number;
        quality: 'good' | 'warning' | 'error';
        effect: 'perfect' | 'excellent' | 'good' | null;
        kneeAngle: number | null;
        hipAngle: number | null;
      };
      setDetectedExercise(payload.exercise);
      setRepCount(payload.repCount);
      setQuality(payload.quality);
      // 更新实时角度显示等
      return;
    }

    // 完成一次动作（触发特效）
    if (msg.type === 'rep_completed') {
      const payload = msg.payload as {
        repCount: number;
        effect: 'perfect' | 'excellent' | 'good' | null;
        quality: number;
      };
      setRepCount(payload.repCount);
      if (payload.effect) {
        setEffectFlash(payload.effect);
        setTimeout(() => setEffectFlash(null), 1500);
      }
      return;
    }

    // 教练反馈（LLM 话术，~3秒一次）
    if (msg.type === 'coaching_feedback') {
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

      if (feedback.effect) {
        setEffectFlash(feedback.effect);
        setTimeout(() => setEffectFlash(null), 1500);
      }
    }

    // TTS 语音播放
    if (msg.type === 'tts_ready') {
      const audioUrl = (msg.payload as { audioUrl?: string })?.audioUrl;
      if (audioUrl) {
        if (audioRef.current) audioRef.current.pause();
        audioRef.current = new Audio(audioUrl);
        audioRef.current.play().catch(() => {});
      }
    }

    // 语音识别结果
    if (msg.type === 'voice_recognized') {
      const payload = msg.payload as { text: string };
      setVoiceMessages(prev => [...prev.slice(-20), { role: 'user', text: payload.text }]);
    }

    // 语音命令回复
    if (msg.type === 'voice_reply') {
      const payload = msg.payload as { text: string; audioUrl: string | null };
      setVoiceMessages(prev => [...prev.slice(-20), { role: 'coach', text: payload.text }]);
    }

    // 语音回复 TTS
    if (msg.type === 'voice_reply_tts') {
      const payload = msg.payload as { audioUrl: string; text: string };
      if (payload.audioUrl) {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = '';
        }
        const audio = new Audio(payload.audioUrl);
        audioRef.current = audio;
        audio.play().catch((err) => {
          console.warn('[TTS] 播放失败:', err?.name || err);
        });
      }
    }

    // 语音切换运动
    if (msg.type === 'set_exercise') {
      const payload = msg.payload as { exercise: string };
      if (payload.exercise) {
        setSelectedExercise(payload.exercise as ExerciseId);
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

  // 发送单帧骨架（本地模式 → 规则算法每帧处理）
  const sendPoseFrame = useCallback((landmarks: Landmark[]) => {
    if (!wsRef.current) return;
    wsRef.current.send({
      type: 'pose_frame',
      payload: {
        landmarks,
        timestamp: Date.now(),
      },
    });
  }, []);

  // 定时发送运动类型（本地模式切换时通知服务端）
  useEffect(() => {
    if (!wsRef.current || source !== 'local') return;
    wsRef.current.send({
      type: 'set_exercise',
      payload: { exercise: selectedExercise === 'auto' ? 'squat' : selectedExercise },
    });
  }, [selectedExercise, source]);

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

  // 本地模式启动（复用常驻 Pose 实例）
  const handleStartLocal = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const video = videoRef.current;
      if (!video) return;

      // 复用常驻 PoseLandmarker
      const landmarker = poseWarmRef.current;
      if (!landmarker) {
        setLoadError('模型未就绪，请稍候重试');
        return;
      }

      // 打开摄像头
      const constraints: MediaStreamConstraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : {}),
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();

      poseInstanceRef.current = landmarker;
      setIsRunning(true);
      setRepCount(0);
      setFeedbackHistory([]);
      setCurrentFeedback(null);
      setLoadStage('');

      // 帧循环：requestAnimationFrame + detectForVideo
      let lastTime = -1;
      const processFrame = () => {
        if (!videoRef.current || videoRef.current.paused) return;
        const now = performance.now();
        if (now === lastTime) {
          requestAnimationFrame(processFrame);
          return;
        }

        const result = landmarker.detectForVideo(video, now);
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (canvas && ctx) {
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 480;

          ctx.save();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          ctx.restore();

          if (result.landmarks && result.landmarks.length > 0) {
            setPoseDetected(true);
            const lm = result.landmarks[0];
            const mirroredLandmarks = lm.map((p: { x: number; y: number; z: number; visibility?: number }) => ({
              x: 1 - p.x,
              y: p.y,
              z: p.z,
              visibility: p.visibility ?? 0,
            }));
            drawSkeleton(ctx, mirroredLandmarks, canvas.width, canvas.height, quality);

            const frame: Landmark[] = lm.map((p: { x: number; y: number; z: number; visibility?: number }) => ({
              x: p.x,
              y: p.y,
              z: p.z,
              visibility: p.visibility ?? 0,
            }));
            // 每帧直接发送到服务端（规则算法实时处理）
            sendPoseFrame(frame);
          } else {
            setPoseDetected(false);
          }
        }

        lastTime = now;
        requestAnimationFrame(processFrame);
      };
      requestAnimationFrame(processFrame);

      // 保存摄像头流以便停止时关闭
      cameraRef.current = stream;
    } catch (err) {
      console.error('启动失败:', err);
      setLoadError(err instanceof Error ? err.message : '未知错误');
      setLoadStage('');
    } finally {
      setIsLoading(false);
    }
  }, [drawSkeleton, quality, selectedDeviceId]);

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
    // 只停止摄像头流，PoseLandmarker 实例常驻内存，下次启动秒开
    const stream = cameraRef.current as MediaStream | null;
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
    cameraRef.current = null;
    poseInstanceRef.current = null;
    // 清除 canvas
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    setIsRunning(false);
    setPoseDetected(false);
    frameBufferRef.current = [];
  }, []);

  // 切换模式时停止
  const handleSourceChange = useCallback((newSource: SourceMode) => {
    if (isRunning) handleStop();
    setSource(newSource);
  }, [isRunning, handleStop]);

  // ===== 语音交互（开关模式 + Web Speech API 持续监听）=====
  const recognitionRef = useRef<any>(null);

  const toggleVoiceMode = useCallback(() => {
    if (isRecording) {
      // 关闭语音模式
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    // 开启语音模式
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('浏览器不支持 Web Speech API，请使用 Chrome');
      // 降级：用 MediaRecorder + 后端 ASR
      startRecordingFallback();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        const text = last[0].transcript.trim();
        if (text && wsRef.current) {
          wsRef.current.send({
            type: 'voice_command',
            payload: { text },
          });
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.error('语音识别错误:', event.error);
      if (event.error === 'not-allowed') {
        setIsRecording(false);
      }
    };

    recognition.onend = () => {
      // 持续模式：如果还在录音状态，自动重启
      if (isRecording && recognitionRef.current) {
        try { recognition.start(); } catch (_) { /* 忽略重复启动 */ }
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }, [isRecording]);

  // 降级方案：MediaRecorder + 后端 ASR
  const startRecordingFallback = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          if (base64 && wsRef.current) {
            wsRef.current.send({
              type: 'voice_command',
              payload: { base64Data: base64 },
            });
          }
        };
        reader.readAsDataURL(blob);
        setIsRecording(false);
      };

      recorder.start();
      setIsRecording(true);
      // 3秒自动发送
      setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 3000);
    } catch (err) {
      console.error('麦克风访问失败:', err);
      setIsRecording(false);
    }
  }, []);

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

          {/* 完成动作特效 */}
          {effectFlash && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className="animate-bounce text-5xl font-black tracking-wider"
                style={{
                  color: effectFlash === 'perfect' ? '#FFD700'
                    : effectFlash === 'excellent' ? '#22D3A7'
                    : '#FF6B35',
                  textShadow: `0 0 30px ${
                    effectFlash === 'perfect' ? '#FFD70080'
                    : effectFlash === 'excellent' ? '#22D3A780'
                    : '#FF6B3580'
                  }`,
                }}
              >
                {effectFlash === 'perfect' ? 'PERFECT!' : effectFlash === 'excellent' ? 'EXCELLENT!' : 'GOOD!'}
              </div>
            </div>
          )}

          {!isRunning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0A0C12]">
              <div className="text-6xl opacity-20">
                {source === 'local' ? '🏃' : '📡'}
              </div>
              {source === 'local' && loadStage ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#FF6B35] border-t-transparent" />
                    <p className="text-[#FF6B35] text-sm">{loadStage}</p>
                  </div>
                  {loadStage.includes('模型') && (
                    <p className="text-[#8B8FA3]/50 text-xs">首次加载需下载 ~5MB 模型文件，后续常驻内存</p>
                  )}
                </>
              ) : (
                <p className="text-[#8B8FA3] text-sm">
                  {isLoading ? '正在初始化...' : source === 'local' ? (modelReady ? '模型已就绪，点击开始训练' : '等待模型加载...') : '等待树莓派视频流...'}
                </p>
              )}
              {source === 'remote' && !rpiConnected && (
                <p className="text-[#FF4757]/70 text-xs">树莓派未连接 — 请先运行 rpi_client.py</p>
              )}
              {loadError && <p className="text-[#FF4757] text-xs">{loadError}</p>}
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
              <Badge variant="outline" className="border-[#FF6B35]/40 text-[#FF6B35] text-xs animate-pulse">
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#FF6B35]" />
                {loadStage.includes('模型') ? '下载模型中' : '加载中'}
              </Badge>
            )}
            {source === 'local' && modelReady && !isRunning && (
              <Badge variant="outline" className="border-[#22D3A7]/40 text-[#22D3A7] text-xs">
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
              本地
            </button>
            <button
              onClick={() => handleSourceChange('remote')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                source === 'remote'
                  ? 'bg-[#1A1D27] text-[#E8E9ED] shadow-sm'
                  : 'text-[#8B8FA3] hover:text-[#E8E9ED]'
              }`}
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
                  if (isRunning) {
                    handleStop();
                    setTimeout(handleStartLocal, 300);
                  }
                }}
                className="max-w-[160px] rounded-lg border border-[#1A1D27] bg-[#1A1D27] px-2 py-1.5 text-xs text-[#E8E9ED] outline-none focus:border-[#FF6B35]/50"
              >
                {videoDevices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `摄像头 ${videoDevices.indexOf(d) + 1}`}
                  </option>
                ))}
              </select>
            </>
          )}

          <Separator orientation="vertical" className="h-6 bg-[#1A1D27]" />

          <Button
            onClick={isRunning ? handleStop : handleStart}
            disabled={isLoading || (source === 'local' && !modelReady) || (source === 'remote' && !rpiConnected && !isRunning)}
            className={isRunning
              ? 'bg-[#FF4757] hover:bg-[#FF4757]/80 text-white'
              : 'bg-[#FF6B35] hover:bg-[#FF6B35]/80 text-white'}
          >
            {isLoading ? (loadStage || '初始化中...') : isRunning ? '停止训练' : source === 'local' ? (modelReady ? '开始训练' : '加载模型...') : '开始接收'}
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

        {/* 语音交互区 */}
        <div className="border-t border-[#1A1D27] px-5 py-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-[#8B8FA3]">语音交互</span>
            <span className="text-[10px] text-[#8B8FA3]/50">按住说话，松开发送</span>
          </div>
          {/* 对话气泡 */}
          <div className="max-h-[120px] overflow-y-auto space-y-1.5 mb-2">
            {voiceMessages.length === 0 ? (
              <div className="text-center text-[10px] text-[#8B8FA3]/40 py-2">试试说"换深蹲""做了多少个"</div>
            ) : (
              voiceMessages.slice(-6).map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs ${
                    m.role === 'user'
                      ? 'bg-[#FF6B35]/20 text-[#FF6B35]'
                      : 'bg-[#1A1D27] text-[#E8E9ED]'
                  }`}>
                    {m.text}
                  </div>
                </div>
              ))
            )}
          </div>
          {/* 语音开关 */}
          <button
            onClick={toggleVoiceMode}
            className={`w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all ${
              isRecording
                ? 'bg-[#FF6B35] text-white shadow-[0_0_20px_rgba(255,107,53,0.4)]'
                : 'bg-[#1A1D27] text-[#8B8FA3] hover:bg-[#252836] hover:text-[#E8E9ED]'
            }`}
          >
            <span className={`text-base ${isRecording ? 'animate-pulse' : ''}`}>
              {isRecording ? '🟠' : '🎤'}
            </span>
            {isRecording ? '语音监听中（点击关闭）' : '语音控制（点击开启）'}
          </button>
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
