'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type {
  ExerciseType,
  CoachPersonality,
  FeedbackItem,
  Workout,
  Biometrics,
  Environment,
  DashboardState,
} from '@/types/dashboard';
import {
  createWsConnection,
  type WsMessage,
  type AlgorithmUpdatePayload,
  type CoachingFeedback,
  type TTSReadyPayload,
  type RemoteFramePayload,
} from '@/lib/ws-client';
import { getCoachMessage } from '@/utils/coachVoice';

// ── Exercise display map ──────────────────────────────────────────
const EXERCISE_DISPLAY: Record<string, string> = {
  idle: '自由',
  auto: '自动识别',
  squat: '深蹲',
  pushup: '俯卧撑',
  deadlift: '硬拉',
  plank: '平板支撑',
  lunge: '弓步蹲',
  jumping_jack: '开合跳',
  high_knees: '高抬腿',
};

function getExerciseName(id: string): string {
  return EXERCISE_DISPLAY[id] || id;
}

// ── Initial state ─────────────────────────────────────────────────
function createInitialState(): DashboardState {
  return {
    isTraining: false,
    mode: 'local',
    exercise: 'squat',
    personality: 'gentle',
    voiceEnabled: true,
    isListening: false,
    sessionDuration: 0,
    connectionError: null,
    remoteFrameSrc: null,
    workout: {
      currentAction: '深蹲',
      reps: 0,
      targetReps: 20,
      score: 80,
      isFormDeformed: false,
    },
    biometrics: {
      heartRate: 72,
      hrThreshold: 160,
    },
    environment: {
      temp: 26,
      connectionStatus: 'disconnected',
    },
    feedback: [],
    voiceMessages: [],
  };
}

// ── Audio playback helper ─────────────────────────────────────────
async function playAudioUrl(url: string) {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const audio = new Audio(blobUrl);
    audio.onended = () => URL.revokeObjectURL(blobUrl);
    await audio.play();
  } catch (err) {
    console.warn('[usePipeline] Audio playback failed:', err);
  }
}

// ── Hook options ──────────────────────────────────────────────────
interface UsePipelineOptions {
  onWorkoutEnd?: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────
export function usePipeline(options: UsePipelineOptions = {}) {
  const { onWorkoutEnd } = options;

  const [state, setState] = useState<DashboardState>(createInitialState);
  const wsRef = useRef<ReturnType<typeof createWsConnection> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediapipeRef = useRef<any>(null); // MediaPipe Pose instance
  const isTrainingRef = useRef(false);
  const modeRef = useRef<'local' | 'remote'>('local');
  const exerciseRef = useRef<ExerciseType>('squat');
  const personalityRef = useRef<CoachPersonality>('gentle');
  const wsReadyRef = useRef(false);
  const sessionStartRef = useRef<number>(0);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedbackIdRef = useRef(0);

  // ── Keep refs in sync ────────────────────────────────────────
  useEffect(() => {
    isTrainingRef.current = state.isTraining;
  }, [state.isTraining]);
  useEffect(() => {
    modeRef.current = state.mode;
  }, [state.mode]);
  useEffect(() => {
    exerciseRef.current = state.exercise;
  }, [state.exercise]);
  useEffect(() => {
    personalityRef.current = state.personality;
  }, [state.personality]);

  // ── Session duration timer ───────────────────────────────────
  useEffect(() => {
    if (state.isTraining) {
      sessionStartRef.current = Date.now();
      durationTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - sessionStartRef.current) / 1000);
        setState((prev) => ({ ...prev, sessionDuration: elapsed }));
      }, 1000);
    } else {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
    }
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    };
  }, [state.isTraining]);

  // ── Handle WS messages ──────────────────────────────────────
  const handleWsMessage = useCallback((msg: WsMessage) => {
    switch (msg.type) {
      case 'algorithm_update': {
        const p = msg.payload as AlgorithmUpdatePayload;
        const isFormDeformed = p.quality === 'error' || p.quality === 'warning';
        const hr = 100 + Math.floor(Math.random() * 50);
        setState((prev) => ({
          ...prev,
          workout: {
            currentAction: getExerciseName(p.exercise),
            reps: p.repCount,
            targetReps: prev.workout.targetReps,
            score: p.quality === 'good' ? 90 : p.quality === 'warning' ? 65 : 40,
            isFormDeformed,
          },
          biometrics: { heartRate: hr, hrThreshold: prev.biometrics.hrThreshold },
        }));
        break;
      }

      case 'coaching_feedback': {
        const p = msg.payload as CoachingFeedback;
        const isAlert = p.quality === 'error' || p.quality === 'warning';
        const isFormDeformed = isAlert;
        const hr = 100 + Math.floor(Math.random() * 50);
        const feedbackText = p.tips?.[0] || p.encouragement || '继续加油!';

        setState((prev) => {
          const newFeedback: FeedbackItem = {
            id: String(++feedbackIdRef.current),
            text: feedbackText,
            type: isAlert ? 'warning' as const : 'info' as const,
            timestamp: Date.now(),
          };
          return {
            ...prev,
            workout: {
              ...prev.workout,
              reps: p.repCount ?? prev.workout.reps,
              currentAction: getExerciseName(p.exercise ?? prev.exercise),
              isFormDeformed,
              score: p.quality === 'good' ? 90 : p.quality === 'warning' ? 65 : 40,
            },
            biometrics: { heartRate: hr, hrThreshold: prev.biometrics.hrThreshold },
            feedback: [...prev.feedback.slice(-19), newFeedback],
          };
        });
        break;
      }

      case 'rep_completed': {
        const p = msg.payload as { repCount: number; effect: string; quality: number };
        setState((prev) => ({
          ...prev,
          workout: {
            ...prev.workout,
            reps: p.repCount,
            score: Math.max(0, Math.min(100, p.quality)),
          },
        }));
        break;
      }

      case 'tts_ready': {
        const p = msg.payload as TTSReadyPayload;
        if (p.audioUrl) {
          playAudioUrl(p.audioUrl);
        }
        break;
      }

      case 'remote_frame': {
        const p = msg.payload as RemoteFramePayload;
        setState((prev) => ({
          ...prev,
          remoteFrameSrc: p.image
            ? `data:image/jpeg;base64,${p.image}`
            : prev.remoteFrameSrc,
        }));
        break;
      }

      case 'rpi_status': {
        const p = msg.payload as { connected: boolean };
        setState((prev) => ({
          ...prev,
          environment: { ...prev.environment, connectionStatus: p.connected ? 'connected' : 'disconnected' },
        }));
        break;
      }

      case 'voice_recognized': {
        const p = msg.payload as { text: string };
        setState((prev) => ({
          ...prev,
          voiceMessages: [...prev.voiceMessages.slice(-9), { from: 'user' as const, text: p.text }],
        }));
        break;
      }

      case 'voice_reply': {
        const p = msg.payload as { text: string };
        setState((prev) => ({
          ...prev,
          voiceMessages: [...prev.voiceMessages.slice(-9), { from: 'ai' as const, text: p.text }],
          feedback: [
            ...prev.feedback.slice(-19),
            { id: String(++feedbackIdRef.current), text: p.text, type: 'info' as const, timestamp: Date.now() },
          ],
        }));
        break;
      }

      case 'voice_reply_tts': {
        const p = msg.payload as { audioUrl: string };
        if (p.audioUrl) playAudioUrl(p.audioUrl);
        break;
      }

      default:
        break;
    }
  }, []);

  // ── Create WS connection on mount ────────────────────────────
  useEffect(() => {
    let closed = false;

    const ws = createWsConnection({
      path: '/ws/coaching',
      onOpen: () => {
        if (!closed) {
          wsReadyRef.current = true;
          setState((prev) => ({
            ...prev,
            environment: { ...prev.environment, connectionStatus: 'connected' as const },
            connectionError: null,
          }));
          ws.send({ type: 'set_exercise', payload: { exercise: exerciseRef.current } });
        }
      },
      onClose: () => {
        if (!closed) {
          wsReadyRef.current = false;
          setState((prev) => ({
            ...prev,
            environment: { ...prev.environment, connectionStatus: 'disconnected' as const },
            connectionError: 'WebSocket 断开，正在重连...',
          }));
        }
      },
      onMessage: (msg: WsMessage) => {
        if (!closed) handleWsMessage(msg);
      },
    });

    wsRef.current = ws;

    return () => {
      closed = true;
      ws.close();
      wsRef.current = null;
    };
  }, [handleWsMessage]);

  // ── Local simulation when disconnected ───────────────────────
  useEffect(() => {
    if (state.environment.connectionStatus !== 'disconnected' || !state.isTraining) return;

    const timer = setInterval(() => {
      setState((prev) => {
        const hrDrift = Math.round((Math.random() - 0.5) * 6);
        const newHr = Math.min(185, Math.max(100, prev.biometrics.heartRate + hrDrift));
        const newReps = Math.random() > 0.85
          ? Math.min(prev.workout.targetReps, prev.workout.reps + 1)
          : prev.workout.reps;
        const newScore = Math.min(100, Math.max(70, prev.workout.score + Math.round((Math.random() - 0.55) * 3)));
        const formDeformed = newHr > prev.biometrics.hrThreshold && Math.random() > 0.4;
        const coachMsg = getCoachMessage(newHr, newScore, prev.workout.currentAction, formDeformed, personalityRef.current);
        const newFeedback: FeedbackItem = {
          id: String(++feedbackIdRef.current),
          text: coachMsg.message,
          type: coachMsg.isAlert ? 'warning' : 'info',
          timestamp: Date.now(),
        };

        return {
          ...prev,
          workout: { ...prev.workout, reps: newReps, score: newScore, isFormDeformed: formDeformed },
          biometrics: { ...prev.biometrics, heartRate: newHr },
          feedback: [...prev.feedback.slice(-19), newFeedback],
        };
      });
    }, 3000);

    return () => clearInterval(timer);
  }, [state.environment.connectionStatus, state.isTraining]);

  // ── MediaPipe setup for local mode ───────────────────────────
  const setupMediaPipe = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    try {
      // Get camera
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
      });
      video.srcObject = stream;
      await video.play();

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Load MediaPipe Pose dynamically from CDN
      const { Pose } = await import('@mediapipe/pose' as any);
      const pose = new Pose({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      });

      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      pose.onResults((results: any) => {
        if (!ctx || !canvas) return;

        // Draw camera frame
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

        // Draw skeleton
        if (results.poseLandmarks) {
          // Draw connections
          const connections = [
            [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
            [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
            [24, 26], [26, 28], [15, 17], [15, 19], [16, 18], [16, 20],
            [27, 29], [27, 31], [28, 30], [28, 32],
          ];
          ctx.strokeStyle = '#00E5FF';
          ctx.lineWidth = 2;
          for (const [a, b] of connections) {
            const la = results.poseLandmarks[a];
            const lb = results.poseLandmarks[b];
            if (la && lb && la.visibility > 0.3 && lb.visibility > 0.3) {
              ctx.beginPath();
              ctx.moveTo(la.x * canvas.width, la.y * canvas.height);
              ctx.lineTo(lb.x * canvas.width, lb.y * canvas.height);
              ctx.stroke();
            }
          }

          // Draw landmarks
          for (const lm of results.poseLandmarks) {
            if (lm.visibility > 0.3) {
              ctx.beginPath();
              ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 3, 0, 2 * Math.PI);
              ctx.fillStyle = '#00E5FF';
              ctx.fill();
            }
          }

          // Send to backend
          if (wsReadyRef.current && wsRef.current) {
            wsRef.current.send({
              type: 'pose_frame',
              payload: { landmarks: results.poseLandmarks, timestamp: Date.now() },
            });
          }
        }

        ctx.restore();
      });

      mediapipeRef.current = pose;

      // Frame loop
      const sendFrame = async () => {
        if (!isTrainingRef.current || modeRef.current !== 'local') return;
        if (video.readyState >= 2) {
          await pose.send({ image: video });
        }
        requestAnimationFrame(sendFrame);
      };
      sendFrame();
    } catch (err) {
      console.error('[usePipeline] MediaPipe setup failed:', err);
      setState((prev) => ({ ...prev, connectionError: '摄像头启动失败，请检查权限' }));
    }
  }, []);

  // ── Public API: toggle session ───────────────────────────────
  const toggleSession = useCallback(() => {
    setState((prev) => {
      const nextTraining = !prev.isTraining;

      if (nextTraining && prev.mode === 'local') {
        // Start local mode — setup MediaPipe
        setTimeout(() => setupMediaPipe(), 100);
      }

      if (!nextTraining) {
        // Stop — cleanup
        if (mediapipeRef.current) {
          mediapipeRef.current.close();
          mediapipeRef.current = null;
        }
        if (videoRef.current?.srcObject) {
          (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
          videoRef.current.srcObject = null;
        }
      }

      return { ...prev, isTraining: nextTraining, sessionDuration: 0 };
    });
  }, [setupMediaPipe]);

  // ── Public API: set exercise ─────────────────────────────────
  const setExercise = useCallback((exercise: ExerciseType) => {
    exerciseRef.current = exercise;
    if (wsRef.current && wsReadyRef.current) {
      wsRef.current.send({ type: 'set_exercise', payload: { exercise } });
    }
    setState((prev) => ({
      ...prev,
      exercise,
      workout: { ...prev.workout, currentAction: getExerciseName(exercise), reps: 0 },
    }));
  }, []);

  // ── Public API: set mode ─────────────────────────────────────
  const setMode = useCallback((mode: 'local' | 'remote') => {
    modeRef.current = mode;
    if (wsRef.current && wsReadyRef.current) {
      wsRef.current.send({ type: 'set_mode', payload: { mode } });
    }
    setState((prev) => ({ ...prev, mode }));
  }, []);

  // ── Public API: set personality ──────────────────────────────
  const setPersonality = useCallback((personality: CoachPersonality) => {
    personalityRef.current = personality;
    setState((prev) => ({ ...prev, personality }));
  }, []);

  // ── Public API: voice controls ───────────────────────────────
  const setVoiceEnabled = useCallback((voiceEnabled: boolean) => {
    setState((prev) => ({ ...prev, voiceEnabled }));
  }, []);

  const startVoice = useCallback(() => {
    setState((prev) => ({ ...prev, isListening: true }));

    // Try Web Speech API first
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = 'zh-CN';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        if (wsRef.current && wsReadyRef.current) {
          wsRef.current.send({ type: 'voice_command', payload: { text } });
        }
        setState((prev) => ({
          ...prev,
          isListening: false,
          voiceMessages: [...prev.voiceMessages.slice(-9), { from: 'user' as const, text }],
        }));
      };

      recognition.onerror = () => {
        setState((prev) => ({ ...prev, isListening: false }));
      };

      recognition.onend = () => {
        setState((prev) => ({ ...prev, isListening: false }));
      };

      recognition.start();
      (window as any).__speechRecognition = recognition;
    }
  }, []);

  const stopVoice = useCallback(() => {
    const recognition = (window as any).__speechRecognition;
    if (recognition) {
      try { recognition.stop(); } catch {}
    }
    setState((prev) => ({ ...prev, isListening: false }));
  }, []);

  return {
    state,
    videoRef,
    canvasRef,
    toggleSession,
    setExercise,
    setMode,
    setPersonality,
    setVoiceEnabled,
    startVoice,
    stopVoice,
  };
}
