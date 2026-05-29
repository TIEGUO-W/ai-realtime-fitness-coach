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
      currentAudioRef.current = null;
      isPlayingRef.current = false;
      setIsSpeaking(false);
      playNextInQueue();
    }
  }, []);

  // Flush buffered voice commands after TTS queue is empty
  const flushPendingVoice = useCallback(() => {
    if (pendingVoiceRef.current.length === 0) return;
    const commands = [...pendingVoiceRef.current];
    pendingVoiceRef.current = [];
    console.log('[Voice] Flushing buffered commands:', commands.length);
    for (const text of commands) {
      wsRef.current?.send({
        type: 'voice_command',
        payload: { text, sessionId: sessionIdRef.current },
      });
    }
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
    }
  }, [enqueueAudio]);

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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!voiceEnabled) {
      // Stop recording
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      }
      mediaRecorderRef.current = null;
      setVoiceListening(false);
      voiceListeningRef.current = false;
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      return;
    }

    // Request microphone and start recording
    console.log('[Voice] Requesting microphone access...');
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        console.log('[Voice] Microphone access granted');
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];

        recorder.ondataavailable = (e: BlobEvent) => {
          if (e.data.size > 0) {
            audioChunksRef.current.push(e.data);
          }
        };

        recorder.onerror = (e: Event) => {
          console.error('[Voice] MediaRecorder error:', e);
        };

        // Start recording in 3-second chunks
        recorder.start(3000); // ondataavailable fires every 3s
        setVoiceListening(true);
        voiceListeningRef.current = true;
        console.log('[Voice] MediaRecorder started, capturing 3s chunks');

        // Every 3 seconds, send accumulated audio to backend for ASR
        recordingTimerRef.current = setInterval(() => {
          if (audioChunksRef.current.length === 0) return;
          if (!wsRef.current) return;

          const chunks = [...audioChunksRef.current];
          audioChunksRef.current = [];

          // Convert to base64
          const blob = new Blob(chunks, { type: 'audio/webm;codecs=opus' });
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1]; // Remove "data:audio/webm;base64," prefix
            if (base64 && base64.length > 100) { // Ignore near-empty chunks
              console.log('[Voice] Sending audio chunk to backend, size:', base64.length, '| TTS playing:', isPlayingRef.current);
              wsRef.current?.send({
                type: 'voice_command',
                payload: { base64Data: base64, sessionId: sessionIdRef.current },
              });
            }
          };
          reader.readAsDataURL(blob);
        }, 3000);
      })
      .catch(err => {
        console.error('[Voice] Microphone access denied:', err);
        setVoiceListening(false);
        voiceListeningRef.current = false;
      });

    return () => {
      if (mediaRecorderRef.current) {
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
        // Stop all tracks
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
        mediaRecorderRef.current = null;
      }
      if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
      audioChunksRef.current = [];
      setVoiceListening(false);
      voiceListeningRef.current = false;
    };
  }, [voiceEnabled]);

  // ─── Simulated heart rate (until real HR available) ───
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      setData(prev => {
        const baseHR = 75 + (isRunning ? 60 : 0);
        const variance = Math.floor(Math.random() * 20) - 10;
        return {
          ...prev,
          biometrics: {
            ...prev.biometrics,
            heartRate: Math.max(60, Math.min(190, baseHR + variance + repCount)),
          },
        };
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [isRunning, repCount]);

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
  const handleStartWorkout = useCallback(() => {
    sessionIdRef.current = `session_${Date.now()}`;
    startTimeRef.current = Date.now();
    completedRef.current = false;
    setRepCount(0);
    setIsRunning(true);
    setData(prev => ({
      ...prev,
      workout: { ...prev.workout, reps: 0 },
    }));
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
      {/* LEFT: AI Coach (1/4) */}
      <div className="w-1/4 flex-shrink-0 flex flex-col">
        <LeftPanel
          data={data}
          personality={personality}
          voice={voice}
          onPersonalityChange={setPersonality}
          onVoiceChange={setVoice}
          isSpeaking={isSpeaking}
          coachMessage={currentCoachMsgRef.current}
          chatMessages={chatMessages}
        />
      </div>

      {/* CYAN DIVIDER */}
      <div className="w-px flex-shrink-0 bg-gradient-to-b from-transparent via-cyber-cyan/40 to-transparent shadow-[0_0_6px_rgba(0,229,255,0.15)]" />

      {/* RIGHT: Data + Camera (3/4) */}
      <div className="flex-1 flex flex-col min-w-0">
        <RightPanel
          workout={data.workout}
          biometrics={data.biometrics}
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
