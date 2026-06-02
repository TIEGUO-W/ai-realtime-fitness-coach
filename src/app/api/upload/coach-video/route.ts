import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const VIDEOS_DIR = path.join(PUBLIC_DIR, 'uploads', 'coach-videos');
const SKELETONS_DIR = path.join(PUBLIC_DIR, 'uploads', 'coach-skeletons');

const MAX_SIZE = 300 * 1024 * 1024; // 300MB
const MAX_DURATION_MS = 5 * 60 * 1000; // 5 分钟（MVP 限制）

export async function POST(request: NextRequest) {
  try {
    await mkdir(VIDEOS_DIR, { recursive: true });
    await mkdir(SKELETONS_DIR, { recursive: true });

    const formData = await request.formData();
    const file = formData.get('video') as File | null;

    if (!file) {
      return NextResponse.json({ error: '未找到视频文件' }, { status: 400 });
    }

    if (!file.type.startsWith('video/')) {
      return NextResponse.json({ error: '请上传视频文件' }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: '视频文件不能超过 200MB' }, { status: 400 });
    }

    const recordingId = crypto.randomUUID();
    const ext = file.name.split('.').pop() || 'mp4';
    const fileName = `${recordingId}.${ext}`;
    const videoPath = path.join(VIDEOS_DIR, fileName);

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(videoPath, buffer);

    // Write initial processing status
    const statusPath = path.join(SKELETONS_DIR, `${recordingId}.status.json`);
    await writeFile(statusPath, JSON.stringify({ status: 'processing', progress: 0 }));

    // Fire-and-forget skeleton extraction (non-blocking)
    import('@/lib/coach-video-processor')
      .then(({ CoachVideoProcessor }) => {
        CoachVideoProcessor.process(videoPath, recordingId).catch(err =>
          console.error('[upload] extraction failed:', err),
        );
      })
      .catch(err => console.error('[upload] failed to load processor:', err));

    return NextResponse.json({
      recordingId,
      coachVideoUrl: `/uploads/coach-videos/${fileName}`,
      status: 'processing',
      maxDuration: MAX_DURATION_MS,
      extractFps: 5,
    });
  } catch (err) {
    console.error('[upload/coach-video] error:', err);
    return NextResponse.json({ error: '上传失败' }, { status: 500 });
  }
}
