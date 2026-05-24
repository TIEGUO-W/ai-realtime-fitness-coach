/**
 * 规则算法引擎 — 骨架清洗 + 关节角度 + 状态机计数 + 质量评分
 * 参考: serene-WJ/AI- algorithm_service.py
 * 
 * 核心思路: 规则算法毫秒级实时处理，LLM 只负责话术生成
 */

import type { Landmark } from '../lib/ws-client';

// ─── 类型定义 ──────────────────────────────────

export interface CleanedKeypoint {
  x: number;
  y: number;
  confidence: number;
  valid: boolean;
  interpolated: boolean;
}

export interface JointAngles {
  kneeAngle: number | null;
  hipAngle: number | null;
  trunkAngle: number | null;
  trunkForwardLean: number | null;
}

export interface PoseCleaningResult {
  keypoints: Record<string, CleanedKeypoint>;
  selectedSide: 'left' | 'right' | 'unknown';
  droppedKeypoints: string[];
  interpolatedKeypoints: string[];
  abnormalFrame: boolean;
  confidenceMean: number;
}

export interface QualityAssessment {
  qualityScore: number;
  errors: string[];
  warnings: string[];
}

export type ExerciseStage = 'standing' | 'descending' | 'bottom' | 'ascending' | 'unknown';

export type FrontendEffect = 'perfect' | 'excellent' | 'good' | null;

export interface AlgorithmResult {
  exercise: string;
  stage: ExerciseStage;
  repCount: number;
  completedRep: boolean;
  angles: JointAngles;
  quality: QualityAssessment;
  effect: FrontendEffect;
  algorithmContext: string;
}

// ─── 常量 ──────────────────────────────────────

const LOW_CONFIDENCE_THRESHOLD = 0.3;
const SMOOTHING_ALPHA = 0.45;
const SIDE_JOINTS = ['shoulder', 'hip', 'knee', 'ankle'] as const;

// MediaPipe Pose 33 关键点 → 命名映射
const JOINT_MAP: Record<number, string> = {
  11: 'left_shoulder',
  12: 'right_shoulder',
  13: 'left_elbow',
  14: 'right_elbow',
  15: 'left_wrist',
  16: 'right_wrist',
  23: 'left_hip',
  24: 'right_hip',
  25: 'left_knee',
  26: 'right_knee',
  27: 'left_ankle',
  28: 'right_ankle',
};

// ─── 算法引擎 ──────────────────────────────────

export class PoseAlgorithmEngine {
  private previousKeypoints: Record<string, CleanedKeypoint> = {};
  private previousKneeAngle: number | null = null;
  private lastKneeAngleDelta: number | null = null;
  private previousStage: ExerciseStage = 'unknown';
  private stagePath: ExerciseStage[] = [];
  private repCount = 0;

  reset(): void {
    this.previousKeypoints = {};
    this.previousKneeAngle = null;
    this.lastKneeAngleDelta = null;
    this.previousStage = 'unknown';
    this.stagePath = [];
    this.repCount = 0;
  }

  analyze(landmarks: Landmark[], exercise: string): AlgorithmResult {
    const rawKeypoints = this.landmarksToNamedKeypoints(landmarks);
    const cleaning = this.cleanPose(rawKeypoints);
    const angles = this.calculateAngles(cleaning);
    const stage = this.recognizeSquatStage(angles.kneeAngle);
    const completedRep = this.updateCounter(stage);
    const quality = this.scoreQuality(cleaning, angles, stage);
    const effect = this.computeEffect(quality, completedRep);
    const algorithmContext = this.buildAlgorithmContext(
      exercise, stage, completedRep, cleaning, angles, quality,
    );

    return {
      exercise,
      stage,
      repCount: this.repCount,
      completedRep,
      angles,
      quality,
      effect,
      algorithmContext,
    };
  }

  // MediaPipe landmarks 数组 → 命名 keypoint dict
  private landmarksToNamedKeypoints(
    landmarks: Landmark[],
  ): Record<string, { x: number; y: number; confidence: number }> {
    const result: Record<string, { x: number; y: number; confidence: number }> = {};
    for (const [idx, name] of Object.entries(JOINT_MAP)) {
      const lm = landmarks[Number(idx)];
      if (lm) {
        result[name] = { x: lm.x, y: lm.y, confidence: lm.visibility ?? 0 };
      }
    }
    return result;
  }

  // 骨架清洗: 低置信度过滤 + EMA 平滑 + 异常帧检测
  private cleanPose(
    rawKeypoints: Record<string, { x: number; y: number; confidence: number }>,
  ): PoseCleaningResult {
    const cleaned: Record<string, CleanedKeypoint> = {};
    const dropped: string[] = [];
    const interpolated: string[] = [];

    for (const [name, point] of Object.entries(rawKeypoints)) {
      const previous = this.previousKeypoints[name];

      if (point.confidence < LOW_CONFIDENCE_THRESHOLD) {
        dropped.push(name);
        if (previous && previous.valid) {
          cleaned[name] = {
            x: previous.x,
            y: previous.y,
            confidence: round2(previous.confidence * 0.6),
            valid: true,
            interpolated: true,
          };
          interpolated.push(name);
        } else {
          cleaned[name] = {
            x: point.x,
            y: point.y,
            confidence: point.confidence,
            valid: false,
            interpolated: false,
          };
        }
        continue;
      }

      let x = point.x;
      let y = point.y;
      if (previous && previous.valid) {
        x = previous.x * (1 - SMOOTHING_ALPHA) + point.x * SMOOTHING_ALPHA;
        y = previous.y * (1 - SMOOTHING_ALPHA) + point.y * SMOOTHING_ALPHA;
      }

      cleaned[name] = {
        x: round4(x),
        y: round4(y),
        confidence: round4(point.confidence),
        valid: true,
        interpolated: false,
      };
    }

    // 补充上一帧中本帧缺失的有效点
    for (const [name, previous] of Object.entries(this.previousKeypoints)) {
      if (name in cleaned || !previous.valid) continue;
      cleaned[name] = {
        x: previous.x,
        y: previous.y,
        confidence: round2(previous.confidence * 0.5),
        valid: true,
        interpolated: true,
      };
      interpolated.push(name);
    }

    const abnormalFrame = this.isAbnormalFrame(cleaned);
    if (abnormalFrame && Object.keys(this.previousKeypoints).length > 0) {
      // 异常帧: 保留上一帧数据
      Object.assign(cleaned, this.previousKeypoints);
    }
    if (!abnormalFrame) {
      this.previousKeypoints = { ...cleaned };
    }

    const validPoints = Object.values(cleaned).filter((p) => p.valid);
    const confidenceMean =
      validPoints.length > 0
        ? round4(validPoints.reduce((s, p) => s + p.confidence, 0) / validPoints.length)
        : 0;

    return {
      keypoints: cleaned,
      selectedSide: this.selectBodySide(cleaned),
      droppedKeypoints: dropped,
      interpolatedKeypoints: interpolated,
      abnormalFrame,
      confidenceMean,
    };
  }

  private isAbnormalFrame(cleaned: Record<string, CleanedKeypoint>): boolean {
    if (Object.keys(this.previousKeypoints).length === 0) return false;

    const movements: number[] = [];
    let maxCoord = 0;
    for (const [name, point] of Object.entries(cleaned)) {
      maxCoord = Math.max(maxCoord, Math.abs(point.x), Math.abs(point.y));
      const previous = this.previousKeypoints[name];
      if (previous && previous.valid && point.valid) {
        movements.push(distance(previous, point));
      }
    }

    if (movements.length < 3) return false;

    const threshold =
      maxCoord <= 2 ? 0.35 : Math.max(120, this.bodyScale(cleaned) * 0.6);
    return median(movements) > threshold;
  }

  private bodyScale(keypoints: Record<string, CleanedKeypoint>): number {
    const side = this.selectBodySide(keypoints);
    if (side === 'unknown') return 0;

    const pairs: [string, string][] = [
      [`${side}_shoulder`, `${side}_hip`],
      [`${side}_hip`, `${side}_knee`],
      [`${side}_knee`, `${side}_ankle`],
    ];
    return pairs.reduce((sum, [a, b]) => {
      const pa = keypoints[a];
      const pb = keypoints[b];
      return sum + (isValid(pa) && isValid(pb) ? distance(pa, pb) : 0);
    }, 0);
  }

  private selectBodySide(
    keypoints: Record<string, CleanedKeypoint>,
  ): 'left' | 'right' | 'unknown' {
    const scores: Record<string, number> = { left: 0, right: 0 };
    for (const side of ['left', 'right'] as const) {
      const sidePoints = SIDE_JOINTS.map((j) => keypoints[`${side}_${j}`]);
      const validPoints = sidePoints.filter(isValid);
      scores[side] = validPoints.length * 2 + validPoints.reduce((s, p) => s + p.confidence, 0);
    }
    if (scores.left === 0 && scores.right === 0) return 'unknown';
    return scores.left >= scores.right ? 'left' : 'right';
  }

  // 关节角度计算
  private calculateAngles(cleaning: PoseCleaningResult): JointAngles {
    const side = cleaning.selectedSide;
    if (side === 'unknown') return { kneeAngle: null, hipAngle: null, trunkAngle: null, trunkForwardLean: null };

    const kp = cleaning.keypoints;
    const shoulder = kp[`${side}_shoulder`];
    const hip = kp[`${side}_hip`];
    const knee = kp[`${side}_knee`];
    const ankle = kp[`${side}_ankle`];

    return {
      kneeAngle: roundOptional(angle(hip, knee, ankle)),
      hipAngle: roundOptional(angle(shoulder, hip, knee)),
      trunkAngle: roundOptional(angle(shoulder, hip, ankle)),
      trunkForwardLean: roundOptional(trunkForwardLean(shoulder, hip)),
    };
  }

  // 深蹲阶段识别（状态机）
  private recognizeSquatStage(kneeAngle: number | null): ExerciseStage {
    if (kneeAngle === null) return 'unknown';

    const previousAngle = this.previousKneeAngle;
    this.lastKneeAngleDelta =
      previousAngle !== null ? Math.abs(kneeAngle - previousAngle) : null;
    this.previousKneeAngle = kneeAngle;

    if (kneeAngle >= 160) return 'standing';
    if (kneeAngle <= 105) return 'bottom';
    if (previousAngle === null) return 'unknown';
    if (kneeAngle < previousAngle - 4) return 'descending';
    if (kneeAngle > previousAngle + 4) return 'ascending';
    return this.previousStage;
  }

  // 状态机计数: standing → descending → bottom → ascending → standing = 1 rep
  private updateCounter(stage: ExerciseStage): boolean {
    if (stage === 'unknown') return false;

    if (stage !== this.previousStage) {
      this.stagePath.push(stage);
      this.stagePath = this.stagePath.slice(-6);
    }

    let completed = false;
    if (stage === 'standing' && this.previousStage === 'ascending') {
      completed = containsOrderedSequence(this.stagePath, [
        'standing', 'descending', 'bottom', 'ascending', 'standing',
      ]);
      if (completed) {
        this.repCount += 1;
        this.stagePath = ['standing'];
      }
    }

    this.previousStage = stage;
    return completed;
  }

  // 质量评分
  private scoreQuality(
    cleaning: PoseCleaningResult,
    angles: JointAngles,
    stage: ExerciseStage,
  ): QualityAssessment {
    let score = 100;
    const errors: string[] = [];
    const warnings: string[] = [];

    // 膝盖内扣
    if (this.hasKneeInward(cleaning)) {
      score -= 20;
      errors.push('knee_inward');
    }

    // 深蹲深度不足
    const shallowTurnaround =
      stage === 'ascending' &&
      this.stagePath.includes('descending') &&
      !this.stagePath.includes('bottom');
    if (shallowTurnaround) {
      score -= 15;
      errors.push('insufficient_depth');
    }

    // 身体前倾
    if (angles.trunkForwardLean !== null && angles.trunkForwardLean > 35) {
      score -= 15;
      errors.push('back_leaning_forward');
    }

    // 动作过快
    if (this.isTooFast(angles.kneeAngle)) {
      score -= 10;
      warnings.push('movement_too_fast');
    }

    // 左右不平衡
    if (this.isLeftRightUnbalanced(cleaning)) {
      score -= 10;
      warnings.push('left_right_unbalanced');
    }

    // 关键点置信度过低
    if (cleaning.confidenceMean < 0.55 || cleaning.abnormalFrame) {
      score -= 10;
      warnings.push('low_keypoint_confidence');
    }

    return {
      qualityScore: Math.max(0, score),
      errors,
      warnings,
    };
  }

  private hasKneeInward(cleaning: PoseCleaningResult): boolean {
    const side = cleaning.selectedSide;
    if (side === 'unknown') return false;
    const hip = cleaning.keypoints[`${side}_hip`];
    const knee = cleaning.keypoints[`${side}_knee`];
    const ankle = cleaning.keypoints[`${side}_ankle`];
    if (!isValid(hip) || !isValid(knee) || !isValid(ankle)) return false;

    const hipAnkleX = (hip.x + ankle.x) / 2;
    const sideSign = side === 'left' ? -1 : 1;
    return (knee.x - hipAnkleX) * sideSign > Math.abs(ankle.x - hip.x) * 0.35;
  }

  private isTooFast(kneeAngle: number | null): boolean {
    if (kneeAngle === null || this.lastKneeAngleDelta === null) return false;
    return this.lastKneeAngleDelta > 28;
  }

  private isLeftRightUnbalanced(cleaning: PoseCleaningResult): boolean {
    const kp = cleaning.keypoints;
    const leftHip = kp.left_hip;
    const rightHip = kp.right_hip;
    const leftKnee = kp.left_knee;
    const rightKnee = kp.right_knee;
    if (!isValid(leftHip) || !isValid(rightHip) || !isValid(leftKnee) || !isValid(rightKnee))
      return false;
    const maxCoord = Math.max(
      Math.abs(leftHip.x) + Math.abs(leftHip.y),
      Math.abs(rightHip.x) + Math.abs(rightHip.y),
      Math.abs(leftKnee.x) + Math.abs(leftKnee.y),
      Math.abs(rightKnee.x) + Math.abs(rightKnee.y),
    );
    const threshold = maxCoord <= 4 ? 0.05 : 35;
    return Math.abs((leftKnee.y - leftHip.y) - (rightKnee.y - rightHip.y)) > threshold;
  }

  // 前端特效指令
  private computeEffect(quality: QualityAssessment, completedRep: boolean): FrontendEffect {
    if (!completedRep) return null;
    if (quality.qualityScore >= 95) return 'perfect';
    if (quality.qualityScore >= 85) return 'excellent';
    if (quality.qualityScore >= 70) return 'good';
    return null;
  }

  // 构建算法上下文给 LLM 用
  private buildAlgorithmContext(
    exercise: string,
    stage: ExerciseStage,
    completedRep: boolean,
    cleaning: PoseCleaningResult,
    angles: JointAngles,
    quality: QualityAssessment,
  ): string {
    const lines = [
      `运动: ${exercise}. 阶段: ${stage}. 次数: ${this.repCount}. 完成一次: ${completedRep}.`,
      `选择侧: ${cleaning.selectedSide}. 异常帧: ${cleaning.abnormalFrame}.`,
      `角度: 膝=${angles.kneeAngle}° 髋=${angles.hipAngle}° 躯干=${angles.trunkAngle}° 前倾=${angles.trunkForwardLean}°.`,
      `质量分: ${quality.qualityScore}. 错误: [${quality.errors.join(',')}]. 警告: [${quality.warnings.join(',')}].`,
    ];
    return lines.join(' ');
  }
}

// ─── 工具函数 ──────────────────────────────────

function isValid(p?: CleanedKeypoint | null): p is CleanedKeypoint {
  return p != null && p.valid;
}

function distance(a: CleanedKeypoint, b: CleanedKeypoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angle(
  a: CleanedKeypoint | undefined,
  b: CleanedKeypoint | undefined,
  c: CleanedKeypoint | undefined,
): number | null {
  if (!isValid(a) || !isValid(b) || !isValid(c)) return null;
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const baLen = Math.hypot(ba.x, ba.y);
  const bcLen = Math.hypot(bc.x, bc.y);
  if (baLen === 0 || bcLen === 0) return null;
  const cos = Math.max(-1, Math.min(1, (ba.x * bc.x + ba.y * bc.y) / (baLen * bcLen)));
  return Math.acos(cos) * (180 / Math.PI);
}

function trunkForwardLean(
  shoulder: CleanedKeypoint | undefined,
  hip: CleanedKeypoint | undefined,
): number | null {
  if (!isValid(shoulder) || !isValid(hip)) return null;
  const dx = Math.abs(shoulder.x - hip.x);
  const dy = Math.abs(shoulder.y - hip.y);
  if (dy === 0) return 90;
  return Math.atan(dx / dy) * (180 / Math.PI);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function containsOrderedSequence(values: ExerciseStage[], sequence: ExerciseStage[]): boolean {
  let index = 0;
  for (const value of values) {
    if (value === sequence[index]) {
      index++;
      if (index === sequence.length) return true;
    }
  }
  return false;
}

function round2(v: number): number { return Math.round(v * 100) / 100; }
function round4(v: number): number { return Math.round(v * 10000) / 10000; }
function roundOptional(v: number | null): number | null { return v !== null ? round2(v) : null; }

// 单例
export const poseAlgorithmEngine = new PoseAlgorithmEngine();
