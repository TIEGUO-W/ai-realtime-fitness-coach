import { NextResponse } from 'next/server';
import { S3Storage } from 'coze-coding-dev-sdk';

const PRESET_PREFIX = 'presets/coach-videos/';

/** Human-readable titles for preset videos, keyed by the short id portion */
const PRESET_TITLES: Record<string, string> = {
  'pamela-12min-slim-legs': '帕梅拉 12分钟瘦腿训练',
  'pamela-10min-cardio-bottle': '帕梅拉 10分钟活力有氧+水瓶',
  'pamela-10min-abs-legs': '帕梅拉 10分钟站立瘦腹+纤腿',
  'pamela-15min-jumping-cardio': '帕梅拉 15分钟跳跃有氧',
  'zhouye-10min-standing-abs': '周六野 10分钟站立马甲线瘦腰',
};

function getShortId(key: string): string {
  // key like "presets/coach-videos/pamela-12min-slim-legs_44dc64f8.mp4"
  const fileName = key.split('/').pop() || '';
  const noExt = fileName.replace(/\.mp4$/, '');
  // Remove UUID suffix: "pamela-12min-slim-legs_44dc64f8" → "pamela-12min-slim-legs"
  return noExt.replace(/_[a-f0-9]{8}$/, '');
}

let storageInstance: S3Storage | null = null;
function getStorage(): S3Storage {
  if (!storageInstance) {
    storageInstance = new S3Storage({
      endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
      accessKey: '',
      secretKey: '',
      bucketName: process.env.COZE_BUCKET_NAME,
      region: 'cn-beijing',
    });
  }
  return storageInstance;
}

export async function GET() {
  try {
    const storage = getStorage();
    const result = await storage.listFiles({ prefix: PRESET_PREFIX, maxKeys: 50 });

    const videos = await Promise.all(
      result.keys.map(async (key) => {
        const shortId = getShortId(key);
        const title = PRESET_TITLES[shortId] || shortId;
        // Generate a presigned URL valid for 6 hours
        const coachVideoUrl = await storage.generatePresignedUrl({
          key,
          expireTime: 21600,
        });
        return {
          recordingId: shortId,
          title,
          coachVideoUrl,
          hasSkeleton: false,
        };
      }),
    );

    // Sort by defined title order
    const titleOrder = Object.keys(PRESET_TITLES);
    videos.sort((a, b) => titleOrder.indexOf(a.recordingId) - titleOrder.indexOf(b.recordingId));

    return NextResponse.json({ videos });
  } catch (err) {
    console.error('[presets] Failed to load from object storage:', err);
    return NextResponse.json({ videos: [] });
  }
}
