import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

const SKELETONS_DIR = path.join(process.cwd(), 'public', 'uploads', 'coach-skeletons');

export async function GET(request: NextRequest) {
  const recordingId = request.nextUrl.searchParams.get('recordingId');
  if (!recordingId) {
    return NextResponse.json({ error: 'recordingId is required' }, { status: 400 });
  }

  // Sanitize: prevent path traversal
  if (!/^[a-f0-9-]{36}$/.test(recordingId)) {
    return NextResponse.json({ error: 'invalid recordingId' }, { status: 400 });
  }

  try {
    const statusPath = path.join(SKELETONS_DIR, `${recordingId}.status.json`);
    const raw = await readFile(statusPath, 'utf-8');
    const status = JSON.parse(raw);
    return NextResponse.json(status);
  } catch {
    // Check if skeleton data exists (extraction complete but status not updated)
    try {
      const skeletonPath = path.join(SKELETONS_DIR, `${recordingId}.json`);
      await readFile(skeletonPath);
      return NextResponse.json({ status: 'ready', progress: 100 });
    } catch {
      return NextResponse.json({ status: 'not_found' }, { status: 404 });
    }
  }
}
