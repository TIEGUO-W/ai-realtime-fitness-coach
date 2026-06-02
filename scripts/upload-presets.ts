/**
 * Upload preset coach videos to object storage.
 * Run: pnpm tsx scripts/upload-presets.ts
 */
import { S3Storage } from 'coze-coding-dev-sdk';
import { readdir, readFile } from 'fs/promises';
import path from 'path';

const VIDEOS_DIR = path.join(process.cwd(), 'public', 'uploads', 'coach-videos');
const PRESET_PREFIX = 'presets/coach-videos/';

const PRESET_TITLES: Record<string, string> = {
  'pamela-12min-slim-legs': '帕梅拉 12分钟瘦腿训练',
  'pamela-10min-cardio-bottle': '帕梅拉 10分钟活力有氧+水瓶',
  'pamela-10min-abs-legs': '帕梅拉 10分钟站立瘦腹+纤腿',
  'pamela-15min-jumping-cardio': '帕梅拉 15分钟跳跃有氧',
  'zhouye-10min-standing-abs': '周六野 10分钟站立马甲线瘦腰',
};

// Map Chinese filenames to simple keys
function fileToKey(fileName: string): string | null {
  if (fileName.includes('帕梅拉12') || fileName.includes('Pamela帕梅拉12')) {
    return `${PRESET_PREFIX}pamela-12min-slim-legs.mp4`;
  }
  if (fileName.includes('10分钟活力有氧')) {
    return `${PRESET_PREFIX}pamela-10min-cardio-bottle.mp4`;
  }
  if (fileName.includes('10分钟站立瘦腹')) {
    return `${PRESET_PREFIX}pamela-10min-abs-legs.mp4`;
  }
  if (fileName.includes('15分钟跳跃有氧')) {
    return `${PRESET_PREFIX}pamela-15min-jumping-cardio.mp4`;
  }
  if (fileName.includes('站立马甲线') || fileName.includes('周六野')) {
    return `${PRESET_PREFIX}zhouye-10min-standing-abs.mp4`;
  }
  return null;
}

async function main() {
  const storage = new S3Storage({
    endpointUrl: process.env.COZE_BUCKET_ENDPOINT_URL,
    accessKey: '',
    secretKey: '',
    bucketName: process.env.COZE_BUCKET_NAME,
    region: 'cn-beijing',
  });

  console.log('Reading videos from:', VIDEOS_DIR);
  const entries = await readdir(VIDEOS_DIR);

  const videoFiles = entries.filter(f => f.endsWith('.mp4'));
  console.log(`Found ${videoFiles.length} video files`);

  for (const file of videoFiles) {
    const key = fileToKey(file);
    if (!key) {
      console.log(`Skipping non-preset: ${file}`);
      continue;
    }

    const shortId = key.replace(PRESET_PREFIX, '').replace('.mp4', '');
    const title = PRESET_TITLES[shortId] || shortId;

    // Check if already uploaded
    const exists = await storage.fileExists({ fileKey: key });
    if (exists) {
      console.log(`Already exists: ${key} → ${title}`);
      continue;
    }

    console.log(`Uploading: ${file} → ${key} (${title})`);
    const filePath = path.join(VIDEOS_DIR, file);
    const fileContent = await readFile(filePath);

    const uploadedKey = await storage.uploadFile({
      fileContent,
      fileName: key,
      contentType: 'video/mp4',
    });

    console.log(`Uploaded: ${uploadedKey}`);
  }

  // Verify by listing
  console.log('\n--- Verifying uploads ---');
  const result = await storage.listFiles({ prefix: PRESET_PREFIX, maxKeys: 20 });
  console.log(`Found ${result.keys.length} preset videos in storage:`);
  for (const k of result.keys) {
    const shortId = k.replace(PRESET_PREFIX, '').replace('.mp4', '');
    const title = PRESET_TITLES[shortId] || shortId;
    console.log(`  ${k} → ${title}`);
  }
}

main().catch(err => {
  console.error('Upload failed:', err);
  process.exit(1);
});
