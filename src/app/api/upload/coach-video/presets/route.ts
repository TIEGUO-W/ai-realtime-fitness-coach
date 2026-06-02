import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

const VIDEOS_DIR = path.join(process.cwd(), 'public', 'uploads', 'coach-videos');

export async function GET() {
  try {
    if (!fs.existsSync(VIDEOS_DIR)) {
      return NextResponse.json({ videos: [] });
    }

    const files = fs.readdirSync(VIDEOS_DIR).filter(f => f.endsWith('.mp4'));

    const videos = files.map(filename => {
      const nameWithoutExt = filename.replace(/\.mp4$/, '');
      return {
        recordingId: nameWithoutExt,
        title: nameWithoutExt
          .replace(/-/g, ' ')
          .replace(/^(\w)/, (_, c) => c.toUpperCase()),
        coachVideoUrl: `/uploads/coach-videos/${filename}`,
        hasSkeleton: false,
      };
    });

    return NextResponse.json({ videos });
  } catch (err) {
    console.error('[presets] Error:', err);
    return NextResponse.json({ videos: [] });
  }
}
