export type CoachPersonality = 'strict' | 'gentle' | 'toxic' | 'energetic';
export type CoachVoice = 'female_soft' | 'male_energetic' | 'male_strict' | 'anime_fire';

export type ExerciseType = 'idle' | 'squat' | 'pushup' | 'lunge' | 'plank' | 'jumping_jack' | 'high_knees';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface Environment {
  temp: number;
  connectionStatus: ConnectionStatus;
}

export interface Workout {
  currentAction: string;
  reps: number;
  targetReps: number;
  score: number;
  isFormDeformed: boolean;
}

export interface Biometrics {
  heartRate: number;
  hrThreshold: number;
}

export interface Assistant {
  message: string;
  isAlert: boolean;
  modelId: string;
}

export interface FeedbackItem {
  id: string;
  text: string;
  type: 'info' | 'warning' | 'error' | 'success';
  timestamp: number;
}

export interface VoiceMessage {
  from: 'user' | 'ai';
  text: string;
}

export interface DashboardState {
  isTraining: boolean;
  mode: 'local' | 'remote';
  exercise: ExerciseType;
  personality: CoachPersonality;
  voiceEnabled: boolean;
  isListening: boolean;
  sessionDuration: number;
  connectionError: string | null;
  remoteFrameSrc: string | null;
  workout: Workout;
  biometrics: Biometrics;
  environment: Environment;
  feedback: FeedbackItem[];
  voiceMessages: VoiceMessage[];
}

/** Legacy data format (kept for compatibility) */
export interface DashboardData {
  environment: Environment;
  workout: Workout;
  biometrics: Biometrics;
  assistant: Assistant;
}
