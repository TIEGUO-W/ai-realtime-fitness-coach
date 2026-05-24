import type { DashboardData } from '@/types/dashboard';
import { getCoachMessage } from '@/utils/coachVoice';

const initialAction = '深蹲';
const initialHR = 168;
const initialScore = 85;

export const mockData: DashboardData = {
  environment: {
    temp: 26,
    connectionStatus: 'disconnected',
  },
  workout: {
    currentAction: initialAction,
    reps: 12,
    targetReps: 20,
    score: initialScore,
    isFormDeformed: true,
  },
  biometrics: {
    heartRate: initialHR,
    hrThreshold: 160,
  },
  assistant: {
    ...getCoachMessage(initialHR, initialScore, initialAction, true),
    modelId: 'blue',
  },
};
