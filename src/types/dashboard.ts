export type CoachPersonality = 'strict' | 'gentle' | 'toxic' | 'energetic';
export type CoachVoice = 'female_soft' | 'male_energetic' | 'male_strict' | 'anime_fire';

export interface Environment {
  temp: number;
  aiActive: boolean;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
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

export interface ChatMessage {
  from: 'user' | 'coach';
  text: string;
  timestamp: number;
}

export interface DashboardData {
  environment: Environment;
  workout: Workout;
  biometrics: Biometrics;
  assistant: Assistant;
}
