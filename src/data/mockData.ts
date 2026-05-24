import type { DashboardData } from '@/types/dashboard';
import { getCoachMessage } from '@/utils/coachVoice';

const initialAction = '深蹲';
const initialHR = 168;
const initialScore = 85;

export const mockData: DashboardData = {
  environment: {
    temp: 26,
    aiActive: true,
    connectionStatus: 'disconnected',
  },
  workout: {
    currentAction: initialAction,
    reps: 0,
    targetReps: 20,
    score: initialScore,
    isFormDeformed: false,
  },
  biometrics: {
    heartRate: initialHR,
    hrThreshold: 160,
  },
  assistant: {
    ...getCoachMessage(initialHR, initialScore, initialAction, false),
    modelId: 'blue',
  },
};
