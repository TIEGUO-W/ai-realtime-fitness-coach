import { NextRequest, NextResponse } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

// HTTP 版教练分析 API（备用，WebSocket 不可用时使用）
export async function POST(request: NextRequest) {
  try {
    const { frames, exercise } = await request.json();

    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return NextResponse.json({ error: 'frames is required' }, { status: 400 });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    // 简化的骨架描述
    const latestFrame = frames[frames.length - 1];
    const landmarks = latestFrame.landmarks || [];

    const keyJoints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    const jointDesc = keyJoints
      .filter(i => landmarks[i] && landmarks[i].visibility > 0.5)
      .map(i => `j${i}:(${landmarks[i].x.toFixed(2)},${landmarks[i].y.toFixed(2)})`)
      .join(' ');

    const prompt = `你是运动教练。分析以下骨架数据，判断运动类型和动作质量，返回JSON：
{"exercise":"名称","quality":"good/warning/error","tips":["建议1"],"encouragement":"鼓励"}

运动: ${exercise || '自动识别'}
骨架: ${jointDesc}`;

    const response = await client.invoke(
      [{ role: 'user', content: prompt }],
      {
        model: 'doubao-seed-2-0-mini-260215',
        temperature: 0.3,
      },
    );

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({
        exercise: exercise || '未知',
        quality: 'warning',
        tips: ['分析中'],
        encouragement: '继续！',
      });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[api/coaching] error:', err);
    return NextResponse.json({ error: '分析失败' }, { status: 500 });
  }
}
