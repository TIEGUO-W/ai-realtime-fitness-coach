/**
 * 健康数据内存存储 — 按 sessionId 索引
 *
 * 数据来源：
 * - iPhone 快捷指令 (POST /api/health)
 * - 手动健康问卷 (POST /api/health/profile)
 *
 * key=sess_xxx → WatchHealthData
 */

export interface HealthProfile {
  age: number;
  fitnessLevel: 'beginner' | 'intermediate' | 'advanced';
  goal: 'lose_weight' | 'build_muscle' | 'endurance' | 'general';
  injuryHistory: string[];
  weight?: number;
  height?: number;
}

export interface WatchHealthData {
  sessionId: string;
  profile?: HealthProfile;
  heartRate?: number;
  restingHeartRate?: number;
  sleepHours?: number;
  sleepQuality?: 'poor' | 'fair' | 'good';
  heartRateRecovery?: number;
  lastUpdated: number;
}

const store = new Map<string, WatchHealthData>();

function key(sessionId: string): string {
  return `sess_${sessionId}`;
}

export function getHealth(sessionId: string): WatchHealthData | null {
  return store.get(key(sessionId)) ?? null;
}

export function upsertHealth(
  sessionId: string,
  data: Partial<Omit<WatchHealthData, 'sessionId' | 'lastUpdated'>>,
): WatchHealthData {
  const k = key(sessionId);
  const existing = store.get(k);
  const merged: WatchHealthData = {
    sessionId,
    ...existing,
    ...data,
    lastUpdated: Date.now(),
  };
  store.set(k, merged);
  return merged;
}

export function updateProfile(sessionId: string, profile: HealthProfile): WatchHealthData {
  return upsertHealth(sessionId, { profile });
}

/** 计算最大心率 (220-年龄) */
export function maxHeartRate(age: number): number {
  return 220 - age;
}

/** 心率安全评估 */
export function assessHeartRate(
  heartRate: number,
  age: number,
): { status: 'normal' | 'reduce_intensity' | 'stop'; warningLine: number; stopLine: number } {
  const max = maxHeartRate(age);
  const warningLine = Math.round(max * 0.85);
  const stopLine = Math.round(max * 0.92);
  if (heartRate >= stopLine) return { status: 'stop', warningLine, stopLine };
  if (heartRate >= warningLine) return { status: 'reduce_intensity', warningLine, stopLine };
  return { status: 'normal', warningLine, stopLine };
}

/** 睡眠对训练的建议 */
export function sleepAdvice(quality: 'poor' | 'fair' | 'good'): string {
  switch (quality) {
    case 'poor': return '昨晚睡得不太好，今天别太拼，注意身体';
    case 'fair': return '睡眠还行，正常训练没问题';
    case 'good': return '昨晚睡得很好，今天状态应该不错！';
  }
}
