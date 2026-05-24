/**
 * pose-algorithm v2 —— 自适应阈值 + 双角度验证 + 时序滤波
 *
 * 核心改进：
 * 1. 自适应基准：首次检测到人后，自动标定站立角度
 * 2. 双角度验证：深蹲 = 膝盖 AND 髋部同时弯，挥手不会误触发
 * 3. 时序确认：每个状态必须持续 N 帧才生效，消除抖动
 * 4. 方向锁：下降→底部→上升→站立 必须按序走完，中途折返不计
 */

import type { Landmark } from '../lib/ws-client';

// ─── 类型（与原始 pose-algorithm.ts 兼容） ─────────────────

export interface JointAngles {
  kneeAngle: number | null;
  hipAngle: number | null;
  trunkAngle: number | null;
  trunkForwardLean: number | null;
  elbowAngle: number | null;
  shoulderAngle: number | null;
  ankleAngle: number | null;
}

export interface QualityAssessment {
  qualityScore: number;
  errors: string[];
  warnings: string[];
}

export type ExerciseStage = 'standing' | 'descending' | 'bottom' | 'ascending' | 'unknown';
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

// ─── 常量 ──────────────────────────────────────

const CALIBRATION_FRAMES = 8;       // 标定需要的帧数
const STATE_CONFIRM_FRAMES = 3;     // 状态需要连持多少帧才生效
const SMOOTHING_ALPHA = 0.4;
const LOW_CONFIDENCE_THRESHOLD = 0.3;

// 各运动的自适应阈值比例
interface AdaptiveConfig {
  /** 深蹲：膝盖弯曲到站立的 65% 算降，到 50% 算底 */
  descendingPercent: number;   // 低于此百分比 → descending
  bottomPercent: number;       // 低于此百分比 → bottom
  ascendingPercent: number;    // 高于此百分比 → ascending（从底部回升）
  upPercent: number;           // 高于此百分比 → standing（回到顶点）
}

const SQUAT_CONFIG: AdaptiveConfig = {
  descendingPercent: 0.85,     // 膝盖弯到站立的 85% 以下开始计数
  bottomPercent: 0.65,         // 膝盖弯到站立的 65% 以下到底部
  ascendingPercent: 0.72,      // 回升到 72% 以上
  upPercent: 0.90,             // 恢复到 90% 以上算完成一次
};

// ─── 骨架工具 ──────────────────────────────────

const JOINT_MAP: Record<number, string> = {
  11: 'left_shoulder', 12: 'right_shoulder',
  13: 'left_elbow', 14: 'right_elbow',
  15: 'left_wrist', 16: 'right_wrist',
  23: 'left_hip', 24: 'right_hip',
  25: 'left_knee', 26: 'right_knee',
  27: 'left_ankle', 28: 'right_ankle',
};

interface RawKP { x: number; y: number; confidence: number; }
interface CleanKP { x: number; y: number; confidence: number; valid: boolean; interpolated: boolean; }

function isValid(p?: CleanKP | null): p is CleanKP { return p != null && p.valid; }

function calcAngle(a: CleanKP | undefined, b: CleanKP | undefined, c: CleanKP | undefined): number | null {
  if (!isValid(a) || !isValid(b) || !isValid(c)) return null;
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const baLen = Math.hypot(ba.x, ba.y);
  const bcLen = Math.hypot(bc.x, bc.y);
  if (baLen === 0 || bcLen === 0) return null;
  const cos = Math.max(-1, Math.min(1, (ba.x * bc.x + ba.y * bc.y) / (baLen * bcLen)));
  return Math.acos(cos) * (180 / Math.PI);
}

function r2(v: number): number { return Math.round(v * 100) / 100; }

// ─── 算法引擎 v2 ──────────────────────────────

export class PoseAlgorithmEngine {
  // 自适应标定
  private calibrationSamples: number[] = [];
  private calibrated = false;
  private baselineKnee = 170;   // 默认站立膝盖角度
  private baselineHip = 170;    // 默认站立髋部角度

  // 缓变量
  private emaKnee = 170;
  private emaHip = 170;
  private previousKeypoints: Record<string, CleanKP> = {};

  // 状态机
  private stage: ExerciseStage = 'unknown';
  private stageCounter = 0;
  private repCount = 0;
  private lastBottomKnee = 0;
  private hasBottom = false;
  private direction: 'down' | 'up' | 'none' = 'none';

  // 前一帧角度用于方向判断
  private prevKnee = 0;
  private prevHip = 0;

  reset(): void {
    this.calibrationSamples = [];
    this.calibrated = false;
    this.baselineKnee = 170;
    this.baselineHip = 170;
    this.emaKnee = 170;
    this.emaHip = 170;
    this.stage = 'unknown';
    this.stageCounter = 0;
    this.repCount = 0;
    this.lastBottomKnee = 0;
    this.hasBottom = false;
    this.direction = 'none';
  }

  analyze(landmarks: Landmark[], exercise: string): AlgorithmResult {
    const angles = this.extractAngles(landmarks);
    const knee = angles.kneeAngle;
    const hip = angles.hipAngle;

    if (knee === null || hip === null) {
      return this.buildResult(exercise, 'unknown', angles);
    }

    // EMA 平滑
    this.emaKnee = this.emaKnee * (1 - SMOOTHING_ALPHA) + knee * SMOOTHING_ALPHA;
    this.emaHip = this.emaHip * (1 - SMOOTHING_ALPHA) + hip * SMOOTHING_ALPHA;

    const k = this.emaKnee;
    const h = this.emaHip;

    // ── 自适应标定 ──
    if (!this.calibrated) {
      this.calibrationSamples.push(k);
      if (this.calibrationSamples.length >= CALIBRATION_FRAMES) {
        // 取最大值作为站立基准
        this.baselineKnee = Math.max(...this.calibrationSamples);
        this.baselineHip = 170;  // hip 用固定基准（相对稳定）
        this.calibrated = true;
        console.log(`[calibrated] baselineKnee=${this.baselineKnee.toFixed(1)}deg`);
      }
      return this.buildResult(exercise, this.stage, angles);
    }

    // ── 自适应阈值计算 ──
    const cfg = SQUAT_CONFIG;
    const thresh = {
      descending: this.baselineKnee * cfg.descendingPercent,
      bottom: this.baselineKnee * cfg.bottomPercent,
      ascending: this.baselineKnee * cfg.ascendingPercent,
      standing: this.baselineKnee * cfg.upPercent,
    };

    // 方向判断
    if (k < this.prevKnee - 3) this.direction = 'down';
    else if (k > this.prevKnee + 3) this.direction = 'up';
    const directionChanged = this.prevKnee > 0 && this.direction !== 'none'
      && Math.abs(k - this.prevKnee) > 3;

    // ── 双角度验证：膝盖 AND 髋部必须同时变化 ──
    // 挥手时膝盖可能微动，但髋部不动 → 不触发
    const hipMoving = Math.abs(h - this.prevHip) > 2;

    let newStage: ExerciseStage = this.stage;

    if (this.stage === 'standing' || this.stage === 'unknown') {
      // 下降开始：膝盖低于下降阈值 AND 髋部也有变化 AND 方向向下
      if (k < thresh.descending && (h < this.baselineHip * 0.92 || hipMoving) && this.direction === 'down') {
        newStage = 'descending';
      }
    } else if (this.stage === 'descending') {
      // 到底部：膝盖低于底部阈值
      if (k < thresh.bottom) {
        newStage = 'bottom';
        this.hasBottom = true;
        this.lastBottomKnee = k;
      } else if (k > thresh.standing) {
        // 没到底就站起来了 → 半蹲不算，回到站立
        newStage = 'standing';
      }
    } else if (this.stage === 'bottom') {
      // 开始上升
      if (k > thresh.ascending && this.direction === 'up') {
        newStage = 'ascending';
      }
    } else if (this.stage === 'ascending') {
      // 完成：回到站立
      if (k > thresh.standing && this.hasBottom && this.direction === 'up') {
        newStage = 'standing';
        // 确认是完整深蹲：经过了 bottom，深度足够
        if (this.lastBottomKnee < thresh.bottom * 1.05) {
          this.repCount += 1;
          console.log(`[squat] REP #${this.repCount}! bottom=${this.lastBottomKnee.toFixed(0)}deg`);
        }
        this.hasBottom = false;
        this.lastBottomKnee = 0;
      }
    }

    // ── 时序确认：新状态必须持续 N 帧才生效 ──
    if (newStage !== this.stage) {
      this.stageCounter += 1;
      if (this.stageCounter >= STATE_CONFIRM_FRAMES) {
        this.stage = newStage;
        this.stageCounter = 0;
      }
    } else {
      this.stageCounter = Math.max(0, this.stageCounter - 1);
    }

    this.prevKnee = k;
    this.prevHip = h;

    // 质量评分
    const quality = this.scoreQuality(k, h, this.stage);

    return this.buildResult(exercise, this.stage, angles, quality);
  }

  private extractAngles(landmarks: Landmark[]): JointAngles {
    const raw: Record<string, RawKP> = {};
    for (const [idx, name] of Object.entries(JOINT_MAP)) {
      const lm = landmarks[Number(idx)];
      if (lm) raw[name] = { x: lm.x, y: lm.y, confidence: lm.visibility ?? 0 };
    }

    // 选优侧
    const side = this.selectSide(raw);
    if (side === 'unknown') {
      return { kneeAngle: null, hipAngle: null, trunkAngle: null,
               trunkForwardLean: null, elbowAngle: null, shoulderAngle: null, ankleAngle: null };
    }

    const toClean = (p?: RawKP): CleanKP | undefined => {
      if (!p || p.confidence < LOW_CONFIDENCE_THRESHOLD) return undefined;
      return { x: p.x, y: p.y, confidence: p.confidence, valid: true, interpolated: false };
    };

    const sh = toClean(raw[`${side}_shoulder`]);
    const hi = toClean(raw[`${side}_hip`]);
    const kn = toClean(raw[`${side}_knee`]);
    const an = toClean(raw[`${side}_ankle`]);
    const el = toClean(raw[`${side}_elbow`]);
    const wr = toClean(raw[`${side}_wrist`]);

    const trunkLean = (sh && hi) ? r2(Math.atan(Math.abs(sh.x - hi.x) / Math.max(Math.abs(sh.y - hi.y), 0.001)) * 180 / Math.PI) : null;

    return {
      kneeAngle: calcAngle(hi, kn, an) !== null ? r2(calcAngle(hi, kn, an)!) : null,
      hipAngle: calcAngle(sh, hi, kn) !== null ? r2(calcAngle(sh, hi, kn)!) : null,
      trunkAngle: null,
      trunkForwardLean: trunkLean,
      elbowAngle: calcAngle(sh, el, wr) !== null ? r2(calcAngle(sh, el, wr)!) : null,
      shoulderAngle: null,
      ankleAngle: null,
    };
  }

  private selectSide(raw: Record<string, RawKP>): 'left' | 'right' | 'unknown' {
    let leftScore = 0, rightScore = 0;
    for (const j of ['shoulder', 'hip', 'knee', 'ankle']) {
      const l = raw[`left_${j}`], r = raw[`right_${j}`];
      if (l && l.confidence > LOW_CONFIDENCE_THRESHOLD) leftScore++;
      if (r && r.confidence > LOW_CONFIDENCE_THRESHOLD) rightScore++;
    }
    if (leftScore === 0 && rightScore === 0) return 'unknown';
    return leftScore >= rightScore ? 'left' : 'right';
  }

  private scoreQuality(knee: number, hip: number, stage: ExerciseStage): QualityAssessment {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (stage === 'bottom' && knee > this.baselineKnee * 0.75) {
      errors.push('squat_too_shallow');
    }
    if (stage === 'descending' && knee > this.baselineKnee * 0.80 && knee < this.baselineKnee * 0.90) {
      warnings.push('not_deep_enough');
    }

    const score = Math.max(20, 100 - errors.length * 20 - warnings.length * 8);
    return { qualityScore: score, errors, warnings };
  }

  private buildResult(
    exercise: string, stage: ExerciseStage, angles: JointAngles,
    quality?: QualityAssessment,
  ): AlgorithmResult {
    const q = quality ?? { qualityScore: 100, errors: [], warnings: [] };
    return {
      exercise, stage, repCount: this.repCount,
      completedRep: false, angles, quality: q,
      effect: stage === 'ascending' ? 'good' : null,
      algorithmContext: `squat: ${this.repCount} reps, stage=${stage}, knee=${angles.kneeAngle}deg, hip=${angles.hipAngle}deg, baseline=${this.baselineKnee.toFixed(0)}deg`,
    };
  }
}
