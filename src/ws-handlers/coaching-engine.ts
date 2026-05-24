/**
 * 教练推理引擎 — 规则算法先行 + LLM 辅助话术
 * 
 * 核心优化:
 * - 实时计数/阶段/质量 = 规则算法（毫秒级）
 * - 教练话术 = LLM（2-3秒一次，基于算法结果）
 * - 前端特效 = 规则算法直接触发（零延迟）
 */

import { LLMClient, Config } from 'coze-coding-dev-sdk';
import type { AlgorithmResult, FrontendEffect } from './pose-algorithm';

// ─── 类型 ──────────────────────────────────────

export interface CoachingFeedback {
  exercise: string;
  repCount: number;
  stage: string;
  quality: 'good' | 'warning' | 'error';
  effect: FrontendEffect;
  tips: string[];
  encouragement: string;
}

// 规则算法 → 错误代码中文映射
const ERROR_MESSAGES: Record<string, string> = {
  knee_inward: '膝盖内扣',
  insufficient_depth: '下蹲不够深',
  back_leaning_forward: '身体过度前倾',
};

const WARNING_MESSAGES: Record<string, string> = {
  movement_too_fast: '动作太快，控制节奏',
  left_right_unbalanced: '左右不对称',
  low_keypoint_confidence: '检测不稳定',
};

const STAGE_MESSAGES: Record<string, string> = {
  standing: '站立',
  descending: '下蹲中',
  bottom: '蹲到底了',
  ascending: '起身中',
  unknown: '准备中',
};

// ─── LLM 话术生成 ──────────────────────────────

const COACHING_PROMPT = `你是一位简短有力的运动教练。你会收到规则算法的结果，需要生成2条以内的纠正建议和1句8字以内的鼓励。

规则算法已经完成了：计数、阶段识别、角度计算、质量评分。
你只需要把算法结果翻译成人话。

必须以严格的 JSON 格式回复：
{
  "tips": ["建议1", "建议2"],
  "encouragement": "鼓励语"
}

规则：
- tips 最多2条，每条15字以内，要具体到身体部位
- encouragement 8字以内，口语化
- 如果质量分>=90，tips为空数组，只给鼓励
- 不要重复算法已经识别的内容，只给纠正建议`;

/**
 * 基于算法结果生成教练话术
 * 先用规则快速生成，再用 LLM 润色
 */
export async function generateCoaching(algorithmResult: AlgorithmResult): Promise<CoachingFeedback> {
  const { exercise, stage, repCount, quality, effect, algorithmContext } = algorithmResult;

  // 规则算法直接给出的结果（零延迟）
  const ruleBasedFeedback: CoachingFeedback = {
    exercise,
    repCount,
    stage: STAGE_MESSAGES[stage] || stage,
    quality: quality.qualityScore >= 85 ? 'good' : quality.qualityScore >= 60 ? 'warning' : 'error',
    effect,
    tips: [
      ...quality.errors.map((e) => ERROR_MESSAGES[e] || e),
      ...quality.warnings.map((w) => WARNING_MESSAGES[w] || w),
    ].slice(0, 2),
    encouragement: repCount > 0 ? `已完成${repCount}次！` : '继续！',
  };

  // 质量分 >= 90 且无错误 → 不需要调 LLM
  if (quality.qualityScore >= 90 && quality.errors.length === 0) {
    ruleBasedFeedback.tips = [];
    ruleBasedFeedback.encouragement = repCount > 0 ? '完美！继续保持' : '动作很标准！';
    return ruleBasedFeedback;
  }

  // 有错误或质量分不高 → 让 LLM 生成更有人味的话术
  try {
    const config = new Config();
    const client = new LLMClient(config);

    const response = await client.invoke(
      [
        { role: 'system', content: COACHING_PROMPT },
        { role: 'user', content: `算法结果: ${algorithmContext}` },
      ],
      {
        model: 'doubao-seed-2-0-mini-260215',
        temperature: 0.5,
        thinking: 'disabled',
      },
    );

    const content = response.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.tips)) {
        ruleBasedFeedback.tips = parsed.tips.slice(0, 2);
      }
      if (typeof parsed.encouragement === 'string') {
        ruleBasedFeedback.encouragement = parsed.encouragement;
      }
    }
  } catch (err) {
    console.error('[coaching-engine] LLM error, using rule-based fallback:', err);
  }

  return ruleBasedFeedback;
}
