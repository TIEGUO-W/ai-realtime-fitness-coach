import { NextRequest, NextResponse } from 'next/server';
import { TTSClient, Config } from 'coze-coding-dev-sdk';

const DOUBAO_VOICE_BOT_URL = process.env.DOUBAO_VOICE_BOT_URL || 'https://320a02f4-5fad-4816-a1a8-37c1a4a92247.dev.coze.site/run';

// SDK TTSClient 作为备用（直接文本转语音，不过脑子）
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

    // mode=doubao: 让豆包智能体自己生成话术+语音（适合需要豆包自己说话的场景）
    // mode=direct 或默认: 直接把文本转语音，一字不差（适合规则引擎生成的话术）
    if (mode === 'doubao') {
      return await synthViaDoubaoBot(trimmed);
    } else {
      return await synthDirect(trimmed);
    }
  } catch (err) {
    console.error('[api/tts] error:', err);
    return NextResponse.json({ error: '语音合成失败' }, { status: 500 });
  }
}

/**
 * 方式1: 直接文本转语音（一字不差，低延迟）
 * 用 SDK TTSClient，音色可选
 */
async function synthDirect(text: string) {
  const client = getTTSClient();
  const result = await client.synthesize({
    uid: 'pose-coach',
    text,
    speaker: 'zh_female_xiaohe_uranus_bigtts', // 温柔女声
  });
  return NextResponse.json({
    audioUrl: result.audioUri,
    audioSize: result.audioSize,
    mode: 'direct',
  });
}

/**
 * 方式2: 通过豆包语音智能体（豆包自己理解+出话术+语音）
 * 延迟较高（~3秒），但更有豆包味
 */
async function synthViaDoubaoBot(text: string) {
  const response = await fetch(DOUBAO_VOICE_BOT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: text }],
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
}
