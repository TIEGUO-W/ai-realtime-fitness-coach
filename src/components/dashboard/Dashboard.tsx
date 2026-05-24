'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import LeftPanel from './LeftPanel';
import RightPanel, { EXERCISE_LABELS } from './RightPanel';
import CustomPlanModal from './CustomPlanModal';
import WorkoutSummaryModal from './WorkoutSummaryModal';
import type { DashboardData, CoachPersonality, CoachVoice, Workout, Biometrics } from '@/types/dashboard';
import { mockData } from '@/data/mockData';
import { getCoachMessage } from '@/utils/coachVoice';
import { triggerHighScore, triggerLowScore, triggerWorkoutComplete } from '@/utils/confettiEffects';
import {
  createWsConnection,
  type WsMessage,
  type CoachingFeedback,
  type Landmark,
  type AlgorithmUpdatePayload,
  type TTSReadyPayload,
  type RemoteFramePayload,
  type RpiStatusPayload,
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

type SourceMode = 'local' | 'remote';

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
  const [snapshot, setSnapshot] = useState<WorkoutSnapshot | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const startTimeRef = useRef(Date.now());

  // PoseCoach state
  const [source, setSource] = useState<SourceMode>('local');
  const [isRunning, setIsRunning] = useState(false);
  const [selectedExercise, setSelectedExercise] = useState('auto');
  const [wsConnected, setWsConnected] = useState(false);
  const [repCount, setRepCount] = useState(0);
  const [detectedExercise, setDetectedExercise] = useState('');
  const [quality, setQuality] = useState<'good' | 'warning' | 'error'>('warning');
  const [poseDetected, setPoseDetected] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [loadStage, setLoadStage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [remoteFps, setRemoteFps] = useState(0);
  const [remoteImageUrl, setRemoteImageUrl] = useState('');
  const [rpiConnected, setRpiConnected] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceMessages, setVoiceMessages] = useState<{ from: 'user' | 'coach'; text: string }[]>([]);
  const voiceListeningRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const frameBufferRef = useRef<Landmark[][]>([]);
  const lastFrameSentRef = useRef<number>(0);

  // Dashboard data derived from WS state
  const [data, setData] = useState<DashboardData>(() => ({
    ...mockData,
    workout: { ...mockData.workout, currentAction: '深蹲', targetReps: 20 },
  }));

  // Speaking state for monster mouth animation
  // ─── TTS Playback Queue ────────────────────────────
  const [isSpeaking, setIsSpeaking] = useState(false);
  const currentCoachMsgRef = useRef('');
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);

  // Strip URLs from coaching text (e.g. audio links from Doubao bot)
  const stripUrls = (text: string): string =>
    text.replace(/https?:\/\/\S+/g, '').replace(/\s{2,}/g, ' ').trim();

  // Play next audio in queue
  const playNextInQueue = useCallback(async () => {
    if (isPlayingRef.current) return;
    const nextUrl = audioQueueRef.current.shift();
    if (!nextUrl) return;

    isPlayingRef.current = true;
    setIsSpeaking(true);
    try {
      const resp = await fetch(nextUrl);
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const audio = new Audio(blobUrl);
      audio.onended = () => {
        URL.revokeObjectURL(blobUrl);
        isPlayingRef.current = false;
        setIsSpeaking(false);
        playNextInQueue(); // play next in queue
      };
      audio.onerror = () => {
        isPlayingRef.current = false;
        setIsSpeaking(false);
        playNextInQueue(); // continue queue on error
      };
      await audio.play();
    } catch {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      playNextInQueue(); // continue queue on error
    }
  }, []);

  // Enqueue audio URL for sequential playback
  const enqueueAudio = useCallback((audioUrl: string) => {
    audioQueueRef.current.push(audioUrl);
    if (!isPlayingRef.current) {
      playNextInQueue();
    }
  }, [playNextInQueue]);

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = msg.payload as { repCount: number; effect: unknown; quality: number };
        setData(prev => ({
          ...prev,
          workout: {
            ...prev.workout,
            reps: Math.max(prev.workout.reps, p.repCount),
            score: p.quality ?? prev.workout.score,
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
            score: prev.workout.score,
          },
          assistant: {
            message: coachMsg || prev.assistant.message,
            isAlert: fb.quality === 'error' || fb.quality === 'warning',
            modelId: prev.assistant.modelId,
          },
        }));
        break;
      }
      case 'tts_ready': {
        const tts = msg.payload as TTSReadyPayload;
        enqueueAudio(tts.audioUrl);
        break;
      }
      case 'remote_frame': {
        const frame = msg.payload as RemoteFramePayload;
        setRemoteImageUrl(`data:image/jpeg;base64,${frame.image}`);
        setRemoteFps(prev => prev + 1);
        break;
      }
      case 'rpi_status': {
        const status = msg.payload as RpiStatusPayload;
        setRpiConnected(status.connected);
        break;
      }
      case 'voice_command_result': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p = msg.payload as any;
        if (p.reply) {
          setVoiceMessages(prev => [...prev.slice(-9), { from: 'coach', text: p.reply }]);
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
    if (!isRunning || source !== 'local') return;
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
  }, [isRunning, source]);

  // ─── Pose detection loop ─────────────────────────────
  useEffect(() => {
    if (!isRunning || source !== 'local' || !modelReady) return;
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

          // Draw connections
          ctx.lineWidth = 3;
          ctx.strokeStyle = getSkeletonColor(quality);
          ctx.lineCap = 'round';
          for (const [i, j] of POSE_CONNECTIONS) {
            if (i < lm.length && j < lm.length) {
              ctx.beginPath();
              ctx.moveTo(lm[i].x * canvas.width, lm[i].y * canvas.height);
              ctx.lineTo(lm[j].x * canvas.width, lm[j].y * canvas.height);
              ctx.stroke();
            }
          }

          // Draw joints
          for (const point of lm) {
            ctx.beginPath();
            ctx.arc(point.x * canvas.width, point.y * canvas.height, 4, 0, 2 * Math.PI);
            ctx.fillStyle = getSkeletonColor(quality);
            ctx.fill();
          }

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
  }, [isRunning, source, modelReady, quality, selectedExercise]);

  // ─── Voice interaction ────────────────────────────────
  useEffect(() => {
    if (!voiceEnabled || !isRunning) {
      // Stop listening
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
      setVoiceListening(false);
      voiceListeningRef.current = false;
      return;
    }

    // Start Web Speech API
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[Voice] Web Speech API not supported');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'zh-CN';
    recognitionRef.current = recognition;

    recognition.onresult = (event: { resultIndex: number; results: { length: number; [key: number]: { [key: number]: { transcript: string }; isFinal: boolean } } }) => {
      const last = event.results[event.results.length - 1];
      if (last.isFinal) {
        const text = last[0].transcript.trim();
        if (text) {
          setVoiceMessages(prev => [...prev.slice(-9), { from: 'user', text }]);
          wsRef.current?.send({
            type: 'voice_command',
            payload: { text, sessionId: sessionIdRef.current },
          });
        }
      }
    };

    recognition.onerror = () => {
      // Auto-restart on error
      if (voiceListeningRef.current) {
        try { recognition.start(); } catch { /* ignore */ }
      }
    };

    recognition.onend = () => {
      // Auto-restart if still enabled
      if (voiceListeningRef.current) {
        try { recognition.start(); } catch { /* ignore */ }
      }
    };

    try {
      recognition.start();
      setVoiceListening(true);
      voiceListeningRef.current = true;
    } catch (e) {
      console.error('[Voice] Start failed:', e);
    }

    return () => {
      try { recognition.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
      setVoiceListening(false);
      voiceListeningRef.current = false;
    };
  }, [voiceEnabled, isRunning]);

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
  useEffect(() => {
    // Update timestamp whenever coaching_feedback arrives
  }, [data.assistant.message]);
  useEffect(() => {
    // Only use local coachVoice as fallback when backend hasn't sent a message in 15+ seconds
    if (!isRunning) return;
    const interval = setInterval(() => {
      const timeSinceLastMsg = Date.now() - lastCoachMsgTimeRef.current;
      if (timeSinceLastMsg < 15000) return; // backend is active, skip local
      const localMsg = getCoachMessage(
        data.biometrics.heartRate,
        data.workout.score,
        data.workout.currentAction,
        data.workout.isFormDeformed,
        personality,
      );
      lastCoachMsgTimeRef.current = Date.now();
      setData(prev => ({
        ...prev,
        assistant: {
          ...prev.assistant,
          message: localMsg.message,
          isAlert: localMsg.isAlert,
        },
      }));
    }, 8000);
    return () => clearInterval(interval);
  }, [isRunning, personality, data.biometrics.heartRate, data.workout.score, data.workout.currentAction, data.workout.isFormDeformed]);

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
          remoteImageUrl={remoteImageUrl}
          selectedExercise={selectedExercise}
          onExerciseChange={setSelectedExercise}
          sourceMode={source}
          onSourceModeChange={setSource}
          voiceEnabled={voiceEnabled}
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
