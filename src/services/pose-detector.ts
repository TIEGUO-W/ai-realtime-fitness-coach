// 服务端骨架检测服务 — 使用 @mediapipe/tasks-vision

import { PoseLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import sharp from 'sharp';

let poseLandmarker: PoseLandmarker | null = null;
let initPromise: Promise<void> | null = null;

/** 初始化 MediaPipe PoseLandmarker（WASM，懒加载） */
async function ensureInit() {
  if (poseLandmarker) return;
  if (initPromise) { await initPromise; return; }

  initPromise = (async () => {
    console.log('[pose-detector] Initializing MediaPipe PoseLandmarker (WASM)...');
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
    );
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        // 模型文件本地托管在 /public/models/，同源访问无跨域延迟
        modelAssetPath: '/models/pose_landmarker_lite.task',
        delegate: 'CPU',
      },
      runningMode: 'IMAGE',
      numPoses: 1,
    });
    console.log('[pose-detector] PoseLandmarker ready');
  })();

  await initPromise;
}

export interface DetectedPose {
  landmarks: Array<{ x: number; y: number; z: number; visibility: number }>;
  worldLandmarks: Array<{ x: number; y: number; z: number; visibility: number }>;
  annotatedImage: Buffer; // JPEG with skeleton overlay
}

/** 从 JPEG Buffer 检测骨架 + 画骨架叠加图 */
export async function detectPoseFromJpeg(jpegBuffer: Buffer): Promise<DetectedPose | null> {
  await ensureInit();
  if (!poseLandmarker) return null;

  // 用 sharp 解码 JPEG → raw RGBA pixels
  const { data, info } = await sharp(jpegBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // 构建 ImageData-like 对象给 MediaPipe
  // MediaPipe tasks-vision 在 Node.js 下接受 { width, height, data } (RGBA Uint8ClampedArray)
  const imageData = {
    width,
    height,
    data: new Uint8ClampedArray(data),
  };

  const result = poseLandmarker.detect(imageData as unknown as HTMLCanvasElement);

  if (!result.landmarks || result.landmarks.length === 0) {
    return null;
  }

  const rawLandmarks = result.landmarks[0] as NormalizedLandmark[];
  const rawWorldLandmarks = result.worldLandmarks?.[0] as NormalizedLandmark[] | undefined;

  // 转换为统一格式
  const landmarks = rawLandmarks.map((lm: NormalizedLandmark) => ({
    x: lm.x,
    y: lm.y,
    z: lm.z,
    visibility: lm.visibility ?? 0,
  }));

  const worldLandmarks = rawWorldLandmarks
    ? rawWorldLandmarks.map((lm: NormalizedLandmark) => ({
        x: lm.x,
        y: lm.y,
        z: lm.z,
        visibility: lm.visibility ?? 0,
      }))
    : landmarks;

  // 用 sharp 在图像上画骨架线
  const annotatedImage = await drawSkeletonOnImage(jpegBuffer, landmarks, width, height);

  return { landmarks, worldLandmarks, annotatedImage };
}

// ─── 骨架连线定义（MediaPipe 33 landmarks） ──────────
const CONNECTIONS: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [15, 17], [16, 18], [15, 19],
  [16, 20], [17, 19], [18, 20], [27, 29], [28, 30],
  [29, 31], [30, 32], [27, 31], [28, 32],
];

/** 用 sharp SVG overlay 在原图上画骨架 */
async function drawSkeletonOnImage(
  jpegBuffer: Buffer,
  landmarks: Array<{ x: number; y: number; z: number; visibility: number }>,
  width: number,
  height: number,
): Promise<Buffer> {
  // 生成 SVG 骨架叠加层
  const visibleLandmarks = landmarks.filter(lm => lm.visibility > 0.5);
  const lines = CONNECTIONS
    .filter(([a, b]) => landmarks[a].visibility > 0.5 && landmarks[b].visibility > 0.5)
    .map(([a, b]) => {
      const ax = landmarks[a].x * width;
      const ay = landmarks[a].y * height;
      const bx = landmarks[b].x * width;
      const by = landmarks[b].y * height;
      return `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#22D3A7" stroke-width="3" stroke-linecap="round" opacity="0.9"/>`;
    });

  const dots = visibleLandmarks.map(lm => {
    const cx = lm.x * width;
    const cy = lm.y * height;
    return `<circle cx="${cx}" cy="${cy}" r="4" fill="#22D3A7" stroke="#0F1117" stroke-width="1"/>`;
  });

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${lines.join('')}${dots.join('')}</svg>`;

  // 用 sharp 合成：原图 + SVG overlay
  const annotated = await sharp(jpegBuffer)
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .jpeg({ quality: 75 })
    .toBuffer();

  return annotated;
}
