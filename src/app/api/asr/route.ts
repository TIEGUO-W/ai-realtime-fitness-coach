import { NextRequest, NextResponse } from 'next/server';
import { ASRClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { audioUrl, base64Data } = body;

    if (!audioUrl && !base64Data) {
      return NextResponse.json(
        { error: '需要 audioUrl 或 base64Data' },
        { status: 400 }
      );
    }

    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new ASRClient(config, customHeaders);

    const result = await client.recognize({
      uid: 'coach-user',
      ...(audioUrl ? { url: audioUrl } : { base64Data }),
    });

    console.log('[ASR] 识别结果:', result.text);
    return NextResponse.json({ text: result.text, duration: result.duration });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '语音识别失败';
    console.error('[ASR] 错误:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
