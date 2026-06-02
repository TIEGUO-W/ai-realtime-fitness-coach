import { NextResponse } from 'next/server';
import { access, readdir } from 'fs/promises';
import path from 'path';

const VIDEOS_DIR = path.join(process.cwd(), 'public', 'uploads', 'coach-videos');
const SKELETONS_DIR = path.join(process.cwd(), 'public', 'uploads', 'coach-skeletons');
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v']);

function titleFromFileName(fileName: string): string {
  const parsed = path.parse(fileName);
  return parsed.name.replace(/[-_]+/g, ' ').trim() || parsed.name;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const entries = await readdir(VIDEOS_DIR, { withFileTypes: true });
    const videos = await Promise.all(
      entries
        .filter(entry => entry.isFile())
        .filter(entry => VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
        .map(async entry => {
          const parsed = path.parse(entry.name);
          const recordingId = parsed.name;
          const hasSkeleton = await fileExists(path.join(SKELETONS_DIR, `${recordingId}.json`));
          return {
            recordingId,
            title: titleFromFileName(entry.name),
            coachVideoUrl: `/uploads/coach-videos/${encodeURIComponent(entry.name)}`,
            hasSkeleton,
          };
        }),
    );

    return NextResponse.json({ videos });
  } catch {
    return NextResponse.json({ videos: [] });
  }
}
