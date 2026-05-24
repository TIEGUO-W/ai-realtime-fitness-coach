/**
 * 规则算法引擎 — 骨架清洗 + 关节角度 + 状态机计数 + 质量评分
 * 参考: serene-WJ/AI- algorithm_service.py
 * 
 * 核心思路: 规则算法毫秒级实时处理，LLM 只负责话术生成
 * 支持7种运动: 深蹲/硬拉/俯卧撑/弓步蹲/平板支撑/高抬腿/开合跳
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
  elbowAngle: number | null;
  shoulderAngle: number | null;
  ankleAngle: number | null;
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

export type ExerciseStage = 'standing' | 'descending' | 'bottom' | 'ascending' | 'unknown'
  | 'arms_up' | 'arms_down' | 'legs_together' | 'legs_apart' | 'plank_hold' | 'plank_sagging';

export type FrontendEffect = 'perfect' | 'excellent' | 'good' | 'adjust' | 'warning' | null;

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

// ─── 运动类型定义 ──────────────────────────────

type ExerciseType = 'squat' | 'deadlift' | 'pushup' | 'lunge' | 'plank' | 'high_knees' | 'jumping_jack';

interface ExerciseConfig {
  name: string;
  primaryAngle: keyof JointAngles;
  /** 主要角度的阈值：从哪个阶段到哪个阶段 */
  thresholds: { up: number; down: number };
  /** 完整动作需要的状态序列 */
  repSequence: ExerciseStage[];
  /** 质量检查项 */
  qualityChecks: string[];
}

const EXERCISE_CONFIGS: Record<ExerciseType, ExerciseConfig> = {
  squat: {
    name: '深蹲',
    primaryAngle: 'kneeAngle',
    thresholds: { up: 160, down: 110 },
    repSequence: ['standing', 'descending', 'bottom', 'ascending', 'standing'],
    qualityChecks: ['knee_inward', 'insufficient_depth', 'back_leaning_forward', 'too_fast', 'left_right_unbalanced'],
  },
  deadlift: {
    name: '硬拉',
    primaryAngle: 'hipAngle',
    thresholds: { up: 170, down: 90 },
    repSequence: ['standing', 'descending', 'bottom', 'ascending', 'standing'],
    qualityChecks: ['back_rounding', 'bar_distance', 'too_fast', 'left_right_unbalanced'],
  },
  pushup: {
    name: '俯卧撑',
    primaryAngle: 'elbowAngle',
    thresholds: { up: 160, down: 90 },
    repSequence: ['standing', 'descending', 'bottom', 'ascending', 'standing'],
    qualityChecks: ['body_not_straight', 'insufficient_depth', 'too_fast', 'left_right_unbalanced'],
  },
  lunge: {
    name: '弓步蹲',
    primaryAngle: 'kneeAngle',
    thresholds: { up: 160, down: 95 },
    repSequence: ['standing', 'descending', 'bottom', 'ascending', 'standing'],
    qualityChecks: ['knee_over_toe', 'back_leaning_forward', 'too_fast', 'left_right_unbalanced'],
  },
  plank: {
    name: '平板支撑',
    primaryAngle: 'trunkForwardLean',
    thresholds: { up: 20, down: 0 },
    repSequence: [],
    qualityChecks: ['body_not_straight', 'hip_sagging', 'left_right_unbalanced'],
  },
  high_knees: {
    name: '高抬腿',
    primaryAngle: 'hipAngle',
    thresholds: { up: 150, down: 90 },
    repSequence: ['standing', 'descending', 'bottom', 'ascending', 'standing'],
    qualityChecks: ['insufficient_height', 'too_fast', 'left_right_unbalanced'],
  },
  jumping_jack: {
    name: '开合跳',
    primaryAngle: 'shoulderAngle',
    thresholds: { up: 140, down: 40 },
    repSequence: ['legs_together', 'legs_apart', 'legs_together'],
    qualityChecks: ['insufficient_arm_raise', 'too_fast', 'left_right_unbalanced'],
  },
};

// ─── 常量 ──────────────────────────────────────

const LOW_CONFIDENCE_THRESHOLD = 0.3;
const SMOOTHING_ALPHA = 0.45;
const SIDE_JOINTS = ['shoulder', 'hip', 'knee', 'ankle'] as const;

// MediaPipe Pose 33 关键点 → 命名映射（扩展版）
const JOINT_MAP: Record<number, string> = {
  0: 'nose',
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
  private previousPrimaryAngle: number | null = null;
  private lastAngleDelta: number | null = null;
  private previousStage: ExerciseStage = 'unknown';
  private stagePath: ExerciseStage[] = [];
  private repCount = 0;
  private plankHoldStart: number | null = null;
  private plankHoldSeconds = 0;
  private jumpingJackState: 'together' | 'apart' = 'together';

  reset(): void {
    this.previousKeypoints = {};
    this.previousPrimaryAngle = null;
    this.lastAngleDelta = null;
    this.previousStage = 'unknown';
    this.stagePath = [];
    this.repCount = 0;
    this.plankHoldStart = null;
    this.plankHoldSeconds = 0;
    this.jumpingJackState = 'together';
  }

  analyze(landmarks: Landmark[], exercise: string): AlgorithmResult {
    const config = EXERCISE_CONFIGS[exercise as ExerciseType] ?? EXERCISE_CONFIGS.squat;
    const rawKeypoints = this.landmarksToNamedKeypoints(landmarks);
    const cleaning = this.cleanPose(rawKeypoints);
    const angles = this.calculateAngles(cleaning);
    const stage = this.recognizeStage(angles, config);
    const completedRep = this.updateCounter(stage, config);
    const quality = this.scoreQuality(cleaning, angles, stage, config);
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

  // ─── 角度计算（全运动支持） ──────────────────

  private calculateAngles(cleaning: PoseCleaningResult): JointAngles {
    const side = cleaning.selectedSide;
    if (side === 'unknown') {
      return {
        kneeAngle: null, hipAngle: null, trunkAngle: null,
        trunkForwardLean: null, elbowAngle: null, shoulderAngle: null, ankleAngle: null,
      };
    }

    const kp = cleaning.keypoints;
    const shoulder = kp[`${side}_shoulder`];
    const hip = kp[`${side}_hip`];
    const knee = kp[`${side}_knee`];
    const ankle = kp[`${side}_ankle`];
    const elbow = kp[`${side}_elbow`];
    const wrist = kp[`${side}_wrist`];
    const otherShoulder = kp[side === 'left' ? 'right_shoulder' : 'left_shoulder'];
    const otherHip = kp[side === 'left' ? 'right_hip' : 'right_hip'];

    return {
      kneeAngle: roundOptional(angle(hip, knee, ankle)),
      hipAngle: roundOptional(angle(shoulder, hip, knee)),
      trunkAngle: roundOptional(angle(shoulder, hip, ankle)),
      trunkForwardLean: roundOptional(trunkForwardLean(shoulder, hip)),
      elbowAngle: roundOptional(angle(shoulder, elbow, wrist)),
      shoulderAngle: roundOptional(angle(otherHip, shoulder, elbow)),
      ankleAngle: roundOptional(angle(knee, ankle, { 
        x: ankle.x, y: ankle.y + 0.1, confidence: 1, valid: true, interpolated: false 
      })),
    };
  }

  // ─── 多运动阶段识别 ──────────────────────────

  private recognizeStage(angles: JointAngles, config: ExerciseConfig): ExerciseStage {
    const primaryAngle = angles[config.primaryAngle];

    if (config.repSequence.length === 0) {
      // 无状态序列的运动（如平板支撑）— 用独立逻辑
      return this.recognizePlankStage(angles);
    }

    // 开合跳特殊逻辑
    if (config === EXERCISE_CONFIGS.jumping_jack) {
      return this.recognizeJumpingJackStage(angles);
    }

    // 通用角度状态机（深蹲/硬拉/俯卧撑/弓步蹲/高抬腿）
    return this.recognizeGenericStage(primaryAngle, config.thresholds);
  }

  private recognizeGenericStage(
    primaryAngle: number | null,
    thresholds: { up: number; down: number },
  ): ExerciseStage {
    if (primaryAngle === null) return 'unknown';

    const previousAngle = this.previousPrimaryAngle;
    this.lastAngleDelta = previousAngle !== null ? Math.abs(primaryAngle - previousAngle) : null;
    this.previousPrimaryAngle = primaryAngle;

    if (primaryAngle >= thresholds.up) return 'standing';
    if (primaryAngle <= thresholds.down) return 'bottom';
    if (previousAngle === null) return 'unknown';
    if (primaryAngle < previousAngle - 4) return 'descending';
    if (primaryAngle > previousAngle + 4) return 'ascending';
    return this.previousStage;
  }

  private recognizePlankStage(angles: JointAngles): ExerciseStage {
    // 平板支撑: 用躯干前倾角 + 髋角判断
    const { trunkForwardLean, hipAngle } = angles;

    if (trunkForwardLean === null) return 'unknown';

    // 正常平板: 躯干近乎水平(前倾角 < 25°), 髋角 ~180°
    if (trunkForwardLean < 25 && (hipAngle === null || hipAngle > 150)) {
      if (this.plankHoldStart === null) {
        this.plankHoldStart = Date.now();
      }
      this.plankHoldSeconds = (Date.now() - this.plankHoldStart) / 1000;
      return 'plank_hold';
    }

    // 塌腰: 躯干前倾变大或髋角变小
    if (trunkForwardLean > 30 || (hipAngle !== null && hipAngle < 140)) {
      this.plankHoldStart = null;
      return 'plank_sagging';
    }

    return this.previousStage === 'unknown' ? 'plank_hold' : this.previousStage;
  }

  private recognizeJumpingJackStage(angles: JointAngles): ExerciseStage {
    // 开合跳: 用肩角 + 两脚踝距离判断
    const { shoulderAngle } = angles;
    const kp = this.previousKeypoints;
    const leftAnkle = kp.left_ankle;
    const rightAnkle = kp.right_ankle;

    if (shoulderAngle === null) return 'unknown';

    const armsUp = shoulderAngle > 100;
    let legsApart = false;
    if (isValid(leftAnkle) && isValid(rightAnkle)) {
      legsApart = Math.abs(leftAnkle.x - rightAnkle.x) > 0.25;
    }

    if (armsUp && legsApart) {
      this.jumpingJackState = 'apart';
      return 'legs_apart';
    }
    if (!armsUp && !legsApart) {
      if (this.jumpingJackState === 'apart') {
        this.jumpingJackState = 'together';
        return 'legs_together';
      }
      return 'legs_together';
    }

    return this.previousStage;
  }

  // ─── 状态机计数 ─────────────────────────────

  private updateCounter(stage: ExerciseStage, config: ExerciseConfig): boolean {
    if (stage === 'unknown') return false;

    // 平板支撑: 持续计时，不算次数
    if (config === EXERCISE_CONFIGS.plank) {
      return false;
    }

    if (stage !== this.previousStage) {
      this.stagePath.push(stage);
      this.stagePath = this.stagePath.slice(-8);
    }

    const sequence = config.repSequence;
    if (sequence.length === 0) return false;

    // 检查是否完成了完整序列
    // 序列首尾相同（如 standing → ... → standing），需要检测回到起始状态
    const startStage = sequence[0];
    const endStage = sequence[sequence.length - 1];

    let completed = false;
    if (stage === endStage && this.previousStage !== endStage) {
      completed = containsOrderedSequence(this.stagePath, sequence);
      if (completed) {
        this.repCount += 1;
        this.stagePath = [endStage];
      }
    }

    this.previousStage = stage;
    return completed;
  }

  // ─── 质量评分（多运动） ──────────────────────

  private scoreQuality(
    cleaning: PoseCleaningResult,
    angles: JointAngles,
    stage: ExerciseStage,
    config: ExerciseConfig,
  ): QualityAssessment {
    let score = 100;
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const check of config.qualityChecks) {
      const result = this.runQualityCheck(check, cleaning, angles, stage);
      if (result.penalty > 0) {
        score -= result.penalty;
        if (result.severity === 'error') {
          errors.push(check);
        } else {
          warnings.push(check);
        }
      }
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

  private runQualityCheck(
    check: string,
    cleaning: PoseCleaningResult,
    angles: JointAngles,
    stage: ExerciseStage,
  ): { penalty: number; severity: 'error' | 'warning' } {
    switch (check) {
      case 'knee_inward':
        return this.hasKneeInward(cleaning)
          ? { penalty: 20, severity: 'error' }
          : { penalty: 0, severity: 'warning' };

      case 'insufficient_depth': {
        const shallowTurnaround =
          stage === 'ascending' &&
          this.stagePath.includes('descending') &&
          !this.stagePath.includes('bottom');
        return shallowTurnaround
          ? { penalty: 15, severity: 'error' }
          : { penalty: 0, severity: 'warning' };
      }

      case 'back_leaning_forward':
        return (angles.trunkForwardLean !== null && angles.trunkForwardLean > 35)
          ? { penalty: 15, severity: 'error' }
          : { penalty: 0, severity: 'warning' };

      case 'too_fast':
        return this.isTooFast()
          ? { penalty: 10, severity: 'warning' }
          : { penalty: 0, severity: 'warning' };

      case 'left_right_unbalanced':
        return this.isLeftRightUnbalanced(cleaning)
          ? { penalty: 10, severity: 'warning' }
          : { penalty: 0, severity: 'warning' };

      case 'back_rounding':
        // 硬拉: 躯干前倾过大
        return (angles.trunkForwardLean !== null && angles.trunkForwardLean > 45)
          ? { penalty: 20, severity: 'error' }
          : { penalty: 0, severity: 'warning' };

      case 'bar_distance':
        // 硬拉: 杠铃离身体太远（肩前倾指标）
        return (angles.trunkForwardLean !== null && angles.trunkForwardLean > 40)
          ? { penalty: 15, severity: 'warning' }
          : { penalty: 0, severity: 'warning' };

      case 'body_not_straight': {
        // 俯卧撑/平板: 身体不成一条直线
        const { trunkForwardLean, hipAngle } = angles;
        const isNotStraight =
          (trunkForwardLean !== null && (trunkForwardLean < 5 || trunkForwardLean > 35)) ||
          (hipAngle !== null && (hipAngle < 140 || hipAngle > 200));
        return isNotStraight
          ? { penalty: 20, severity: 'error' }
          : { penalty: 0, severity: 'warning' };
      }

      case 'hip_sagging':
        // 平板: 塌腰
        return stage === 'plank_sagging'
          ? { penalty: 25, severity: 'error' }
          : { penalty: 0, severity: 'warning' };

      case 'knee_over_toe':
        // 弓步蹲: 前膝超过脚尖
        return this.isKneeOverToe(cleaning)
          ? { penalty: 15, severity: 'warning' }
          : { penalty: 0, severity: 'warning' };

      case 'insufficient_height':
        // 高抬腿: 抬腿不够高
        return (angles.hipAngle !== null && angles.hipAngle > 110)
          ? { penalty: 15, severity: 'warning' }
          : { penalty: 0, severity: 'warning' };

      case 'insufficient_arm_raise':
        // 开合跳: 手臂没举过头顶
        return (angles.shoulderAngle !== null && angles.shoulderAngle < 120)
          ? { penalty: 15, severity: 'warning' }
          : { penalty: 0, severity: 'warning' };

      default:
        return { penalty: 0, severity: 'warning' };
    }
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

  private isKneeOverToe(cleaning: PoseCleaningResult): boolean {
    const side = cleaning.selectedSide;
    if (side === 'unknown') return false;
    const knee = cleaning.keypoints[`${side}_knee`];
    const ankle = cleaning.keypoints[`${side}_ankle`];
    if (!isValid(knee) || !isValid(ankle)) return false;
    // 膝盖 x 坐标超过脚踝 x 坐标（考虑方向）
    return Math.abs(knee.x - ankle.x) > 0.08;
  }

  private isTooFast(): boolean {
    if (this.lastAngleDelta === null) return false;
    return this.lastAngleDelta > 28;
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
    if (quality.errors.length > 0 && !completedRep) return 'adjust';
    if (!completedRep) return null;
    if (quality.qualityScore >= 95) return 'perfect';
    if (quality.qualityScore >= 85) return 'excellent';
    if (quality.qualityScore >= 70) return 'good';
    return 'adjust';
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
    const config = EXERCISE_CONFIGS[exercise as ExerciseType];
    const exerciseName = config?.name ?? exercise;

    const extra: string[] = [];
    // 平板支撑额外信息
    if (exercise === 'plank' && this.plankHoldSeconds > 0) {
      extra.push(`坚持时间: ${this.plankHoldSeconds.toFixed(1)}秒.`);
    }

    const lines = [
      `运动: ${exerciseName}. 阶段: ${stage}. 次数: ${this.repCount}. 完成一次: ${completedRep}.`,
      `选择侧: ${cleaning.selectedSide}. 异常帧: ${cleaning.abnormalFrame}.`,
      `角度: 膝=${angles.kneeAngle}° 髋=${angles.hipAngle}° 躯干=${angles.trunkAngle}° 前倾=${angles.trunkForwardLean}° 肘=${angles.elbowAngle}° 肩=${angles.shoulderAngle}°.`,
      `质量分: ${quality.qualityScore}. 错误: [${quality.errors.join(',')}]. 警告: [${quality.warnings.join(',')}].`,
    ];
    if (extra.length > 0) lines.push(...extra);
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
