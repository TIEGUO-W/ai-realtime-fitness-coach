import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { readFile, unlink, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const AUDIO_DIR = path.join(process.cwd(), 'public', 'uploads', 'tts-audio');

export async function POST(request: NextRequest) {
  try {
    await mkdir(AUDIO_DIR, { recursive: true });

    const { text } = (await request.json()) as { text: string };
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const trimmed = text.slice(0, 200);
    const filename = `${randomUUID()}.mp3`;
    const outputPath = path.join(AUDIO_DIR, filename);

    // Use edge-tts Python package for local TTS
    await new Promise<void>((resolve, reject) => {
      const proc = spawn('python3', [
        '-c',
        `import asyncio, sys
async def main():
    import edge_tts
    tts = edge_tts.Communicate(sys.argv[1], 'zh-CN-XiaoxiaoNeural')
    await tts.save(sys.argv[2])
asyncio.run(main())`,
        trimmed,
        outputPath,
      ], { timeout: 15000 });

      let stderr = '';
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code !== 0) {
          reject(new Error(`edge-tts exit ${code}: ${stderr.slice(-200)}`));
        } else {
          resolve();
        }
      });
      proc.on('error', reject);
    });

    return NextResponse.json({
      audioUrl: `/uploads/tts-audio/${filename}`,
      mode: 'local-edge',
    });
  } catch (err) {
    console.error('[tts-local] error:', err);
    return NextResponse.json({ error: '语音合成失败' }, { status: 500 });
  }
}
