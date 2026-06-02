/**
 * 跟练对比引擎 — 滑动窗口角度匹配
 *
 * 用户帧 N → 在教练帧 [N-offset, N+offset] 窗口内搜索角度差最小的帧
 * 阈值: <15°=good, 15-30°=adjust, >30°=correct
 */

import { readFile } from 'fs/promises';
import path from 'path';
import type { Landmark } from '../lib/ws-client';
import { computeAnglesFromLandmarks, type JointAngles } from './pose-algorithm';

const SKELETONS_DIR = path.join(process.cwd(), 'public', 'uploads', 'coach-skeletons');
const DEFAULT_WINDOW = 15; // ±15 帧 ≈ ±3 秒 @ 5fps

// ─── 类型 ──────────────────────────────────────────

export type JointStatus = 'good' | 'adjust' | 'correct';
export type JointStatusMap = Record<string, JointStatus>;

export interface ComparisonResult {
  matchQuality: number;       // 0-100
  angleDiffs: Record<string, number>;
  coachFrameIndex: number;
  coachAngles: JointAngles;
  followed: boolean;          // matchQuality > 50
  perJointStatus: JointStatusMap;
}

interface CoachSkeletonFrame {
  frameIndex: number;
  timeMs: number;
  landmarks: Landmark[];
}

interface CoachSkeletonData {
  recordingId: string;
  totalFrames: number;
  fps: number;
  frames: CoachSkeletonFrame[];
  metadata: { durationMs: number; extractFps: number };
}

// 参与对比的主要关节（权重）
const COMPARE_JOINTS: Array<{ key: keyof JointAngles; label: string; weight: number }> = [
  { key: 'kneeAngle', label: '膝关节', weight: 2.0 },
  { key: 'hipAngle', label: '髋关节', weight: 2.0 },
  { key: 'trunkAngle', label: '躯干', weight: 1.5 },
  { key: 'trunkForwardLean', label: '躯干前倾', weight: 1.5 },
  { key: 'leftKneeAngle', label: '左膝', weight: 1.2 },
  { key: 'rightKneeAngle', label: '右膝', weight: 1.2 },
  { key: 'leftHipAngle', label: '左髋', weight: 1.2 },
  { key: 'rightHipAngle', label: '右髋', weight: 1.2 },
  { key: 'leftElbowAngle', label: '左肘', weight: 0.8 },
  { key: 'rightElbowAngle', label: '右肘', weight: 0.8 },
  { key: 'leftShoulderAngle', label: '左肩', weight: 0.8 },
  { key: 'rightShoulderAngle', label: '右肩', weight: 0.8 },
  { key: 'bodyLineAngle', label: '身体直线', weight: 1.0 },
];

// ─── 引擎 ──────────────────────────────────────────

export class FollowAlongEngine {
  private coachData: CoachSkeletonData | null = null;
  private windowSize: number;
  private lastCoachFrameIndex = 0;
  private userFrameCount = 0;
  private alignmentHistory: number[] = [];
  private qualityHistory: number[] = []; // rolling average for smooth score

  constructor(windowSize = DEFAULT_WINDOW) {
    this.windowSize = windowSize;
  }

  get exercise(): string {
    return 'squat'; // 默认深蹲，可扩展为从 metadata 读取
  }

  get totalFrames(): number {
    return this.coachData?.totalFrames ?? 0;
  }

  /** 加载教练骨架 JSON */
  async loadCoachData(recordingId: string): Promise<void> {
    const filePath = path.join(SKELETONS_DIR, `${recordingId}.json`);
    const raw = await readFile(filePath, 'utf-8');
    this.coachData = JSON.parse(raw) as CoachSkeletonData;

    if (!this.coachData.frames || this.coachData.frames.length === 0) {
      throw new Error('教练骨架数据为空');
    }

    console.log(
      `[FollowAlongEngine] 加载教练数据: ${this.coachData.totalFrames} 帧 @ ${this.coachData.fps}fps`,
    );
  }

  /** 获取初始几帧（用于前端初始显示） */
  getInitialFrames(count: number): CoachSkeletonFrame[] {
    if (!this.coachData) return [];
    return this.coachData.frames.slice(0, count);
  }

  /** 获取指定索引的教练帧 */
  getCoachFrame(index: number): CoachSkeletonFrame | null {
    if (!this.coachData) return null;
    return this.coachData.frames[index] ?? null;
  }

  /** 核心：对比用户帧与教练窗口，返回最佳匹配 */
  compareFrame(userLandmarks: Landmark[], _userFrameNumber: number): ComparisonResult {
    if (!this.coachData) {
      return this.emptyResult();
    }

    this.userFrameCount++;

    // 计算用户角度
    const userAngles = computeAnglesFromLandmarks(userLandmarks);

    // 估算用户进度 → 映射到教练帧索引
    // 使用上次对齐位置作为中心，容忍 ±window 偏差
    const centerIndex = this.lastCoachFrameIndex;
    const searchStart = Math.max(0, centerIndex - this.windowSize);
    const searchEnd = Math.min(this.coachData.totalFrames - 1, centerIndex + this.windowSize);

    let bestScore = Infinity;
    let bestFrameIndex = centerIndex;
    let bestDiffs: Record<string, number> = {};

    // 在窗口内搜索最佳匹配帧
    for (let i = searchStart; i <= searchEnd; i++) {
      const coachFrame = this.coachData.frames[i];
      if (!coachFrame) continue;

      const coachAngles = computeAnglesFromLandmarks(coachFrame.landmarks);
      const diffs = this.angleDiffs(userAngles, coachAngles);

      // 加权分数
      let score = 0;
      let totalWeight = 0;
      for (const joint of COMPARE_JOINTS) {
        const diff = diffs[joint.key];
        if (diff !== undefined && !isNaN(diff)) {
          score += Math.abs(diff) * joint.weight;
          totalWeight += joint.weight;
        }
      }

      const avgScore = totalWeight > 0 ? score / totalWeight : Infinity;
      if (avgScore < bestScore) {
        bestScore = avgScore;
        bestFrameIndex = i;
        bestDiffs = diffs;
      }
    }

    // 更新对齐状态
    this.lastCoachFrameIndex = bestFrameIndex;
    this.alignmentHistory.push(bestFrameIndex);
    if (this.alignmentHistory.length > 30) this.alignmentHistory.shift();

    // 跟踪是否大致稳定（最近 5 帧的标准差 < 3）
    const recentAligned = this.alignmentHistory.slice(-5);
    const alignedMean = recentAligned.reduce((a, b) => a + b, 0) / recentAligned.length;
    const alignedStd = Math.sqrt(
      recentAligned.reduce((sum, v) => sum + (v - alignedMean) ** 2, 0) / recentAligned.length,
    );
    const followed = bestScore < 30 && alignedStd < 5;

    // 关节状态分类
    const perJointStatus: JointStatusMap = {};
    for (const joint of COMPARE_JOINTS) {
      const diff = bestDiffs[joint.key];
      if (diff === undefined || isNaN(diff)) {
        perJointStatus[joint.label] = 'good';
      } else if (diff < 15) {
        perJointStatus[joint.label] = 'good';
      } else if (diff <= 30) {
        perJointStatus[joint.label] = 'adjust';
      } else {
        perJointStatus[joint.label] = 'correct';
      }
    }

    // 统计实际参与对比的关节数（未检测到的跳过）
    const comparedJoints = Object.values(bestDiffs).filter(d => d !== undefined && !isNaN(d)).length;

    // 关节数太少（坐着/被遮挡）→ 无法可靠对比，默认 50 分（不高不低）
    if (comparedJoints < 8) {
      const matchQuality = 50;
      this.qualityHistory.push(matchQuality);
      if (this.qualityHistory.length > 20) this.qualityHistory.shift();
      const smoothed = Math.round(this.qualityHistory.reduce((a, b) => a + b, 0) / this.qualityHistory.length);

      const bestCoachFrame = this.coachData!.frames[bestFrameIndex];
      const coachAngles = bestCoachFrame ? computeAnglesFromLandmarks(bestCoachFrame.landmarks) : ({} as JointAngles);
      return {
        matchQuality: smoothed,
        angleDiffs: bestDiffs,
        coachFrameIndex: bestFrameIndex,
        coachAngles,
        followed: false,
        perJointStatus: {},
      };
    }

    // 非线性评分：差异小时降分快，差异大时降分慢
    // bestScore 0→100, 5→90, 10→75, 15→55, 20→35, 30→15, 40+→0
    let rawQuality: number;
    if (bestScore <= 5) rawQuality = 100 - bestScore * 2;          // 0-5°: 100→90
    else if (bestScore <= 15) rawQuality = 90 - (bestScore - 5) * 3.5; // 5-15°: 90→55
    else if (bestScore <= 30) rawQuality = 55 - (bestScore - 15) * 2;  // 15-30°: 55→25
    else rawQuality = Math.max(0, 25 - (bestScore - 30) * 0.8);        // 30°+: 25→0

    // 平滑：最近 20 帧平均
    this.qualityHistory.push(rawQuality);
    if (this.qualityHistory.length > 20) this.qualityHistory.shift();
    const matchQuality = Math.round(this.qualityHistory.reduce((a, b) => a + b, 0) / this.qualityHistory.length);

    // 获取最佳匹配帧的教练角度
    const bestCoachFrame = this.coachData.frames[bestFrameIndex];
    const coachAngles = bestCoachFrame
      ? computeAnglesFromLandmarks(bestCoachFrame.landmarks)
      : ({} as JointAngles);

    return {
      matchQuality,
      angleDiffs: bestDiffs,
      coachFrameIndex: bestFrameIndex,
      coachAngles,
      followed,
      perJointStatus,
    };
  }

  /** 计算两组角度的逐项差异 */
  private angleDiffs(user: JointAngles, coach: JointAngles): Record<string, number> {
    const diffs: Record<string, number> = {};
    for (const joint of COMPARE_JOINTS) {
      const u = user[joint.key];
      const c = coach[joint.key];
      if (u !== null && u !== undefined && c !== null && c !== undefined && !isNaN(u) && !isNaN(c)) {
        diffs[joint.key] = Math.round(Math.abs(u - c) * 10) / 10;
      }
    }
    return diffs;
  }

  private emptyResult(): ComparisonResult {
    return {
      matchQuality: 0,
      angleDiffs: {},
      coachFrameIndex: 0,
      coachAngles: {} as JointAngles,
      followed: false,
      perJointStatus: {},
    };
  }

  reset(): void {
    this.lastCoachFrameIndex = 0;
    this.userFrameCount = 0;
    this.alignmentHistory = [];
    this.qualityHistory = [];
  }
}
