import { NextRequest, NextResponse } from 'next/server';
import { TTSClient, Config } from 'coze-coding-dev-sdk';

const DOUBAO_VOICE_BOT_URL = process.env.DOUBAO_VOICE_BOT_URL || 'https://320a02f4-5fad-4816-a1a8-37c1a4a92247.dev.coze.site/run';

// SDK TTSClient 降级备用（无豆包味，但低延迟）
let ttsClient: TTSClient | null = null;
function getTTSClient(): TTSClient {
  if (!ttsClient) {
    ttsClient = new TTSClient(new Config());
  }
  return ttsClient;
}

export async function POST(request: NextRequest) {
  try {
    const { text, mode } = await request.json() as { text: string; mode?: 'doubao' | 'direct' };

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const trimmed = text.slice(0, 200);

    // 默认用豆包语音智能体（豆包音色，带朗读前缀防止已读乱回）
    // mode=direct: SDK 直出，低延迟但无豆包味
    if (mode === 'direct') {
      return await synthDirect(trimmed);
    } else {
      return await synthViaDoubaoBot(trimmed);
    }
  } catch (err) {
    console.error('[api/tts] error:', err);
    return NextResponse.json({ error: '语音合成失败' }, { status: 500 });
  }
}

/**
 * 方式1（默认）: 豆包语音智能体 — 带豆包音色
 * 关键：加朗读前缀指令，防止智能体"已读乱回"
 */
async function synthViaDoubaoBot(text: string) {
  try {
    const response = await fetch(DOUBAO_VOICE_BOT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{
          role: 'user',
          content: `请一字不差地朗读以下文字，不要添加任何解释、评论或额外内容，只需原样读出：${text}`,
        }],
      }),
    });

    if (!response.ok) {
      // 降级到直接 TTS
      return await synthDirect(text);
    }

    const data = await response.json() as {
      messages: Array<{
        type: string;
        content: string;
        name?: string;
      }>;
    };

    // 提取语音 URL
    for (const msg of data.messages) {
      if (msg.type === 'tool' && msg.name === 'synthesize_speech' && msg.content) {
        return NextResponse.json({
          audioUrl: msg.content.trim(),
          mode: 'doubao',
        });
      }
    }

    // 没找到语音，降级到直接 TTS
    return await synthDirect(text);
  } catch {
    // 豆包智能体异常，降级
    return await synthDirect(text);
  }
}

/**
 * 方式2（降级）: SDK TTSClient 直出 — 低延迟但无豆包味
 */
async function synthDirect(text: string) {
  const client = getTTSClient();
  const result = await client.synthesize({
    uid: 'pose-coach',
    text,
    speaker: 'zh_female_xiaohe_uranus_bigtts',
  });
  return NextResponse.json({
    audioUrl: result.audioUri,
    audioSize: result.audioSize,
    mode: 'direct',
  });
}
