import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const VIDEOS_DIR = path.join(PUBLIC_DIR, 'uploads', 'coach-videos');
const SKELETONS_DIR = path.join(PUBLIC_DIR, 'uploads', 'coach-skeletons');

const MAX_DURATION_SEC = 30 * 60; // 30 分钟上限

async function ytdlpAvailable(): Promise<boolean> {
  return new Promise(resolve => {
    const proc = spawn('yt-dlp', ['--version'], { stdio: 'ignore' });
    proc.on('close', code => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function getVideoInfo(url: string): Promise<{ duration: number; title: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', [
      '--no-playlist', '--dump-json', '--no-warnings', url,
    ]);
    let stdout = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) { reject(new Error('yt-dlp 无法解析此链接')); return; }
      try {
        const info = JSON.parse(stdout.trim().split('\n')[0]);
        resolve({ duration: info.duration ?? 0, title: info.title ?? '未知' });
      } catch { reject(new Error('链接解析失败')); }
    });
    proc.on('error', reject);
  });
}

async function downloadVideo(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 下载最佳质量并合并音频，限制 720p 以内保持处理速度
    const proc = spawn('yt-dlp', [
      '--no-playlist',
      '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
      '--merge-output-format', 'mp4',
      '--no-warnings',
      '-o', outputPath,
      url,
    ]);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`下载失败: ${stderr.slice(-200)}`));
        return;
      }
      resolve();
    });
    proc.on('error', reject);
  });
}

export async function POST(request: NextRequest) {
  try {
    await mkdir(VIDEOS_DIR, { recursive: true });
    await mkdir(SKELETONS_DIR, { recursive: true });

    if (!(await ytdlpAvailable())) {
      return NextResponse.json(
        { error: '服务端未安装 yt-dlp，请联系管理员' },
        { status: 500 },
      );
    }

    const { url } = (await request.json()) as { url: string };

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: '请提供视频链接' }, { status: 400 });
    }

    // 从粘贴内容中提取 URL（容错：用户可能粘贴了标题+链接）
    const urlMatch = url.match(/https?:\/\/[^\s)]+/);
    if (!urlMatch) {
      return NextResponse.json({ error: '未检测到有效链接' }, { status: 400 });
    }
    let cleanUrl = urlMatch[0];
    // 去掉追踪参数
    try {
      const u = new URL(cleanUrl);
      ['vd_source', 'si', 'spm_id_from', 'share_source', 'utm_source', 'utm_medium'].forEach(p => u.searchParams.delete(p));
      cleanUrl = u.toString();
    } catch { /* keep original */ }

    // 解析视频信息
    let info: { duration: number; title: string };
    try {
      info = await getVideoInfo(cleanUrl);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : '无法解析视频链接' },
        { status: 400 },
      );
    }

    if (info.duration > MAX_DURATION_SEC) {
      return NextResponse.json(
        { error: `视频时长 ${Math.round(info.duration / 60)} 分钟超过上限（30 分钟），请选择更短的视频` },
        { status: 400 },
      );
    }

    const recordingId = crypto.randomUUID();
    const videoPath = path.join(VIDEOS_DIR, `${recordingId}.mp4`);

    // Write initial status
    const statusPath = path.join(SKELETONS_DIR, `${recordingId}.status.json`);
    await writeFile(statusPath, JSON.stringify({ status: 'downloading', progress: 0, title: info.title }));

    // 下载视频（异步，不阻塞响应）
    downloadVideo(cleanUrl, videoPath)
      .then(async () => {
        // Update status: downloading → processing
        await writeFile(statusPath, JSON.stringify({ status: 'processing', progress: 10, title: info.title }));

        // Launch skeleton extraction
        const { CoachVideoProcessor } = await import('@/lib/coach-video-processor');
        return CoachVideoProcessor.process(videoPath, recordingId);
      })
      .catch(async err => {
        console.error('[coach-video-link] processing failed:', err);
        await writeFile(
          statusPath,
          JSON.stringify({
            status: 'error',
            error: err instanceof Error ? err.message : '处理失败',
            title: info.title,
          }),
        );
      });

    return NextResponse.json({
      recordingId,
      coachVideoUrl: `/uploads/coach-videos/${recordingId}.mp4`,
      status: 'downloading',
      title: info.title,
      duration: info.duration,
    });
  } catch (err) {
    console.error('[coach-video-link] error:', err);
    return NextResponse.json({ error: '请求失败' }, { status: 500 });
  }
}
