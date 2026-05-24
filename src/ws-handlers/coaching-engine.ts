import { LLMClient, Config } from 'coze-coding-dev-sdk';
import type { PoseBatchPayload, CoachingFeedback, Landmark } from '../lib/ws-client';

// 关键关节索引（MediaPipe Pose 33 landmarks）
const JOINT_NAMES: Record<number, string> = {
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

// 提取关键关节信息，减少 token 消耗
function extractKeyJoints(landmarks: Landmark[]): string {
  const result: string[] = [];
  for (const [idx, name] of Object.entries(JOINT_NAMES)) {
    const lm = landmarks[Number(idx)];
    if (lm && lm.visibility > 0.5) {
      result.push(`${name}:(${lm.x.toFixed(3)},${lm.y.toFixed(3)},${lm.z.toFixed(3)})`);
    }
  }
  return result.join(' ');
}

// 计算简单统计：关节角度、位置变化等
function computeSimpleMetrics(frames: Landmark[][]): string {
  if (frames.length < 2) return '数据不足，无法计算变化趋势';

  const first = frames[0];
  const last = frames[frames.length - 1];
  const changes: string[] = [];

  // 计算髋关节中点的纵向变化（用于深蹲等动作）
  const hipY_first = (first[23].y + first[24].y) / 2;
  const hipY_last = (last[23].y + last[24].y) / 2;
  const hipDelta = (hipY_last - hipY_first).toFixed(3);
  changes.push(`髋部纵向变化: ${hipDelta}`);

  // 计算膝盖角度变化
  const kneeAngle_first = computeAngle(first[23], first[25], first[27]); // 左腿
  const kneeAngle_last = computeAngle(last[23], last[25], last[27]);
  changes.push(`左膝角度: ${kneeAngle_first.toFixed(1)}° → ${kneeAngle_last.toFixed(1)}°`);

  // 计算肩部稳定性
  const shoulderSway = Math.abs(first[11].x - first[12].x - (last[11].x - last[12].x));
  changes.push(`肩部晃动: ${shoulderSway.toFixed(3)}`);

  return changes.join('; ');
}

function computeAngle(a: Landmark, b: Landmark, c: Landmark): number {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
  const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y);
  if (magBA === 0 || magBC === 0) return 0;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return Math.acos(cosAngle) * (180 / Math.PI);
}

const SYSTEM_PROMPT = `你是一位专业的实时运动教练 AI。你会收到用户的骨架关键点数据和简单运动指标，需要：

1. 判断用户正在做什么运动（深蹲、俯卧撑、硬拉、开合跳、平板支撑、弓步蹲、其他）
2. 评估动作质量（good/warning/error）
3. 给出具体的纠正建议（最多2条，简短有力）
4. 估计完成的次数（如果是计数类运动）
5. 给一句简短的鼓励（10字以内）

你必须以严格的 JSON 格式回复，不要有任何其他文字：
{
  "exercise": "运动名称",
  "repCount": 数字,
  "quality": "good" 或 "warning" 或 "error",
  "tips": ["建议1", "建议2"],
  "encouragement": "鼓励语"
}

注意：
- 坐标归一化到 0-1，y轴向下为正
- 如果数据不足以判断，给出最可能的估计
- quality 判断标准：good=动作标准, warning=轻微偏差, error=可能受伤风险
- tips 要具体到身体部位和调整方向，如"膝盖不要内扣，保持与脚尖同向"
- encouragement 要自然口语化`;

export async function analyzePose(batch: PoseBatchPayload): Promise<CoachingFeedback> {
  const keyFrames = batch.frames.slice(-5); // 只取最近5帧

  // 提取关键信息
  const frameDescriptions = keyFrames.map((f, i) => {
    const joints = extractKeyJoints(f.landmarks);
    return `帧${i + 1}: ${joints}`;
  });

  const metrics = computeSimpleMetrics(keyFrames.map(f => f.landmarks));

  const userMessage = `用户当前选择的运动: ${batch.exercise || '自动识别'}
时间窗口内帧数: ${batch.frames.length}
关键帧骨架数据:
${frameDescriptions.join('\n')}

简单指标: ${metrics}

请分析动作并给出教练反馈。`;

  try {
    const config = new Config();
    const client = new LLMClient(config);

    const response = await client.invoke(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      {
        model: 'doubao-seed-2-0-mini-260215', // 快速模型，低延迟
        temperature: 0.3,
        thinking: 'disabled',
      },
    );

    // 解析 LLM 返回的 JSON
    const content = response.content.trim();
    // 尝试提取 JSON（LLM 可能会包裹在 markdown 代码块中）
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fallbackFeedback(batch.exercise);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      exercise: parsed.exercise || '未知运动',
      repCount: Math.max(0, Number(parsed.repCount) || 0),
      quality: ['good', 'warning', 'error'].includes(parsed.quality)
        ? parsed.quality
        : 'warning',
      tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 2) : [],
      encouragement: parsed.encouragement || '继续加油！',
    };
  } catch (err) {
    console.error('[coaching-engine] LLM error:', err);
    return fallbackFeedback(batch.exercise);
  }
}

function fallbackFeedback(exercise?: string): CoachingFeedback {
  return {
    exercise: exercise || '未知运动',
    repCount: 0,
    quality: 'warning',
    tips: ['正在分析动作，请保持运动'],
    encouragement: '加油！',
  };
}
