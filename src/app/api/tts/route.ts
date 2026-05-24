import { NextRequest, NextResponse } from 'next/server';
import { TTSClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

export async function POST(request: NextRequest) {
  try {
    const { text, speaker } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new TTSClient(config, customHeaders);

    const response = await client.synthesize({
      uid: 'coach-user',
      text: text.slice(0, 200), // 限制长度
      speaker: speaker || 'zh_male_m191_uranus_bigtts', // 男性教练音色
      audioFormat: 'mp3',
      sampleRate: 24000,
      speechRate: 10, // 稍快语速
    });

    return NextResponse.json({
      audioUrl: response.audioUri,
      audioSize: response.audioSize,
    });
  } catch (err) {
    console.error('[api/tts] error:', err);
    return NextResponse.json({ error: '语音合成失败' }, { status: 500 });
  }
}
