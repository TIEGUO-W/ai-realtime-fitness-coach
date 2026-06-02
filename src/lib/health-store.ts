/**
 * 健康数据内存存储 — 按 sessionId 索引
 *
 * 数据来源：
 * - iPhone 快捷指令 (POST /api/health)
 * - 手动健康问卷 (POST /api/health/profile)
 *
 * key=sess_xxx → WatchHealthData
 */

import { EventEmitter } from 'events';

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
const emitter = new EventEmitter();

export function normalizeSessionId(sessionId: string): string {
  const clean = sessionId.trim();
  // Avoid double-prefix if sessionId already starts with "sess_"
  if (clean.startsWith('sess_')) return clean;
  return `sess_${clean}`;
}

export function getHealth(sessionId: string): WatchHealthData | null {
  return store.get(normalizeSessionId(sessionId)) ?? null;
}

export function upsertHealth(
  sessionId: string,
  data: Partial<Omit<WatchHealthData, 'sessionId' | 'lastUpdated'>>,
): WatchHealthData {
  const k = normalizeSessionId(sessionId);
  const existing = store.get(k);
  const merged: WatchHealthData = {
    sessionId: k,
    ...existing,
    ...data,
    lastUpdated: Date.now(),
  };
  store.set(k, merged);

  // 通知心率变化
  if (data.heartRate !== undefined) {
    emitter.emit('heartRate', { sessionId: k, heartRate: data.heartRate });
  }

  return merged;
}

export function updateProfile(sessionId: string, profile: HealthProfile): WatchHealthData {
  return upsertHealth(sessionId, { profile });
}

/** 监听心率更新 */
export function onHeartRate(listener: (data: { sessionId: string; heartRate: number }) => void): () => void {
  emitter.on('heartRate', listener);
  return () => { emitter.off('heartRate', listener); };
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
