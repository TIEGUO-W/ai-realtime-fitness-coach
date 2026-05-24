'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { WsMessage } from '@/lib/ws-client';

// ─── 常量 ────────────────────────────────────────────────
const EXERCISES = [
  { id: 'squat', label: '深蹲', icon: '🏋️' },
  { id: 'pushup', label: '俯卧撑', icon: '💪' },
  { id: 'lunge', label: '弓步蹲', icon: '🦵' },
  { id: 'plank', label: '平板支撑', icon: '🧘' },
  { id: 'jumpjack', label: '开合跳', icon: '⭐' },
  { id: 'highknee', label: '高抬腿', icon: '🏃' },
];

const DOUBAO_COACH_URL = 'https://320a02f4-5fad-4816-a1a8-37c1a4a92247.dev.coze.site/run';

// ─── 工具函数 ────────────────────────────────────────────
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// fetch + blob 播放音频（绕过跨域 autoplay 限制）
async function playAudioViaBlob(url: string): Promise<void> {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const audio = new Audio(blobUrl);
    audio.onended = () => URL.revokeObjectURL(blobUrl);
    await audio.play();
  } catch {
    // 降级：直接播放
    try { await new Audio(url).play(); } catch {}
  }
}

// ─── 组件 ────────────────────────────────────────────────
export default function PoseCoach() {
  // 状态
  const [selectedExercise, setSelectedExercise] = useState('squat');
  const [source, setSource] = useState<'local' | 'remote'>('local');
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadStage, setLoadStage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [modelReady, setModelReady] = useState(false);
  const [rpiConnected, setRpiConnected] = useState(false);
  const [repCount, setRepCount] = useState(0);
  const [quality, setQuality] = useState<'good' | 'warning' | 'error'>('good');
  const [currentFeedback, setCurrentFeedback] = useState<{ exercise: string; tips: string[]; encouragement: string; quality: string } | null>(null);
  const [feedbackHistory, setFeedbackHistory] = useState<Array<{ id: number; feedback: { exercise: string; tips: string[]; quality: string }; timestamp: number }>>([]);
  const [poseDetected, setPoseDetected] = useState(false);
  const [detectedExercise, setDetectedExercise] = useState('');
  const [effectFlash, setEffectFlash] = useState<string | null>(null);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceText, setVoiceText] = useState('');
  const [voiceMessages, setVoiceMessages] = useState<Array<{ role: 'user' | 'coach'; text: string }>>([]);
  const [trainingSeconds, setTrainingSeconds] = useState(0);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const poseDetectorRef = useRef<any>(null);
  const animFrameRef = useRef<number>(0);
  const feedbackIdRef = useRef(0);
  const lastLandmarksRef = useRef<any[]>([]);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceListeningRef = useRef(false);
  const trainingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 质量
  const qualityColor = { good: 'text-[#22D3A7]', warning: 'text-[#FF6B35]', error: 'text-[#FF4757]' }[quality];
  const qualityBg = { good: 'border-[#22D3A7]/30 bg-[#22D3A7]/10', warning: 'border-[#FF6B35]/30 bg-[#FF6B35]/10', error: 'border-[#FF4757]/30 bg-[#FF4757]/10' }[quality];
  const qualityLabel = { good: '动作标准', warning: '需要调整', error: '动作有误' }[quality];
  const qualityGrade = { good: 'A', warning: 'B', error: 'C' }[quality];
  const qualityPercent = { good: 90, warning: 60, error: 30 }[quality];

  function getSkeletonColor(q: string) {
    return q === 'good' ? '#22D3A7' : q === 'warning' ? '#FF6B35' : '#FF4757';
  }

  // ─── 训练计时器 ─────────────────────────────────────
  useEffect(() => {
    if (isRunning) {
      trainingTimerRef.current = setInterval(() => setTrainingSeconds(s => s + 1), 1000);
    } else if (trainingTimerRef.current) {
      clearInterval(trainingTimerRef.current);
    }
    return () => { if (trainingTimerRef.current) clearInterval(trainingTimerRef.current); };
  }, [isRunning]);

  // ─── WebSocket ──────────────────────────────────────
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const domain = process.env.NEXT_PUBLIC_PROJECT_DOMAIN || location.host;
    const ws = new WebSocket(`${protocol}//${domain}/ws/coaching`);
    ws.onopen = () => console.log('[WS] 已连接');
    ws.onclose = () => { wsRef.current = null; setTimeout(connectWs, 3000); };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      const msg: WsMessage = JSON.parse(e.data);
      switch (msg.type) {
        case 'algorithm_update': {
          const p = msg.payload as any;
          if (p.repCount !== undefined) setRepCount(p.repCount);
          if (p.quality) setQuality(p.quality);
          if (p.detectedExercise) setDetectedExercise(p.detectedExercise);
          if (p.poseDetected !== undefined) setPoseDetected(p.poseDetected);
          if (p.effect) {
            setEffectFlash(p.effect);
            setTimeout(() => setEffectFlash(null), 800);
          }
          if (p.landmarks) lastLandmarksRef.current = p.landmarks;
          break;
        }
        case 'coaching_feedback': {
          const fb = msg.payload as any;
          setCurrentFeedback(fb);
          const id = ++feedbackIdRef.current;
          setFeedbackHistory(h => [{ id, feedback: fb, timestamp: Date.now() }, ...h].slice(0, 20));
          break;
        }
        case 'tts_ready': {
          const p = msg.payload as any;
          if (p?.audioUrl) playAudioViaBlob(p.audioUrl);
          break;
        }
        case 'voice_recognized': {
          const p = msg.payload as any;
          if (p?.text) {
            setVoiceText(p.text);
            setVoiceMessages(m => [...m.slice(-8), { role: 'user', text: p.text }]);
          }
          break;
        }
        case 'voice_reply': {
          const p = msg.payload as any;
          if (p?.text) setVoiceMessages(m => [...m.slice(-8), { role: 'coach', text: p.text }]);
          break;
        }
        case 'voice_reply_tts': {
          const p = msg.payload as any;
          if (p?.audioUrl) playAudioViaBlob(p.audioUrl);
          break;
        }
        case 'rpi_status': {
          const p = msg.payload as any;
          if (p?.connected !== undefined) setRpiConnected(p.connected);
          break;
        }
        case 'pose_frame': {
          const p = msg.payload as any;
          if (p?.landmarks) lastLandmarksRef.current = p.landmarks;
          if (p?.poseDetected !== undefined) setPoseDetected(p.poseDetected);
          break;
        }
      }
    };
    wsRef.current = ws;
  }, []);

  useEffect(() => { connectWs(); return () => wsRef.current?.close(); }, [connectWs]);

  // ─── 骨架渲染 ───────────────────────────────────────
  useEffect(() => {
    if (!isRunning || source === 'remote') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      const v = videoRef.current;
      if (!v) return;
      canvas.width = v.videoWidth || 640;
      canvas.height = v.videoHeight || 480;
      ctx.drawImage(v, 0, 0);
      const lm = lastLandmarksRef.current;
      if (!lm?.length) return;
      const color = getSkeletonColor(quality);
      const connections = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      for (const [a, b] of connections) {
        if (lm[a] && lm[b] && (lm[a].visibility ?? 0) > 0.3 && (lm[b].visibility ?? 0) > 0.3) {
          ctx.beginPath();
          ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
          ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = color;
      for (let i = 11; i < Math.min(lm.length, 29); i++) {
        if ((lm[i].visibility ?? 0) > 0.3) {
          ctx.beginPath();
          ctx.arc(lm[i].x * canvas.width, lm[i].y * canvas.height, 4, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isRunning, source, quality]);

  // 远程模式渲染
  useEffect(() => {
    if (!isRunning || source !== 'remote') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      const lm = lastLandmarksRef.current;
      if (!lm?.length) return;
      canvas.width = 640;
      canvas.height = 480;
      ctx.fillStyle = '#0A0C12';
      ctx.fillRect(0, 0, 640, 480);
      const color = getSkeletonColor(quality);
      const connections = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28]];
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      for (const [a, b] of connections) {
        if (lm[a] && lm[b] && (lm[a].visibility ?? 0) > 0.3 && (lm[b].visibility ?? 0) > 0.3) {
          ctx.beginPath();
          ctx.moveTo(lm[a].x * 640, lm[a].y * 480);
          ctx.lineTo(lm[b].x * 640, lm[b].y * 480);
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = color;
      for (let i = 11; i < Math.min(lm.length, 29); i++) {
        if ((lm[i].visibility ?? 0) > 0.3) {
          ctx.beginPath();
          ctx.arc(lm[i].x * 640, lm[i].y * 480, 4, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    };
    draw();
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isRunning, source, quality]);

  // ─── MediaPipe 本地检测 ──────────────────────────────
  const loadMediaPipe = useCallback(async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      setLoadStage('加载 MediaPipe...');
      const vision = await import('@mediapipe/tasks-vision');
      const { PoseLandmarker, FilesetResolver } = vision;
      setLoadStage('初始化 WASM...');
      const visionWasm = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm');
      setLoadStage('加载骨架模型...');
      const poseLandmarker = await PoseLandmarker.createFromOptions(visionWasm, {
        baseOptions: {
          modelAssetPath: `/models/pose_landmarker_lite.task`,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
      poseDetectorRef.current = poseLandmarker;
      setModelReady(true);
      setLoadStage('');
    } catch (err: any) {
      setLoadError(err.message || '模型加载失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 摄像头
  const startCamera = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter(d => d.kind === 'videoinput');
      setVideoDevices(videos);
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      v.srcObject = stream;
      await v.play();
    } catch (err: any) {
      setLoadError('摄像头访问失败: ' + err.message);
    }
  }, [selectedDeviceId]);

  const handleStartLocal = useCallback(async () => {
    if (!modelReady) await loadMediaPipe();
    await startCamera();
    setIsRunning(true);
    setRepCount(0);
    setTrainingSeconds(0);
    const v = videoRef.current;
    const detect = () => {
      animFrameRef.current = requestAnimationFrame(detect);
      const detector = poseDetectorRef.current;
      if (!detector || !v || v.readyState < 2) return;
      try {
        const result = detector.detectForVideo(v, performance.now());
        const lm = result.landmarks?.[0];
        if (lm && lm.length >= 28 && wsRef.current?.readyState === WebSocket.OPEN) {
          const landmarks = lm.map((l: any) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility }));
          lastLandmarksRef.current = landmarks;
          wsRef.current.send(JSON.stringify({ type: 'pose_frame', payload: { landmarks, exercise: selectedExercise } }));
        }
      } catch {}
    };
    detect();
  }, [modelReady, loadMediaPipe, startCamera, selectedExercise]);

  const handleStartRemote = useCallback(() => {
    setIsRunning(true);
    setRepCount(0);
    setTrainingSeconds(0);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_exercise', payload: { exercise: selectedExercise } }));
    }
  }, [selectedExercise]);

  const handleStart = useCallback(() => {
    if (source === 'local') handleStartLocal();
    else handleStartRemote();
  }, [source, handleStartLocal, handleStartRemote]);

  const handleStop = useCallback(() => {
    setIsRunning(false);
    cancelAnimationFrame(animFrameRef.current);
    const v = videoRef.current;
    if (v?.srcObject) { (v.srcObject as MediaStream).getTracks().forEach(t => t.stop()); v.srcObject = null; }
  }, []);

  const handleSourceChange = useCallback((s: 'local' | 'remote') => {
    if (isRunning) handleStop();
    setSource(s);
  }, [isRunning, handleStop]);

  // ─── 语音交互 ────────────────────────────────────────
  const toggleVoiceMode = useCallback(() => {
    if (voiceEnabled) {
      // 关闭
      voiceListeningRef.current = false;
      setVoiceEnabled(false);
      if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} recognitionRef.current = null; }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') { mediaRecorderRef.current.stop(); }
      return;
    }
    // 开启
    voiceListeningRef.current = true;
    setVoiceEnabled(true);
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'zh-CN';
      rec.onresult = (e: any) => {
        const text = e.results[e.results.length - 1]?.[0]?.transcript;
        if (text && wsRef.current?.readyState === WebSocket.OPEN) {
          setVoiceText(text);
          wsRef.current.send(JSON.stringify({ type: 'voice_command', payload: { text } }));
        }
      };
      rec.onend = () => { if (voiceListeningRef.current) try { rec.start(); } catch {} };
      rec.onerror = () => {};
      rec.start();
      recognitionRef.current = rec;
    } else {
      // 降级：MediaRecorder + 后端 ASR
      navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        const recorder = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          if (!voiceListeningRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
          const blob = new Blob(chunks, { type: 'audio/webm' });
          chunks.length = 0;
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            if (base64 && wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'voice_command', payload: { audio: base64, format: 'webm' } }));
            }
          };
          reader.readAsDataURL(blob);
          if (voiceListeningRef.current) { try { recorder.start(); setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 3000); } catch {} }
        };
        recorder.start();
        setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 3000);
        mediaRecorderRef.current = recorder;
      }).catch(err => {
        console.error('麦克风访问失败:', err);
        setVoiceEnabled(false);
        voiceListeningRef.current = false;
      });
    }
  }, [voiceEnabled]);

  // ─── 模型预热 ────────────────────────────────────────
  useEffect(() => {
    if (source === 'local' && !modelReady) {
      loadMediaPipe();
    }
  }, [source, modelReady, loadMediaPipe]);

  // ─── 渲染 ─────────────────────────────────────────────
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0B0D14] text-[#E8E9ED]">
      {/* 左侧：视频区 */}
      <div className="flex flex-1 flex-col">
        <div className="relative flex-1 flex items-center justify-center bg-[#070810]">
          <video ref={videoRef} className="hidden" playsInline muted />
          <canvas ref={canvasRef} className="h-full w-full object-contain" />

          {/* 完成动作特效 */}
          {effectFlash && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="animate-bounce text-6xl font-black tracking-widest drop-shadow-2xl"
                style={{ color: effectFlash === 'perfect' ? '#FFD700' : effectFlash === 'excellent' ? '#22D3A7' : '#FF6B35', textShadow: `0 0 40px ${effectFlash === 'perfect' ? '#FFD70080' : effectFlash === 'excellent' ? '#22D3A780' : '#FF6B3580'}` }}>
                {effectFlash === 'perfect' ? 'PERFECT!' : effectFlash === 'excellent' ? 'EXCELLENT!' : 'GOOD!'}
              </div>
            </div>
          )}

          {/* 未运行遮罩 */}
          {!isRunning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#070810]/95 backdrop-blur-sm">
              <div className="text-7xl opacity-15">{source === 'local' ? '🏃' : '📡'}</div>
              {source === 'local' && loadStage ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#FF6B35] border-t-transparent" />
                    <p className="text-sm text-[#FF6B35]">{loadStage}</p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-[#8B8FA3]">
                  {isLoading ? '初始化中...' : source === 'local' ? (modelReady ? '就绪，点击开始' : '加载中...') : '等待树莓派...'}
                </p>
              )}
              {source === 'remote' && !rpiConnected && (
                <p className="text-xs text-[#FF4757]/70">树莓派未连接</p>
              )}
              {loadError && <p className="text-xs text-[#FF4757]">{loadError}</p>}
              {source === 'local' && modelReady && !isRunning && !isLoading && (
                <div className="mt-1 flex items-center gap-2 text-xs text-[#22D3A7]/60">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#22D3A7]" />
                  模型已就绪
                </div>
              )}
            </div>
          )}

          {/* 实时数据叠加 */}
          {isRunning && poseDetected && (
            <div className="absolute left-4 top-4 flex flex-col gap-2">
              <div className="flex items-center gap-2 rounded-xl bg-[#0B0D14]/80 px-3 py-2 backdrop-blur-md">
                <span className="text-3xl font-black tabular-nums text-[#FF6B35]" style={{ fontFeatureSettings: '"tnum"' }}>{repCount}</span>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#8B8FA3]">REPS</div>
                  <div className="text-xs font-medium">{detectedExercise || EXERCISES.find(e => e.id === selectedExercise)?.label}</div>
                </div>
              </div>
              <div className="rounded-lg bg-[#0B0D14]/60 px-3 py-1.5 font-mono text-xs tabular-nums text-[#8B8FA3] backdrop-blur-md">
                {formatTime(trainingSeconds)}
              </div>
            </div>
          )}

          {/* 质量指示 */}
          {isRunning && poseDetected && (
            <div className="absolute bottom-4 left-4">
              <div className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold backdrop-blur-md ${qualityBg}`}>
                <span className={`h-2.5 w-2.5 rounded-full animate-pulse ${quality === 'good' ? 'bg-[#22D3A7]' : quality === 'warning' ? 'bg-[#FF6B35]' : 'bg-[#FF4757]'}`} />
                {qualityLabel}
              </div>
            </div>
          )}

          {/* 模式标识 */}
          {isRunning && (
            <div className="absolute bottom-4 right-4">
              <Badge variant="outline" className="border-[#8B8FA3]/20 bg-[#0B0D14]/60 text-[10px] text-[#8B8FA3]/70 backdrop-blur-md">
                {source === 'local' ? '📷 本地' : '📡 远程'}
              </Badge>
            </div>
          )}

          {/* 语音识别文字 */}
          {voiceEnabled && voiceText && (
            <div className="absolute bottom-16 left-1/2 -translate-x-1/2">
              <div className="rounded-full bg-[#0B0D14]/90 px-5 py-2 text-sm text-[#E8E9ED] shadow-lg backdrop-blur-md">
                &ldquo;{voiceText}&rdquo;
              </div>
            </div>
          )}
        </div>

        {/* 底部控制栏 */}
        <div className="flex items-center gap-3 border-t border-[#1A1D27]/50 bg-[#0B0D14] px-5 py-3">
          {/* 模式切换 */}
          <div className="flex items-center rounded-xl bg-[#070810] p-1">
            <button onClick={() => handleSourceChange('local')}
              className={`rounded-lg px-4 py-2 text-xs font-medium transition-all ${source === 'local' ? 'bg-[#1A1D27] text-white shadow-sm' : 'text-[#8B8FA3] hover:text-white'}`}>
              本地
            </button>
            <button onClick={() => handleSourceChange('remote')}
              className={`rounded-lg px-4 py-2 text-xs font-medium transition-all ${source === 'remote' ? 'bg-[#1A1D27] text-white shadow-sm' : 'text-[#8B8FA3] hover:text-white'}`}>
              远程
            </button>
          </div>

          {/* 摄像头选择 */}
          {source === 'local' && videoDevices.length > 1 && (
            <select value={selectedDeviceId}
              onChange={(e) => { setSelectedDeviceId(e.target.value); if (isRunning) { handleStop(); setTimeout(handleStartLocal, 300); } }}
              className="max-w-[140px] rounded-lg border border-[#1A1D27] bg-[#1A1D27] px-2 py-2 text-xs text-[#E8E9ED] outline-none focus:border-[#FF6B35]/50">
              {videoDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || `摄像头 ${videoDevices.indexOf(d) + 1}`}</option>)}
            </select>
          )}

          <div className="mx-1 h-5 w-px bg-[#1A1D27]" />

          {/* 开始/停止 */}
          <Button onClick={isRunning ? handleStop : handleStart}
            disabled={isLoading || (source === 'local' && !modelReady) || (source === 'remote' && !rpiConnected && !isRunning)}
            className={`rounded-xl px-6 font-semibold ${isRunning ? 'bg-[#FF4757] hover:bg-[#FF4757]/80' : 'bg-[#FF6B35] hover:bg-[#FF6B35]/80'} text-white`}>
            {isLoading ? (loadStage || '初始化...') : isRunning ? '停止' : source === 'local' ? (modelReady ? '开始训练' : '加载模型...') : '开始接收'}
          </Button>

          <div className="mx-1 h-5 w-px bg-[#1A1D27]" />

          {/* 运动选择 */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {EXERCISES.map(ex => (
              <button key={ex.id} onClick={() => setSelectedExercise(ex.id)}
                className={`shrink-0 rounded-xl px-3 py-2 text-xs font-medium transition-all ${
                  selectedExercise === ex.id
                    ? 'bg-[#FF6B35] text-white shadow-[0_0_16px_rgba(255,107,53,0.25)]'
                    : 'bg-[#070810] text-[#8B8FA3] hover:bg-[#1A1D27] hover:text-white'
                }`}>
                {ex.icon} {ex.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 右侧：教练面板 */}
      <div className="flex w-[400px] shrink-0 flex-col border-l border-[#1A1D27]/30 bg-[#0D0F17]">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-[#1A1D27]/30 px-6 py-5">
          <div>
            <h2 className="text-lg font-bold tracking-tight">AI 运动教练</h2>
            <p className="text-xs text-[#8B8FA3]/70">实时骨架分析 · 豆包语音指导</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FF6B35]/20 to-[#FF6B35]/5 text-lg">🤖</div>
        </div>

        {/* 数据卡片 */}
        <div className="grid grid-cols-3 gap-3 border-b border-[#1A1D27]/30 px-6 py-4">
          <div className="rounded-xl bg-[#111320] p-3 text-center">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[#8B8FA3]">次数</div>
            <div className="mt-1 text-3xl font-black tabular-nums text-[#FF6B35]" style={{ fontFeatureSettings: '"tnum"' }}>{repCount}</div>
          </div>
          <div className="rounded-xl bg-[#111320] p-3 text-center">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[#8B8FA3]">评级</div>
            <div className={`mt-1 text-3xl font-black ${qualityColor}`}>{qualityGrade}</div>
          </div>
          <div className="rounded-xl bg-[#111320] p-3 text-center">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[#8B8FA3]">时长</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-[#E8E9ED] font-mono" style={{ fontFeatureSettings: '"tnum"' }}>{formatTime(trainingSeconds)}</div>
          </div>
        </div>

        {/* 质量进度条 */}
        <div className="px-6 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#8B8FA3]">动作质量</span>
            <span className={`font-semibold ${qualityColor}`}>{qualityPercent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#111320]">
            <div className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${qualityPercent}%`,
                background: quality === 'good' ? 'linear-gradient(90deg, #22D3A7, #22D3A780)' : quality === 'warning' ? 'linear-gradient(90deg, #FF6B35, #FF6B3580)' : 'linear-gradient(90deg, #FF4757, #FF475780)',
              }} />
          </div>
        </div>

        {/* 当前反馈 */}
        <div className="border-t border-[#1A1D27]/30 px-6 py-4">
          <div className="text-xs font-medium uppercase tracking-wider text-[#8B8FA3]/60 mb-3">实时指导</div>
          {currentFeedback ? (
            <div className="space-y-2">
              {currentFeedback.tips.map((tip, i) => (
                <div key={i} className={`flex items-start gap-2 rounded-xl px-4 py-2.5 text-sm ${
                  quality === 'error' ? 'bg-[#FF4757]/8 text-[#FF4757]'
                    : quality === 'warning' ? 'bg-[#FF6B35]/8 text-[#FF6B35]'
                    : 'bg-[#22D3A7]/8 text-[#22D3A7]'
                }`}>
                  <span className="mt-0.5 shrink-0 text-xs">{quality === 'good' ? '✓' : '⚠'}</span>
                  <span>{tip}</span>
                </div>
              ))}
              {currentFeedback.encouragement && (
                <div className="pt-1 text-center text-sm font-medium text-[#22D3A7]/80">
                  &ldquo;{currentFeedback.encouragement}&rdquo;
                </div>
              )}
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-[#8B8FA3]/40">
              {isRunning ? '正在分析...' : '开始训练后实时指导'}
            </div>
          )}
        </div>

        {/* 反馈历史 */}
        <div className="flex-1 min-h-0 border-t border-[#1A1D27]/30">
          <div className="px-6 py-2 text-[10px] font-medium uppercase tracking-wider text-[#8B8FA3]/40">历史记录</div>
          <ScrollArea className="h-full px-6">
            {feedbackHistory.length === 0 ? (
              <div className="py-6 text-center text-xs text-[#8B8FA3]/30">暂无记录</div>
            ) : (
              <div className="space-y-2 pb-4">
                {feedbackHistory.map(entry => (
                  <div key={entry.id} className="rounded-xl border border-[#1A1D27]/20 bg-[#111320]/50 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span style={{ color: getSkeletonColor(entry.feedback.quality) }}>{entry.feedback.exercise}</span>
                      <span className="font-mono text-[8px] text-[#8B8FA3]/30">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    </div>
                    {entry.feedback.tips[0] && <p className="mt-1 text-[#8B8FA3]/60">{entry.feedback.tips[0]}</p>}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* 语音控制 */}
        <div className="border-t border-[#1A1D27]/30 px-6 py-3">
          <button onClick={toggleVoiceMode}
            className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all ${
              voiceEnabled
                ? 'bg-gradient-to-r from-[#FF6B35] to-[#FF8C5A] text-white shadow-[0_0_20px_rgba(255,107,53,0.3)]'
                : 'bg-[#111320] text-[#8B8FA3] hover:bg-[#1A1D27] hover:text-white'
            }`}>
            {voiceEnabled ? (
              <><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" /></span> 语音监听中</>
            ) : (
              '🎤 开启语音控制'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
