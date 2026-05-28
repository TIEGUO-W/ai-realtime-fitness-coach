/**
 * pose-algorithm v3 — 移植自 AI-fitness-coach Python 算法
 *
 * 核心改进（v2 → v3）：
 * 1. 骨架清洗：低置信度过滤 + EMA 插值补全 + 异常帧检测丢弃
 * 2. 左右半身自动选择：置信度+有效点数打分
 * 3. 更多角度：躯干前倾、身体直线、站距宽度、左右分角
 * 4. 6 种运动识别：深蹲/俯卧撑/弓步蹲/平板支撑/开合跳/高抬腿
 * 5. 精确质量评分：膝盖内扣、塌腰、浅蹲、动作过快、左右不平衡
 * 6. 自适应标定 + 双角度验证 + 时序确认（保留 v2 优势）
 */

import type { Landmark } from '../lib/ws-client';

// ─── 导出类型 ──────────────────────────────────────

export interface JointAngles {
  kneeAngle: number | null;
  hipAngle: number | null;
  trunkAngle: number | null;
  trunkForwardLean: number | null;
  leftKneeAngle: number | null;
  rightKneeAngle: number | null;
  leftHipAngle: number | null;
  rightHipAngle: number | null;
  leftElbowAngle: number | null;
  rightElbowAngle: number | null;
  leftShoulderAngle: number | null;
  rightShoulderAngle: number | null;
  bodyLineAngle: number | null;
  stanceWidth: number | null;
}

export interface QualityAssessment {
  qualityScore: number;
  errors: string[];
  warnings: string[];
}

export type ExerciseStage =
  | 'standing' | 'descending' | 'bottom' | 'ascending'
  | 'up' | 'holding' | 'open' | 'closed' | 'transition'
  | 'left_knee_up' | 'right_knee_up' | 'neutral'
  | 'unknown';

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

// ─── 内部类型 ──────────────────────────────────────

interface RawKP { x: number; y: number; confidence: number; }
interface CleanKP { x: number; y: number; confidence: number; valid: boolean; interpolated: boolean; }

interface CleaningResult {
  keypoints: Record<string, CleanKP>;
  selectedSide: 'left' | 'right' | 'unknown';
  droppedKeypoints: string[];
  interpolatedKeypoints: string[];
  abnormalFrame: boolean;
  confidenceMean: number;
}

// ─── 常量 ──────────────────────────────────────

const LOW_CONFIDENCE = 0.3;
const SMOOTHING_ALPHA = 0.45;
const SIDE_JOINTS = ['shoulder', 'hip', 'knee', 'ankle'] as const;
const CALIBRATION_FRAMES = 8;
const CONFIRM_FRAMES = 3;

const JOINT_MAP: Record<number, string> = {
  11: 'left_shoulder', 12: 'right_shoulder',
  13: 'left_elbow', 14: 'right_elbow',
  15: 'left_wrist', 16: 'right_wrist',
  23: 'left_hip', 24: 'right_hip',
  25: 'left_knee', 26: 'right_knee',
  27: 'left_ankle', 28: 'right_ankle',
};

// ─── 工具函数 ──────────────────────────────────

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

function r2(v: number | null): number | null { return v !== null ? Math.round(v * 100) / 100 : null; }

function avgDefined(...values: (number | null)[]): number | null {
  const defined = values.filter((v): v is number => v !== null);
  return defined.length > 0 ? defined.reduce((a, b) => a + b, 0) / defined.length : null;
}

function minDefined(...values: (number | null)[]): number | null {
  const defined = values.filter((v): v is number => v !== null);
  return defined.length > 0 ? Math.min(...defined) : null;
}

function midKP(keypoints: Record<string, CleanKP>, joint: string): CleanKP | null {
  const left = keypoints[`left_${joint}`];
  const right = keypoints[`right_${joint}`];
  const valid = [left, right].filter(isValid);
  if (valid.length === 0) return null;
  return {
    x: valid.reduce((s, p) => s + p.x, 0) / valid.length,
    y: valid.reduce((s, p) => s + p.y, 0) / valid.length,
    confidence: valid.reduce((s, p) => s + p.confidence, 0) / valid.length,
    valid: true,
    interpolated: false,
  };
}

function trunkForwardLean(shoulder: CleanKP | null, hip: CleanKP | null): number | null {
  if (!isValid(shoulder) || !isValid(hip)) return null;
  const dx = Math.abs(shoulder.x - hip.x);
  const dy = Math.abs(shoulder.y - hip.y);
  if (dy === 0) return 90;
  return Math.atan(dx / dy) * (180 / Math.PI);
}

function bodyLineAngle(keypoints: Record<string, CleanKP>): number | null {
  const shoulder = midKP(keypoints, 'shoulder');
  const hip = midKP(keypoints, 'hip');
  const ankle = midKP(keypoints, 'ankle');
  const a = calcAngle(shoulder ?? undefined, hip ?? undefined, ankle ?? undefined);
  return a !== null ? 180 - a : null;
}

function stanceWidthKp(keypoints: Record<string, CleanKP>): number | null {
  const left = keypoints.left_ankle;
  const right = keypoints.right_ankle;
  if (!isValid(left) || !isValid(right)) return null;
  return Math.abs(left.x - right.x);
}

function shoulderWidthKp(keypoints: Record<string, CleanKP>): number | null {
  const left = keypoints.left_shoulder;
  const right = keypoints.right_shoulder;
  if (!isValid(left) || !isValid(right)) return null;
  return Math.abs(left.x - right.x);
}

function handsAboveShoulders(keypoints: Record<string, CleanKP>): boolean {
  const lw = keypoints.left_wrist, rw = keypoints.right_wrist;
  const ls = keypoints.left_shoulder, rs = keypoints.right_shoulder;
  if (!isValid(lw) || !isValid(rw) || !isValid(ls) || !isValid(rs)) return false;
  // y 轴向下，所以 wrist.y < shoulder.y 表示手在肩上方
  return lw.y < ls.y && rw.y < rs.y;
}

function verticalLift(hip: CleanKP | undefined, knee: CleanKP | undefined): number | null {
  if (!isValid(hip) || !isValid(knee)) return null;
  return hip.y - knee.y;
}

function containsOrderedSequence(values: string[], sequence: string[]): boolean {
  let idx = 0;
  for (const v of values) {
    if (v === sequence[idx]) {
      idx++;
      if (idx === sequence.length) return true;
    }
  }
  return false;
}

// ─── 算法引擎 v3 ──────────────────────────────

export class PoseAlgorithmEngine {
  // 状态机（按运动分开）
  private states: Record<string, {
    previousKeypoints: Record<string, CleanKP>;
    previousStage: ExerciseStage;
    stagePath: string[];
    repCount: number;
    previousPrimary: number | null;
    lastPrimaryDelta: number | null;
    lastHighKneeSide: string | null;
    hadDownPhase: boolean;
    stageConfirmCount: number;
  }> = {};

  // 自适应标定（深蹲用）
  private calibrationSamples: number[] = [];
  private calibrated = false;
  private baselineKnee = 170;

  // 每运动独立标定
  private calibrations: Record<string, { samples: number[]; baseline: number; ready: boolean }> = {};

  private getCalibration(exercise: string) {
    if (!this.calibrations[exercise]) {
      this.calibrations[exercise] = { samples: [], baseline: 0, ready: false };
    }
    return this.calibrations[exercise];
  }

  // 深蹲标定用临时状态
  private pendingStage: ExerciseStage | null = null;
  private stageCounter = 0;

  reset(): void {
    this.states = {};
    this.calibrationSamples = [];
    this.calibrated = false;
    this.baselineKnee = 170;
    this.calibrations = {};
    this.pendingStage = null;
    this.stageCounter = 0;
  }

  private state(exercise: string) {
    if (!this.states[exercise]) {
      this.states[exercise] = {
        previousKeypoints: {},
        previousStage: 'unknown',
        stagePath: [],
        repCount: 0,
        previousPrimary: null,
        lastPrimaryDelta: null,
        lastHighKneeSide: null,
        hadDownPhase: false,
        stageConfirmCount: 0,
      };
    }
    return this.states[exercise];
  }

  // ── 主入口 ──────────────────────────────

  analyze(landmarks: Landmark[], exercise: string): AlgorithmResult {
    const st = this.state(exercise);

    // 1. 原始关节点
    const rawKps: Record<string, RawKP> = {};
    for (const [idx, name] of Object.entries(JOINT_MAP)) {
      const lm = landmarks[Number(idx)];
      if (lm) rawKps[name] = { x: lm.x, y: lm.y, confidence: lm.visibility ?? 0 };
    }

    // 2. 骨架清洗
    const cleaning = this.cleanPose(rawKps, st.previousKeypoints);
    if (!cleaning.abnormalFrame) {
      st.previousKeypoints = cleaning.keypoints;
    }

    // 3. 角度计算
    const angles = this.calculateAngles(cleaning);

    // 4. 阶段识别
    const { stage, primaryValue } = this.recognizeStage(exercise, angles, cleaning, st);

    // 5. 计数
    const completedRep = this.updateCounter(exercise, stage, st);

    // 6. 质量评分
    const quality = this.scoreQuality(exercise, cleaning, angles, stage, st);

    // 7. 更新状态
    if (stage !== 'unknown') st.previousStage = stage;
    if (primaryValue !== null) {
      const prev = st.previousPrimary;
      st.lastPrimaryDelta = prev !== null ? Math.abs(primaryValue - prev) : null;
      st.previousPrimary = primaryValue;
    }

    // 8. 前端特效
    const effect = this.determineEffect(quality.qualityScore, completedRep, stage);

    // 9. 构建结果
    const ctx = this.buildContext(exercise, stage, completedRep, cleaning, angles, quality, st.repCount);
    return {
      exercise, stage, repCount: st.repCount, completedRep,
      angles, quality, effect, algorithmContext: ctx,
    };
  }

  // ── 骨架清洗（移植自 Python） ──────────

  private cleanPose(
    raw: Record<string, RawKP>,
    previous: Record<string, CleanKP>,
  ): CleaningResult {
    const cleaned: Record<string, CleanKP> = {};
    const dropped: string[] = [];
    const interpolated: string[] = [];

    for (const [name, point] of Object.entries(raw)) {
      const prev = previous[name];
      if (point.confidence < LOW_CONFIDENCE) {
        dropped.push(name);
        if (prev && isValid(prev)) {
          cleaned[name] = { x: prev.x, y: prev.y, confidence: Math.round(prev.confidence * 0.6 * 10000) / 10000, valid: true, interpolated: true };
          interpolated.push(name);
        } else {
          cleaned[name] = { x: point.x, y: point.y, confidence: point.confidence, valid: false, interpolated: false };
        }
        continue;
      }

      // EMA 平滑
      let x = point.x, y = point.y;
      if (prev && isValid(prev)) {
        x = prev.x * (1 - SMOOTHING_ALPHA) + point.x * SMOOTHING_ALPHA;
        y = prev.y * (1 - SMOOTHING_ALPHA) + point.y * SMOOTHING_ALPHA;
      }
      cleaned[name] = { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000, confidence: Math.round(point.confidence * 10000) / 10000, valid: true, interpolated: false };
    }

    // 前一帧有但当前帧丢掉的 → 用上一帧衰减补全
    for (const [name, prev] of Object.entries(previous)) {
      if (name in cleaned || !isValid(prev)) continue;
      cleaned[name] = { x: prev.x, y: prev.y, confidence: Math.round(prev.confidence * 0.5 * 10000) / 10000, valid: true, interpolated: true };
      interpolated.push(name);
    }

    // 异常帧检测：所有关节突然大幅位移
    const abnormal = this.isAbnormalFrame(cleaned, previous);
    if (abnormal && Object.keys(previous).length > 0) {
      // 用上一帧替换
      for (const k of Object.keys(previous)) cleaned[k] = previous[k];
    }

    const validPoints = Object.values(cleaned).filter(isValid);
    const confMean = validPoints.length > 0
      ? Math.round(validPoints.reduce((s, p) => s + p.confidence, 0) / validPoints.length * 10000) / 10000
      : 0;

    return {
      keypoints: cleaned,
      selectedSide: this.selectSide(cleaned),
      droppedKeypoints: dropped,
      interpolatedKeypoints: interpolated,
      abnormalFrame: abnormal,
      confidenceMean: confMean,
    };
  }

  private isAbnormalFrame(cleaned: Record<string, CleanKP>, previous: Record<string, CleanKP>): boolean {
    if (Object.keys(previous).length === 0) return false;
    const movements: number[] = [];
    let maxCoord = 0;
    for (const [name, point] of Object.entries(cleaned)) {
      maxCoord = Math.max(maxCoord, Math.abs(point.x), Math.abs(point.y));
      const prev = previous[name];
      if (prev && isValid(prev) && isValid(point)) {
        movements.push(Math.hypot(point.x - prev.x, point.y - prev.y));
      }
    }
    if (movements.length < 3) return false;
    const bodyScale = this.bodyScale(cleaned);
    const threshold = maxCoord <= 2 ? 0.35 : Math.max(120, bodyScale * 0.6);
    // 中位数
    const sorted = [...movements].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return median > threshold;
  }

  private selectSide(keypoints: Record<string, CleanKP>): 'left' | 'right' | 'unknown' {
    const scores: Record<string, number> = { left: 0, right: 0 };
    for (const side of ['left', 'right'] as const) {
      for (const joint of SIDE_JOINTS) {
        const p = keypoints[`${side}_${joint}`];
        if (isValid(p)) {
          scores[side] += 2 + p.confidence;
        }
      }
    }
    if (scores.left === 0 && scores.right === 0) return 'unknown';
    return scores.left >= scores.right ? 'left' : 'right';
  }

  private bodyScale(keypoints: Record<string, CleanKP>): number {
    const distances: number[] = [];
    for (const side of ['left', 'right'] as const) {
      const shoulder = keypoints[`${side}_shoulder`];
      const hip = keypoints[`${side}_hip`];
      const knee = keypoints[`${side}_knee`];
      const ankle = keypoints[`${side}_ankle`];
      if (isValid(shoulder) && isValid(hip)) distances.push(Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y));
      if (isValid(hip) && isValid(knee)) distances.push(Math.hypot(hip.x - knee.x, hip.y - knee.y));
      if (isValid(knee) && isValid(ankle)) distances.push(Math.hypot(knee.x - ankle.x, knee.y - ankle.y));
    }
    return distances.length > 0 ? distances.reduce((a, b) => a + b, 0) : 100;
  }

  // ── 角度计算 ──────────────────────────────

  private calculateAngles(cleaning: CleaningResult): JointAngles {
    const kp = cleaning.keypoints;
    const side = cleaning.selectedSide;

    const lk = calcAngle(kp.left_hip, kp.left_knee, kp.left_ankle);
    const rk = calcAngle(kp.right_hip, kp.right_knee, kp.right_ankle);
    const lh = calcAngle(kp.left_shoulder, kp.left_hip, kp.left_knee);
    const rh = calcAngle(kp.right_shoulder, kp.right_hip, kp.right_knee);
    const le = calcAngle(kp.left_shoulder, kp.left_elbow, kp.left_wrist);
    const re = calcAngle(kp.right_shoulder, kp.right_elbow, kp.right_wrist);
    const ls = calcAngle(kp.left_elbow, kp.left_shoulder, kp.left_hip);
    const rs = calcAngle(kp.right_elbow, kp.right_shoulder, kp.right_hip);

    const sideShoulder = side !== 'unknown' ? kp[`${side}_shoulder`] : midKP(kp, 'shoulder');
    const sideHip = side !== 'unknown' ? kp[`${side}_hip`] : midKP(kp, 'hip');
    const sideAnkle = side !== 'unknown' ? kp[`${side}_ankle`] : midKP(kp, 'ankle');

    const shoulder = sideShoulder ?? undefined;
    const hip = sideHip ?? undefined;
    const ankle = sideAnkle ?? undefined;

    return {
      kneeAngle: r2(avgDefined(lk, rk)),
      hipAngle: r2(avgDefined(lh, rh)),
      trunkAngle: r2(calcAngle(shoulder, hip, ankle)),
      trunkForwardLean: r2(trunkForwardLean(sideShoulder ?? null, sideHip ?? null)),
      leftKneeAngle: r2(lk),
      rightKneeAngle: r2(rk),
      leftHipAngle: r2(lh),
      rightHipAngle: r2(rh),
      leftElbowAngle: r2(le),
      rightElbowAngle: r2(re),
      leftShoulderAngle: r2(ls),
      rightShoulderAngle: r2(rs),
      bodyLineAngle: r2(bodyLineAngle(kp)),
      stanceWidth: r2(stanceWidthKp(kp)),
    };
  }

  // ── 阶段识别 ──────────────────────────────

  private recognizeStage(
    exercise: string,
    angles: JointAngles,
    cleaning: CleaningResult,
    st: ReturnType<typeof this.state>,
  ): { stage: ExerciseStage; primaryValue: number | null } {
    switch (exercise) {
      case 'squat':
        return this.recognizeSquatStage(angles, cleaning, st);
      case 'push_up':
        return this.recognizeBendStage(
          avgDefined(angles.leftElbowAngle, angles.rightElbowAngle),
          st, 155, 95, 'up', 'bottom',
        );
      case 'lunge': {
        const frontKnee = minDefined(angles.leftKneeAngle, angles.rightKneeAngle);
        return this.recognizeBendStage(frontKnee, st, 160, 105);
      }
      case 'plank':
        return { stage: 'holding', primaryValue: angles.bodyLineAngle };
      case 'jumping_jack':
        return this.recognizeJumpingJack(cleaning, angles, st);
      case 'high_knees':
        return this.recognizeHighKnees(cleaning, st);
      default:
        // 未知运动用深蹲逻辑兜底
        return this.recognizeSquatStage(angles, cleaning, st);
    }
  }

  /** 深蹲：自适应标定 + 双角度验证 + 时序确认 */
  private recognizeSquatStage(
    angles: JointAngles,
    cleaning: CleaningResult,
    st: ReturnType<typeof this.state>,
  ): { stage: ExerciseStage; primaryValue: number | null } {
    const knee = angles.kneeAngle;
    const hip = angles.hipAngle;
    if (knee === null || hip === null) return { stage: 'unknown', primaryValue: null };

    // 自适应标定
    if (!this.calibrated) {
      this.calibrationSamples.push(knee);
      if (this.calibrationSamples.length >= CALIBRATION_FRAMES) {
        this.baselineKnee = Math.max(...this.calibrationSamples);
        this.calibrated = true;
        console.log(`[calibrated] baselineKnee=${this.baselineKnee.toFixed(1)}deg`);
      }
      return { stage: st.previousStage === 'unknown' ? 'standing' : st.previousStage, primaryValue: knee };
    }

    const bl = this.baselineKnee;
    const desc = bl * 0.85;
    const bot = bl * 0.65;
    const asc = bl * 0.72;
    const stand = bl * 0.90;

    // 方向判断
    const prevK = st.previousPrimary;
    let dir: 'down' | 'up' | 'none' = 'none';
    if (prevK !== null) {
      if (knee < prevK - 3) dir = 'down';
      else if (knee > prevK + 3) dir = 'up';
    }
    const hipMoving = prevK !== null && Math.abs(hip - (st.lastPrimaryDelta ?? 0)) > 2;

    const ps = st.previousStage;
    let ns: ExerciseStage = ps;

    if (ps === 'standing' || ps === 'unknown') {
      if (knee < desc && hipMoving && dir === 'down') ns = 'descending';
    } else if (ps === 'descending') {
      if (knee < bot) ns = 'bottom';
      else if (knee > stand) ns = 'standing';
    } else if (ps === 'bottom') {
      if (knee > asc && dir === 'up') ns = 'ascending';
    } else if (ps === 'ascending') {
      if (knee > stand && dir === 'up') ns = 'standing';
    }

    // 时序确认（不直接修改 st.previousStage，由 analyze() 统一管理）
    let confirmedStage: ExerciseStage = ps;
    if (ns !== this.pendingStage) {
      this.pendingStage = ns;
      this.stageCounter = 1;
    } else {
      this.stageCounter++;
    }
    if (this.stageCounter >= CONFIRM_FRAMES) {
      confirmedStage = ns;
      this.stageCounter = 0;
      this.pendingStage = null;
    }

    return { stage: confirmedStage, primaryValue: knee };
  }

  /** 通用弯曲阶段识别（俯卧撑/弓步蹲等） */
  private recognizeBendStage(
    value: number | null,
    st: ReturnType<typeof this.state>,
    high: number,
    low: number,
    highStage: ExerciseStage = 'standing',
    lowStage: ExerciseStage = 'bottom',
  ): { stage: ExerciseStage; primaryValue: number | null } {
    if (value === null) return { stage: 'unknown', primaryValue: null };
    if (value >= high) return { stage: highStage, primaryValue: value };
    if (value <= low) return { stage: lowStage, primaryValue: value };

    const prev = st.previousPrimary;
    const ps = st.previousStage;
    if (prev === null) return { stage: ps, primaryValue: value };
    if (value < prev - 4) return { stage: 'descending', primaryValue: value };
    if (value > prev + 4) return { stage: 'ascending', primaryValue: value };
    return { stage: ps, primaryValue: value };
  }

  /** 开合跳：自适应标定 + 双指标 + 时序确认（姿态快照策略） */
  private recognizeJumpingJack(
    cleaning: CleaningResult,
    angles: JointAngles,
    st: ReturnType<typeof this.state>,
  ): { stage: ExerciseStage; primaryValue: number | null } {
    const stance = angles.stanceWidth;
    const sw = shoulderWidthKp(cleaning.keypoints);
    const handsUp = handsAboveShoulders(cleaning.keypoints);
    if (stance === null || sw === null) return { stage: 'unknown', primaryValue: null };
    const ratio = stance / Math.max(sw, 0.0001);

    const cal = this.getCalibration('jumping_jack');

    // 自适应标定：前 8 帧在闭合姿态时采样站距/肩宽比
    if (!cal.ready) {
      // 只在手放下时采样（更可能是闭合姿态）
      if (!handsUp) {
        cal.samples.push(ratio);
        if (cal.samples.length >= CALIBRATION_FRAMES) {
          cal.baseline = cal.samples.reduce((a, b) => a + b, 0) / cal.samples.length;
          cal.ready = true;
          console.log(`[calibrated] jumping_jack baselineRatio=${cal.baseline.toFixed(3)}`);
        }
      }
      return { stage: 'closed', primaryValue: ratio };
    }

    const bl = cal.baseline;
    // open: 站距明显大于闭合基线 AND 手过头
    // closed: 站距接近基线 AND 手放下
    const openThreshold = bl * 1.35;
    const closedThreshold = bl * 1.12;

    const isOpen = ratio >= openThreshold && handsUp;
    const isClosed = ratio <= closedThreshold && !handsUp;

    let ns: ExerciseStage;
    if (isOpen) {
      ns = 'open';
    } else if (isClosed) {
      ns = 'closed';
    } else {
      ns = 'transition';
    }

    // 时序确认（防止快速运动中的抖动误判）
    return this.confirmStage(ns, st);
  }

  /** 时序确认：连续 CONFIRM_FRAMES 帧同一阶段才切换 */
  private confirmStage(
    newStage: ExerciseStage,
    st: ReturnType<typeof this.state>,
  ): { stage: ExerciseStage; primaryValue: number | null } {
    const ps = st.previousStage as string;
    const prevPending = (st as any)._pendingStage as string | undefined;

    if (newStage !== prevPending) {
      (st as any)._pendingStage = newStage;
      (st as any)._pendingCount = 1;
    } else {
      (st as any)._pendingCount = ((st as any)._pendingCount || 0) + 1;
    }

    if ((st as any)._pendingCount >= CONFIRM_FRAMES && newStage !== ps) {
      (st as any)._pendingCount = 0;
      (st as any)._pendingStage = undefined;
      return { stage: newStage, primaryValue: null };
    }

    return { stage: ps as ExerciseStage, primaryValue: null };
  }

  /** 高抬腿 */
  private recognizeHighKnees(
    cleaning: CleaningResult,
    st: ReturnType<typeof this.state>,
  ): { stage: ExerciseStage; primaryValue: number | null } {
    const kp = cleaning.keypoints;
    const leftLift = verticalLift(kp.left_hip, kp.left_knee);
    const rightLift = verticalLift(kp.right_hip, kp.right_knee);
    if (leftLift === null && rightLift === null) return { stage: 'unknown', primaryValue: null };
    if ((leftLift ?? 0) > 0.08 && (leftLift ?? 0) > (rightLift ?? 0)) return { stage: 'left_knee_up', primaryValue: leftLift };
    if ((rightLift ?? 0) > 0.08) return { stage: 'right_knee_up', primaryValue: rightLift };
    return { stage: 'neutral', primaryValue: Math.max(leftLift ?? 0, rightLift ?? 0) };
  }

  // ── 计数 ──────────────────────────────

  private updateCounter(exercise: string, stage: ExerciseStage, st: ReturnType<typeof this.state>): boolean {
    if (stage === 'unknown') return false;
    if (exercise === 'plank') return false; // 平板支撑不计次

    const stageChanged = stage !== st.previousStage;

    // 简化计数：回到"上"阶段 且 之前经过"下"阶段 = 完成一次
    const isUpStage = (s: ExerciseStage) =>
      s === 'standing' || s === 'ascending' || s === 'up' || s === 'closed' || s === 'neutral';
    const isDownStage = (s: ExerciseStage) =>
      s === 'descending' || s === 'bottom' || s === 'open' ||
      s === 'left_knee_up' || s === 'right_knee_up';

    let completed = false;

    if (exercise === 'high_knees') {
      // 高抬腿：左右交替算一次
      const currentSide = stage === 'left_knee_up' ? 'left' : stage === 'right_knee_up' ? 'right' : null;
      completed = currentSide !== null && st.lastHighKneeSide !== null && currentSide !== st.lastHighKneeSide;
      if (currentSide !== null) st.lastHighKneeSide = currentSide;
    } else {
      // 其他运动：down → up = 完成一次（直接基于阶段变化，无需额外防抖）
      if (isDownStage(stage)) {
        st.hadDownPhase = true;
      } else if (isUpStage(stage) && st.hadDownPhase && stageChanged) {
        completed = true;
        st.hadDownPhase = false;
      }
      // 从 up 阶段开始时重置 hadDownPhase（防止误触发）
      if (isUpStage(stage) && !st.hadDownPhase && stageChanged) {
        st.hadDownPhase = false;
      }
    }

    if (completed) {
      st.repCount += 1;
      st.hadDownPhase = false;
      console.log(`[${exercise}] REP #${st.repCount}! stage=${stage} prev=${st.previousStage}`);
    }
    return completed;
  }

  // ── 质量评分（移植自 Python） ──────────

  private scoreQuality(
    exercise: string,
    cleaning: CleaningResult,
    angles: JointAngles,
    stage: ExerciseStage,
    st: ReturnType<typeof this.state>,
  ): QualityAssessment {
    let score = 100;
    const errors: string[] = [];
    const warnings: string[] = [];
    const kp = cleaning.keypoints;

    // 膝盖内扣
    if ((exercise === 'squat' || exercise === 'lunge') && this.hasKneeInward(kp)) {
      score -= 20; errors.push('knee_inward');
    }

    // 深蹲看起来像坐着（可能是摄像头角度问题）
    if (exercise === 'squat' && this.looksSeated(kp)) {
      score -= 15; warnings.push('seated_or_camera_angle_unclear');
    }

    // 浅蹲/没到底就起来了
    if ((exercise === 'squat' || exercise === 'lunge') && this.shallowTurnaround(stage, st)) {
      score -= 15; errors.push('insufficient_depth');
    }

    // 躯干前倾过多
    if ((exercise === 'squat' || exercise === 'lunge') && angles.trunkForwardLean !== null && angles.trunkForwardLean > 35) {
      score -= 15; errors.push('back_leaning_forward');
    }

    // 俯卧撑塌腰
    if (exercise === 'push_up' && this.pushUpHipsSag(kp)) {
      score -= 20; errors.push('hips_sagging');
    }

    // 俯卧撑没到底
    if (exercise === 'push_up' && this.shallowTurnaround(stage, st)) {
      score -= 15; errors.push('insufficient_depth');
    }

    // 平板支撑身体不直
    if (exercise === 'plank' && angles.bodyLineAngle !== null && angles.bodyLineAngle > 18) {
      score -= 25; errors.push('body_line_not_straight');
    }

    // 开合跳专项质量
    if (exercise === 'jumping_jack') {
      const handsUp = handsAboveShoulders(kp);
      const stance = angles.stanceWidth;
      const sw = shoulderWidthKp(kp);
      const ratio = stance && sw ? stance / sw : 0;

      // 手臂没举过头
      if (stage === 'open' && !handsUp) {
        score -= 20; errors.push('arms_not_raised');
      }
      // 腿没分够（在 open 阶段站距不够宽）
      if (stage === 'open' && ratio > 0 && ratio < 1.3) {
        score -= 15; errors.push('legs_not_wide_enough');
      }
      // 闭合时手臂没放下
      if (stage === 'closed' && handsUp) {
        score -= 10; warnings.push('arms_not_down');
      }
      // 手脚不同步（过渡态持续太久 = 不协调）
      if (stage === 'transition') {
        score -= 15; warnings.push('not_synchronized');
      }
      // 动作幅度不够（open 阶段 ratio 太小，但排除过渡态抖动）
      if (stage === 'open' && ratio > 0 && ratio < 1.5) {
        score -= 10; warnings.push('limited_range');
      }
    }

    // 高抬腿没抬够
    if (exercise === 'high_knees' && stage === 'neutral') {
      score -= 10; warnings.push('knees_not_high_enough');
    }

    // 动作过快
    if ((st.lastPrimaryDelta ?? 0) > 28) {
      score -= 10; warnings.push('movement_too_fast');
    }

    // 左右不平衡
    if (this.isLeftRightUnbalanced(kp)) {
      score -= 10; warnings.push('left_right_unbalanced');
    }

    // 置信度低或异常帧
    if (cleaning.confidenceMean < 0.55 || cleaning.abnormalFrame) {
      score -= 10; warnings.push('low_keypoint_confidence');
    }

    return { qualityScore: Math.max(0, score), errors, warnings };
  }

  private hasKneeInward(kp: Record<string, CleanKP>): boolean {
    const results: boolean[] = [];
    for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
      const hip = kp[`${side}_hip`], knee = kp[`${side}_knee`], ankle = kp[`${side}_ankle`];
      if (!isValid(hip) || !isValid(knee) || !isValid(ankle)) continue;
      const hipAnkleX = (hip.x + ankle.x) / 2;
      results.push((knee.x - hipAnkleX) * sign > Math.abs(ankle.x - hip.x) * 0.35);
    }
    return results.some(Boolean);
  }

  private looksSeated(kp: Record<string, CleanKP>): boolean {
    const hip = midKP(kp, 'hip'), knee = midKP(kp, 'knee');
    const ankle = midKP(kp, 'ankle'), shoulder = midKP(kp, 'shoulder');
    if (!isValid(hip) || !isValid(knee) || !isValid(ankle) || !isValid(shoulder)) return false;
    const thighHorizontal = Math.abs(hip.y - knee.y) < Math.abs(knee.y - ankle.y) * 0.35;
    const lean = trunkForwardLean(shoulder, hip);
    const torsoUpright = lean !== null && lean < 15;
    return thighHorizontal && torsoUpright;
  }

  private shallowTurnaround(stage: ExerciseStage, st: ReturnType<typeof this.state>): boolean {
    return stage === 'ascending' && st.hadDownPhase && st.previousStage === 'descending';
  }

  private pushUpHipsSag(kp: Record<string, CleanKP>): boolean {
    const shoulder = midKP(kp, 'shoulder'), hip = midKP(kp, 'hip'), ankle = midKP(kp, 'ankle');
    if (!isValid(shoulder) || !isValid(hip) || !isValid(ankle)) return false;
    const lineY = (shoulder.y + ankle.y) / 2;
    return hip.y > lineY + Math.max(0.05, Math.abs(ankle.y - shoulder.y) * 0.25);
  }

  private isLeftRightUnbalanced(kp: Record<string, CleanKP>): boolean {
    const lh = kp.left_hip, rh = kp.right_hip, lk = kp.left_knee, rk = kp.right_knee;
    if (!isValid(lh) || !isValid(rh) || !isValid(lk) || !isValid(rk)) return false;
    const maxCoord = Math.max(lh.x + lh.y, rh.x + rh.y, lk.x + lk.y, rk.x + rk.y);
    const threshold = maxCoord <= 4 ? 0.05 : 35;
    return Math.abs((lk.y - lh.y) - (rk.y - rh.y)) > threshold;
  }

  // ── 前端特效 ──────────────────────────────

  private determineEffect(score: number, completedRep: boolean, stage: ExerciseStage): FrontendEffect {
    if (completedRep) {
      if (score >= 100) return 'perfect';
      if (score >= 90) return 'excellent';
      if (score >= 80) return 'good';
    }
    if (stage === 'bottom' && score < 60) return 'warning';
    if (score < 80 && (stage === 'descending' || stage === 'bottom')) return 'adjust';
    return null;
  }

  // ── 上下文 ──────────────────────────────

  private buildContext(
    exercise: string, stage: ExerciseStage, completedRep: boolean,
    cleaning: CleaningResult, angles: JointAngles, quality: QualityAssessment,
    reps: number,
  ): string {
    return [
      `Exercise: ${exercise}. Stage: ${stage}. Reps: ${reps}. Completed: ${completedRep}.`,
      `Side: ${cleaning.selectedSide}. Abnormal: ${cleaning.abnormalFrame}. ConfMean: ${cleaning.confidenceMean.toFixed(2)}.`,
      `Angles: knee=${angles.kneeAngle} hip=${angles.hipAngle} elbow=(${angles.leftElbowAngle},${angles.rightElbowAngle}) bodyLine=${angles.bodyLineAngle}.`,
      `Quality: ${quality.qualityScore}. Errors: ${quality.errors.join(',')}. Warnings: ${quality.warnings.join(',')}.`,
      `TrunkLean: ${angles.trunkForwardLean}. Stance: ${angles.stanceWidth}.`,
    ].join(' ');
  }
}
