import { NextRequest, NextResponse } from 'next/server';

const DOUBAO_VOICE_BOT_URL = process.env.DOUBAO_VOICE_BOT_URL || 'https://320a02f4-5fad-4816-a1a8-37c1a4a92247.dev.coze.site/run';

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    // 调用豆包语音智能体
    const response = await fetch(DOUBAO_VOICE_BOT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: text.slice(0, 200) }],
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ error: '豆包语音智能体调用失败' }, { status: 500 });
    }

    const data = await response.json() as {
      messages: Array<{
        type: string;
        content: string;
        name?: string;
      }>;
    };

    // 从返回消息中提取语音 URL
    for (const msg of data.messages) {
      if (msg.type === 'tool' && msg.name === 'synthesize_speech' && msg.content) {
        return NextResponse.json({
          audioUrl: msg.content.trim(),
        });
      }
    }

    return NextResponse.json({ error: '未找到语音链接' }, { status: 500 });
  } catch (err) {
    console.error('[api/tts] error:', err);
    return NextResponse.json({ error: '语音合成失败' }, { status: 500 });
  }
}
