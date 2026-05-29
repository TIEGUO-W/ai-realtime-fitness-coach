'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import LeftPanel from './LeftPanel';
import RightPanel, { EXERCISE_LABELS } from './RightPanel';
import CustomPlanModal from './CustomPlanModal';
import WorkoutSummaryModal from './WorkoutSummaryModal';
import type { DashboardData, CoachPersonality, CoachVoice, Workout, Biometrics, ChatMessage } from '@/types/dashboard';
import { mockData } from '@/data/mockData';

import { triggerHighScore, triggerLowScore, triggerWorkoutComplete } from '@/utils/confettiEffects';
import {
  createWsConnection,
  type WsMessage,
  type CoachingFeedback,
  type Landmark,
  type AlgorithmUpdatePayload,
  type TTSReadyPayload,
} from '@/lib/ws-client';

// ─── MediaPipe Pose connections ─────────────────────
const POSE_CONNECTIONS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [15, 17], [16, 18], [15, 19],
  [16, 20], [17, 19], [18, 20], [27, 29], [28, 30],
  [29, 31], [30, 32], [27, 31], [28, 32],
];

const MP_VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';

type SourceMode = 'local';

function getSkeletonColor(quality: 'good' | 'warning' | 'error'): string {
  switch (quality) {
    case 'good': return '#22D3A7';
    case 'warning': return '#FF6B35';
    case 'error': return '#FF4757';
  }
}

interface WorkoutSnapshot {
  workout: Workout;
  biometrics: Biometrics;
}

export default function Dashboard() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<unknown>(null);
  const wsRef = useRef<ReturnType<typeof createWsConnection> | null>(null);
  const sessionIdRef = useRef<string>('');
  const poseInstanceRef = useRef<unknown>(null);
  const remoteImgRef = useRef<HTMLImageElement | null>(null);

  const [personality, setPersonality] = useState<CoachPersonality>('gentle');
  const [voice, setVoice] = useState<CoachVoice>('female_soft');
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [snapshot, setSnapshot] = useState<WorkoutSnapshot | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const startTimeRef = useRef(Date.now());

  // PoseCoach state
  const [isRunning, setIsRunning] = useState(false);
  const [selectedExercise, setSelectedExercise] = useState('squat');
  const [wsConnected, setWsConnected] = useState(false);
  const [repCount, setRepCount] = useState(0);
  const [detectedExercise, setDetectedExercise] = useState('');
  const [realHeartRate, setRealHeartRate] = useState<number | null>(null);
  const healthDataRef = useRef<any>(null);
  const [quality, setQuality] = useState<'good' | 'warning' | 'error'>('warning');
  const [poseDetected, setPoseDetected] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [loadStage, setLoadStage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceMessages, setVoiceMessages] = useState<{ from: 'user' | 'coach'; text: string }[]>([]);
  const voiceListeningRef = useRef(false);
  const frameBufferRef = useRef<Landmark[][]>([]);
  const pendingVoiceRef = useRef<string[]>([]);
  const lastFrameSentRef = useRef<number>(0);

  // Dashboard data derived from WS state
  const [data, setData] = useState<DashboardData>(() => ({
    ...mockData,
    workout: { ...mockData.workout, currentAction: '深蹲', targetReps: 20 },
  }));

  // Speaking state for monster mouth animation
  // ─── TTS Playback Queue (Priority-aware) ──────────────
  const [isSpeaking, setIsSpeaking] = useState(false);
  const currentCoachMsgRef = useRef('');
  const audioQueueRef = useRef<Array<{ url: string; priority: 'high' | 'medium' | 'low' }>>([]);
  const isPlayingRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Strip URLs from coaching text (e.g. audio links from Doubao bot)
  const stripUrls = (text: string): string =>
    text.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim();

  // Interrupt current audio (for high priority)
  const stopCurrentAudio = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.onended = null;
      currentAudioRef.current.onerror = null;
      currentAudioRef.current = null;
    }
    isPlayingRef.current = false;
    setIsSpeaking(false);
  }, []);

  // Play next audio in queue (priority sorted)
  const playNextInQueue = useCallback(async () => {
    if (isPlayingRef.current) return;
    if (audioQueueRef.current.length === 0) {
      // TTS queue empty — flush any buffered voice commands
      flushPendingVoice();
      return;
    }

    // Sort by priority: high first
    audioQueueRef.current.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    });
    const next = audioQueueRef.current.shift();
    if (!next) return;

    console.log('[TTS] playNextInQueue, priority:', next.priority, 'url:', next.url.substring(0, 60));
    isPlayingRef.current = true;
    setIsSpeaking(true);
    try {
      const resp = await fetch(next.url);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const audio = new Audio(blobUrl);
      currentAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(blobUrl);
        currentAudioRef.current = null;
        isPlayingRef.current = false;
        setIsSpeaking(false);
        console.log('[TTS] audio onended, playing next if any');
        playNextInQueue();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        currentAudioRef.current = null;
        isPlayingRef.current = false;
        setIsSpeaking(false);
        console.log('[TTS] audio onerror');
        playNextInQueue();
      };
      await audio.play();
      console.log('[TTS] audio.play() started');
    } catch (err) {
      console.error('[TTS] playNextInQueue error:', err);
      // Mobile autoplay policy: if play() was denied, try unlocking and retry once
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        console.log('[TTS] Autoplay blocked, attempting unlock...');
        unlockMobileAudio();
        // Retry after a short delay
        const retryUrl = next.url;
        setTimeout(async () => {
          try {
            const resp2 = await fetch(retryUrl);
            const blob2 = await resp2.blob();
            const blobUrl2 = URL.createObjectURL(blob2);
            const audio2 = new Audio(blobUrl2);
            currentAudioRef.current = audio2;
            isPlayingRef.current = true;
            setIsSpeaking(true);
            audio2.onended = () => {
              URL.revokeObjectURL(blobUrl2);
              currentAudioRef.current = null;
              isPlayingRef.current = false;
              setIsSpeaking(false);
              playNextInQueue();
            };
            audio2.onerror = () => {
              URL.revokeObjectURL(blobUrl2);
              currentAudioRef.current = null;
              isPlayingRef.current = false;
              setIsSpeaking(false);
              playNextInQueue();
            };
            await audio2.play();
            console.log('[TTS] Retry audio.play() succeeded');
          } catch {
            currentAudioRef.current = null;
            isPlayingRef.current = false;
            setIsSpeaking(false);
            playNextInQueue();
          }
        }, 500);
        return;
      }
      currentAudioRef.current = null;
      isPlayingRef.current = false;
      setIsSpeaking(false);
      playNextInQueue();
    }
  }, []);

  // Flush buffered voice commands after TTS queue is empty
  const flushPendingVoice = useCallback(() => {
    // No longer buffering — voice commands are sent immediately
  }, []);

  // Enqueue audio URL with priority
  const enqueueAudio = useCallback((audioUrl: string, priority: 'high' | 'medium' | 'low' = 'medium') => {
    console.log('[TTS] enqueueAudio, priority:', priority, 'queue:', audioQueueRef.current.length, 'isPlaying:', isPlayingRef.current);
    if (priority === 'high' && isPlayingRef.current) {
      // High priority: interrupt current audio and play immediately
      stopCurrentAudio();
      audioQueueRef.current.unshift({ url: audioUrl, priority });
    } else {
      audioQueueRef.current.push({ url: audioUrl, priority });
    }
    if (!isPlayingRef.current) {
      playNextInQueue();
    }
  }, [playNextInQueue, stopCurrentAudio]);

  // ─── WS Message Handler ──────────────────────────────
  const handleWsMessage = useCallback((msg: WsMessage) => {
    switch (msg.type) {
      case 'connected': {
        setWsConnected(true);
        break;
      }
      case 'algorithm_update': {
        const p = msg.payload as AlgorithmUpdatePayload;
        setRepCount(p.repCount);
        setDetectedExercise(p.exercise);
        setQuality(p.quality);
        setData(prev => ({
          ...prev,
          workout: {
            ...prev.workout,
            currentAction: EXERCISE_LABELS[p.exercise] || p.exercise || prev.workout.currentAction,
            reps: Math.max(prev.workout.reps, p.repCount),
            isFormDeformed: p.quality === 'error',
            score: p.qualityScore ?? (p.quality === 'good' ? 90 : p.quality === 'warning' ? 70 : 40),
          },
        }));
        break;
      }
      case 'rep_completed': {
        const p = msg.payload as AlgorithmUpdatePayload;
        setData(prev => ({
          ...prev,
          workout: {
            ...prev.workout,
            reps: Math.max(prev.workout.reps, p.repCount),
            score: p.qualityScore ?? prev.workout.score,
          },
        }));
        break;
      }
      case 'coaching_feedback': {
        const fb = msg.payload as CoachingFeedback;
        setRepCount(fb.repCount);
        setDetectedExercise(fb.exercise);
        setQuality(fb.quality);
        const rawMsg = fb.encouragement || (fb.tips.length > 0 ? fb.tips[0] : '');
        const coachMsg = stripUrls(rawMsg);
        if (coachMsg) {
          lastCoachMsgTimeRef.current = Date.now();
          currentCoachMsgRef.current = coachMsg;
        }
        setData(prev => ({
          ...prev,
          workout: {
            ...prev.workout,
            currentAction: EXERCISE_LABELS[fb.exercise] || fb.exercise || prev.workout.currentAction,
            reps: Math.max(prev.workout.reps, fb.repCount),
            isFormDeformed: fb.quality === 'error',
            score: fb.qualityScore ?? prev.workout.score,
          },
          assistant: {
            message: coachMsg || prev.assistant.message,
            isAlert: fb.quality === 'error' || fb.quality === 'warning',
            modelId: prev.assistant.modelId,
          },
        }));
        if (coachMsg) {
          setChatMessages(prev => [...prev.slice(-19), { from: 'coach' as const, text: coachMsg, timestamp: Date.now() }]);
        }
        break;
      }
      case 'tts_ready': {
        const tts = msg.payload as TTSReadyPayload;
        console.log('[TTS] tts_ready received, audioUrl:', tts.audioUrl?.substring(0, 80));
        if (tts.audioUrl) {
          const priority = tts.priority || 'medium';
          enqueueAudio(tts.audioUrl, priority);
        }
        break;
      }
      case 'voice_command_result':
      case 'voice_reply': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = msg.payload as any;
        if (p.reply || p.text) {
          const replyText = stripUrls(p.reply || p.text);
          setVoiceMessages(prev => [...prev.slice(-9), { from: 'coach', text: replyText }]);
          setData(prev => ({
            ...prev,
            assistant: { ...prev.assistant, message: replyText },
          }));
          if (replyText) {
            setChatMessages(prev => [...prev.slice(-19), { from: 'coach' as const, text: replyText, timestamp: Date.now() }]);
          }
        }
        break;
      }
      case 'voice_recognized': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = msg.payload as any;
        if (p.text) {
          setVoiceMessages(prev => [...prev.slice(-9), { from: 'user', text: p.text }]);
          setChatMessages(prev => [...prev.slice(-19), { from: 'user' as const, text: p.text, timestamp: Date.now() }]);
        }
        break;
      }
      case 'voice_reply_tts': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = msg.payload as any;
        if (p.audioUrl) {
          enqueueAudio(p.audioUrl, 'high'); // voice replies are always high priority
        }
        break;
      }
      case 'heart_rate_update': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hrPayload = msg.payload as any;
        if (hrPayload.heartRate) {
          setRealHeartRate(hrPayload.heartRate);
        }
        break;
      }
    }
  }, [enqueueAudio]);

  // ─── Lock body scroll on dashboard ─────────────────────────────
  useEffect(() => {
    document.body.classList.add('home-dashboard');
    return () => { document.body.classList.remove('home-dashboard'); };
  }, []);

  // ─── Fetch health profile for AI plan modal ──────────────────
  useEffect(() => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const fetchHealth = async () => {
      try {
        const res = await fetch(`/api/health?sessionId=${encodeURIComponent(sid)}`);
        const data = await res.json();
        if (data.health) healthDataRef.current = data.health;
      } catch { /* ignore */ }
    };
    fetchHealth();
    const iv = setInterval(fetchHealth, 15000);
    return () => clearInterval(iv);
  }, []);

  // ─── Connect WS ──────────────────────────────────────
  useEffect(() => {
    const ws = createWsConnection({
      path: '/ws/coaching',
      onMessage: handleWsMessage,
      onOpen: () => {
        setWsConnected(true);
        setData(prev => ({
          ...prev,
          environment: { ...prev.environment, connectionStatus: 'connected' as const, aiActive: true },
        }));
      },
      onClose: () => {
        setWsConnected(false);
        setData(prev => ({
          ...prev,
          environment: { ...prev.environment, connectionStatus: 'disconnected' as const, aiActive: false },
        }));
      },
    });
    wsRef.current = ws;
    // Send health session ID so heart rate events are routed correctly
    const healthSid = localStorage.getItem('health_session_id');
    if (healthSid) {
      ws.send({ type: 'set_session', payload: { sessionId: healthSid } });
    }
    return () => { ws.close(); };
  }, [handleWsMessage]);

  // ─── MediaPipe Pose (local mode) ─────────────────────
  useEffect(() => {
    if (!isRunning) return;
    let cancelled = false;

    async function initMediaPipe() {
      setLoadStage('加载 MediaPipe WASM...');
      try {
        // Dynamic import for CDN
        const visionModule = await import('@mediapipe/tasks-vision');
        const { PoseLandmarker, FilesetResolver } = visionModule;

        setLoadStage('初始化 AI 模型...');
        const vision = await FilesetResolver.forVisionTasks(MP_VISION_CDN);
        const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });

        if (cancelled) { poseLandmarker.close(); return; }
        poseInstanceRef.current = poseLandmarker;
        setModelReady(true);
        setLoadStage('');
      } catch (err) {
        if (!cancelled) {
          setLoadError(`MediaPipe 加载失败: ${err}`);
          setLoadStage('');
        }
      }
    }

    async function startCamera() {
      setLoadStage('启动摄像头...');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
          cameraRef.current = stream;
        }
        await initMediaPipe();
      } catch (err) {
        if (!cancelled) {
          setLoadError(`摄像头启动失败: ${err}`);
          setLoadStage('');
        }
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      const stream = cameraRef.current as MediaStream | null;
      stream?.getTracks().forEach(t => t.stop());
      cameraRef.current = null;
      if (poseInstanceRef.current) {
        (poseInstanceRef.current as { close: () => void }).close();
        poseInstanceRef.current = null;
      }
      setModelReady(false);
      setPoseDetected(false);
    };
  }, [isRunning]);

  // ─── Pose detection loop ─────────────────────────────
  useEffect(() => {
    if (!isRunning || !modelReady) return;
    let rafId: number;
    let lastTimestamp = 0;

    function detect() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const poseLandmarker = poseInstanceRef.current as {
        detectForVideo: (el: HTMLVideoElement, ts: number) => { landmarks: { x: number; y: number; z: number; visibility?: number }[][] };
      } | null;

      if (!video || !canvas || !poseLandmarker || video.readyState < 2) {
        rafId = requestAnimationFrame(detect);
        return;
      }

      const now = performance.now();
      if (now - lastTimestamp < 33) { // ~30fps
        rafId = requestAnimationFrame(detect);
        return;
      }
      lastTimestamp = now;

      const result = poseLandmarker.detectForVideo(video, now);

      // Draw skeleton
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (result.landmarks && result.landmarks.length > 0) {
          setPoseDetected(true);
          const lm = result.landmarks[0];
          const color = getSkeletonColor(quality);

          // ── 外层光晕 ──
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.shadowColor = color;
          ctx.shadowBlur = 15;
          ctx.globalAlpha = 0.6;
          ctx.lineCap = 'round';
          for (const [i, j] of POSE_CONNECTIONS) {
            if (i < lm.length && j < lm.length) {
              ctx.beginPath();
              ctx.moveTo(lm[i].x * canvas.width, lm[i].y * canvas.height);
              ctx.lineTo(lm[j].x * canvas.width, lm[j].y * canvas.height);
              ctx.stroke();
            }
          }

          // ── 内层主线 ──
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1.5;
          ctx.shadowBlur = 6;
          for (const [i, j] of POSE_CONNECTIONS) {
            if (i < lm.length && j < lm.length) {
              ctx.beginPath();
              ctx.moveTo(lm[i].x * canvas.width, lm[i].y * canvas.height);
              ctx.lineTo(lm[j].x * canvas.width, lm[j].y * canvas.height);
              ctx.stroke();
            }
          }

          // ── 关节点：发光环 + 实心 + 高光 ──
          ctx.shadowBlur = 12;
          for (const point of lm) {
            const x = point.x * canvas.width, y = point.y * canvas.height;
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.3;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(x - 0.7, y - 0.7, 1.2, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.fill();
          }
          ctx.restore();

          // Send as pose_frame for real-time coaching + TTS
          const wsLandmarks: Landmark[] = lm.map((p: { x: number; y: number; z: number; visibility?: number }) => ({
            x: p.x, y: p.y, z: p.z, visibility: p.visibility ?? 1,
          }));

          // Throttle to ~10fps to match backend ALGORITHM_INTERVAL_MS
          const now = Date.now();
          if (!lastFrameSentRef.current || now - lastFrameSentRef.current >= 100) {
            lastFrameSentRef.current = now;
            wsRef.current?.send({
              type: 'pose_frame',
              payload: {
                landmarks: wsLandmarks,
                timestamp: now,
              },
            });
          }
        } else {
          setPoseDetected(false);
        }
      }

      rafId = requestAnimationFrame(detect);
    }

    rafId = requestAnimationFrame(detect);
    return () => cancelAnimationFrame(rafId);
  }, [isRunning, modelReady, quality, selectedExercise]);

  // ─── Voice interaction (MediaRecorder + Backend ASR) ─────
  // 使用 MediaRecorder 录音 → WS 发 base64 → 后端 ASRClient 识别
  // 不再依赖 Web Speech API（Google 被墙），国内直连可用
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmBufferRef = useRef<Int16Array[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Encode PCM samples to WAV (16-bit mono, 16000Hz)
  const encodeWAV = (samples: Int16Array, sampleRate: number): ArrayBuffer => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeStr = (offset: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);  // PCM
    view.setUint16(22, 1, true);  // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);  // block align
    view.setUint16(34, 16, true); // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) { view.setInt16(44 + i * 2, samples[i], true); }
    return buffer;
  };

  useEffect(() => {
    if (!voiceEnabled) {
      if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
      if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
      setVoiceListening(false);
      voiceListeningRef.current = false;
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      pcmBufferRef.current = [];
      return;
    }

    console.log('[Voice] Requesting microphone access...');
    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true } })
      .then(stream => {
        console.log('[Voice] Microphone access granted');
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        audioCtxRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e: AudioProcessingEvent) => {
          const float32 = e.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          pcmBufferRef.current.push(int16);
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
        setVoiceListening(true);
        voiceListeningRef.current = true;
        console.log('[Voice] AudioContext recording started, 16kHz mono PCM');

        recordingTimerRef.current = setInterval(() => {
          if (pcmBufferRef.current.length === 0) return;
          if (!wsRef.current) return;
          const chunks = [...pcmBufferRef.current];
          pcmBufferRef.current = [];
          const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
          const merged = new Int16Array(totalLen);
          let off = 0;
          for (const c of chunks) { merged.set(c, off); off += c.length; }
          const wavBuffer = encodeWAV(merged, 16000);
          const base64 = btoa(String.fromCharCode(...new Uint8Array(wavBuffer)));
          if (base64.length > 100) {
            console.log('[Voice] Sending WAV chunk to backend, size:', base64.length);
            wsRef.current?.send({ type: 'voice_command', payload: { base64Data: base64, sessionId: sessionIdRef.current } });
          }
        }, 3000);
      })
      .catch(err => {
        console.error('[Voice] Microphone access denied:', err);
        setVoiceListening(false);
        voiceListeningRef.current = false;
      });

    return () => {
      if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
      if (audioCtxRef.current) { audioCtxRef.current.close(); audioCtxRef.current = null; }
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      pcmBufferRef.current = [];
      setVoiceListening(false);
      voiceListeningRef.current = false;
    };
  }, [voiceEnabled]);


  // Heart rate comes from real Apple Health data via WS (heart_rate_update)
  // No simulated heart rate — if no real data, show "未连接"

  // ─── Coach personality: fallback only when backend is silent ───
  const lastCoachMsgTimeRef = useRef(Date.now());
  // Track last coaching message time for potential future use
  useEffect(() => {
    lastCoachMsgTimeRef.current = Date.now();
  }, [data.assistant.message]);

  // ─── Confetti triggers ───────────────────────────────
  const prevScoreRef = useRef(data.workout.score);
  const prevRepsRef = useRef(data.workout.reps);
  const completedRef = useRef(false);

  useEffect(() => {
    const prev = prevScoreRef.current;
    const curr = data.workout.score;
    prevScoreRef.current = curr;
    if (curr !== prev) {
      if (curr > 85) triggerHighScore();
      else if (curr < 60) triggerLowScore();
    }
  }, [data.workout.score]);

  useEffect(() => {
    const curr = data.workout.reps;
    const prev = prevRepsRef.current;
    prevRepsRef.current = curr;
    if (curr >= data.workout.targetReps && prev < data.workout.targetReps && !completedRef.current) {
      completedRef.current = true;
      setTimeout(() => {
        triggerWorkoutComplete();
        setTimeout(() => {
          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
          setDurationSeconds(elapsed);
          setSnapshot({ workout: { ...data.workout }, biometrics: { ...data.biometrics } });
          setSummaryModalOpen(true);
        }, 1200);
      }, 300);
    }
  }, [data.workout.reps, data.workout.targetReps, data]);

  // ─── Handlers ────────────────────────────────────────
  // ─── Mobile Audio Unlock ──────────────────────────────
  // Mobile browsers require a user gesture before audio can play.
  // We unlock on the first tap by playing a silent buffer.
  const audioUnlockedRef = useRef(false);
  const unlockMobileAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    try {
      const ctx = new AudioContext();
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      ctx.close();
      audioUnlockedRef.current = true;
      console.log('[Audio] Mobile audio unlocked');
    } catch { /* ignore */ }
  }, []);

  const handleStartWorkout = useCallback(() => {
    unlockMobileAudio();
    // Use health session ID from localStorage so Apple Health data matches
    const healthSid = typeof window !== 'undefined' ? localStorage.getItem('health_session_id') : null;
    sessionIdRef.current = healthSid || `session_${Date.now()}`;
    startTimeRef.current = Date.now();
    completedRef.current = false;
    setRepCount(0);
    setIsRunning(true);
    setData(prev => ({
      ...prev,
      workout: { ...prev.workout, reps: 0 },
    }));
    wsRef.current?.send({
      type: 'set_session',
      payload: { sessionId: sessionIdRef.current },
    });
    wsRef.current?.send({
      type: 'set_exercise',
      payload: { exercise: selectedExercise },
    });
  }, [selectedExercise]);

  const handleEndWorkout = useCallback(() => {
    setIsRunning(false);
    triggerWorkoutComplete();
    setTimeout(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setDurationSeconds(elapsed);
      setSnapshot({ workout: { ...data.workout }, biometrics: { ...data.biometrics } });
      setSummaryModalOpen(true);
    }, 600);
  }, [data]);

  const handleCloseSummary = useCallback(() => {
    setSummaryModalOpen(false);
  }, []);

  const environment = {
    temp: 26,
    aiActive: wsConnected,
    connectionStatus: wsConnected ? 'connected' as const : 'disconnected' as const,
  };

  return (
    <div className="flex h-screen w-full bg-cyber-dark scanlines overflow-hidden">
      {/* LEFT: AI Coach Panel */}
      <div className="w-[320px] flex-shrink-0 flex flex-col border-r border-white/[0.03]">
        <LeftPanel
          data={{ ...data, biometrics: { ...data.biometrics, heartRate: realHeartRate ?? data.biometrics.heartRate } }}
          personality={personality}
          voice={voice}
          onPersonalityChange={setPersonality}
          onVoiceChange={setVoice}
          isSpeaking={isSpeaking}
          coachMessage={currentCoachMsgRef.current}
          chatMessages={chatMessages}
        />
      </div>

      {/* RIGHT: Data + Camera */}
      <div className="flex-1 flex flex-col min-w-0">
        <RightPanel
          workout={data.workout}
          biometrics={{ ...data.biometrics, heartRate: realHeartRate ?? 0 }}
          environment={environment}
          connectionError={loadError || undefined}
          onOpenPlanModal={() => setPlanModalOpen(true)}
          onEndWorkout={handleEndWorkout}
          onStartWorkout={handleStartWorkout}
          isRunning={isRunning}
          videoRef={videoRef}
          canvasRef={canvasRef}
          selectedExercise={selectedExercise}
          onExerciseChange={setSelectedExercise}
          voiceEnabled={voiceEnabled}
          voiceListening={voiceListening}
          onVoiceToggle={() => setVoiceEnabled(v => !v)}
          poseDetected={poseDetected}
          modelReady={modelReady}
          loadStage={loadStage}
        />
      </div>

      <CustomPlanModal
        open={planModalOpen}
        onClose={() => setPlanModalOpen(false)}
        personality={personality}
        healthData={healthDataRef.current}
        currentHR={realHeartRate ?? 0}
        currentExercise={selectedExercise}
      />
      {snapshot && (
        <WorkoutSummaryModal
          open={summaryModalOpen}
          onClose={handleCloseSummary}
          workout={snapshot.workout}
          biometrics={snapshot.biometrics}
          personality={personality}
          durationSeconds={durationSeconds}
        />
      )}
    </div>
  );
}
