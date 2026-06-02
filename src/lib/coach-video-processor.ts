/**
 * 教练视频骨架提取处理器
 *
 * 流程: FFmpeg 拆帧 (5fps) → MediaPipe Pose 检测 → 存 JSON
 * 支持 Node.js 直调 MediaPipe WASM / Python subprocess 两种后端
 */

import { spawn, execFile } from 'child_process';
import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { Landmark } from '../lib/ws-client';

const SKELETONS_DIR = path.join(process.cwd(), 'public', 'uploads', 'coach-skeletons');
const EXTRACT_FPS = 5;
const MAX_FRAMES = EXTRACT_FPS * 60 * 30; // 30 分钟 @ 5fps = 9000 帧上限

// ─── 类型 ──────────────────────────────────────────

interface CoachFrame {
  frameIndex: number;
  timeMs: number;
  landmarks: Array<{ x: number; y: number; z: number; visibility: number }>;
}

interface CoachSkeletonData {
  recordingId: string;
  totalFrames: number;
  fps: number;
  frames: CoachFrame[];
  metadata: { durationMs: number; extractFps: number };
}

// ─── FFmpeg 工具 ───────────────────────────────────

function ffmpegAvailable(): Promise<boolean> {
  return new Promise(resolve => {
    execFile('ffmpeg', ['-version'], err => resolve(!err));
  });
}

async function getVideoDuration(videoPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', videoPath,
    ]);
    let stdout = '';
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.on('close', code => {
      const dur = parseFloat(stdout.trim());
      code === 0 && !isNaN(dur) ? resolve(dur * 1000) : reject(new Error('ffprobe failed'));
    });
    proc.on('error', reject);
  });
}

async function extractFrames(videoPath: string, outputDir: string): Promise<string[]> {
  const pattern = path.join(outputDir, 'frame_%06d.png');
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-i', videoPath,
      '-vf', `fps=${EXTRACT_FPS}`,
      '-frames:v', String(MAX_FRAMES),
      '-frame_pts', '1',
      pattern,
      '-y',
    ]);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) {
        reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-200)}`));
        return;
      }
      // Collect output files sorted by name
      const { readdirSync } = require('fs');
      const files = readdirSync(outputDir)
        .filter((f: string) => f.startsWith('frame_') && f.endsWith('.png'))
        .sort()
        .map((f: string) => path.join(outputDir, f));
      resolve(files);
    });
    proc.on('error', reject);
  });
}

// ─── Pose 检测后端 ─────────────────────────────────

type Detector = {
  detect: (imagePath: string) => Promise<Array<{ x: number; y: number; z: number; visibility: number }> | null>;
  dispose: () => Promise<void>;
};

/**
 * 创建 MediaPipe Pose 检测器（Node.js WASM 后端）
 */
async function createMediaPipeDetector(): Promise<Detector> {
  // Dynamic import — ESM-only package
  const { PoseLandmarker, FilesetResolver, DrawingUtils } = await import(
    '@mediapipe/tasks-vision'
  );

  const wasmPath = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
  const modelPath =
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

  const vision = await FilesetResolver.forVisionTasks(wasmPath);
  const landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelPath, delegate: 'CPU' },
    runningMode: 'IMAGE',
    numPoses: 1,
  });

  return {
    async detect(imagePath: string) {
      const buffer = await readFile(imagePath);
      // Convert to RGB raw pixels using sharp
      const { data, info } = await sharp(buffer)
        .resize(640, 480, { fit: 'inside' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const mpImage = {
        data: new Uint8Array(data),
        width: info.width,
        height: info.height,
        channels: info.channels, // 3 for RGB
      };

      const result = landmarker.detect(mpImage as unknown as Parameters<typeof landmarker.detect>[0]);
      if (!result.landmarks || result.landmarks.length === 0) return null;

      return result.landmarks[0].map(lm => ({
        x: lm.x / info.width,
        y: lm.y / info.height,
        z: lm.z / info.width,
        visibility: lm.visibility ?? 1,
      }));
    },
    async dispose() {
      landmarker.close();
    },
  };
}

/**
 * Python subprocess 降级检测器 — 通过 mediapipe Python 包
 * 批量处理：一次性传入所有帧路径，避免每帧启动进程的开销
 */
async function createPythonDetector(): Promise<Detector & { detectBatch: (paths: string[]) => Promise<(Landmark[] | null)[]> }> {
  return {
    async detect(_imagePath: string) {
      return null; // batch mode only
    },
    async detectBatch(imagePaths: string[]): Promise<(Landmark[] | null)[]> {
      // Write paths to temp file to avoid ENAMETOOLONG
      const tmpFile = imagePaths[0] + '_list.txt';
      await writeFile(tmpFile, imagePaths.join('\n'), 'utf-8');

      const script = `
import sys, json, os
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

list_file = sys.argv[1]
with open(list_file, 'r') as f:
    image_paths = [line.strip() for line in f if line.strip()]

# Use new Tasks API with local model file
model_path = os.path.join(os.path.dirname(list_file), '..', '..', '..', 'pose_landmarker_lite.task')
model_path = os.path.abspath(model_path)
base_options = mp_python.BaseOptions(model_asset_path=model_path)
options = vision.PoseLandmarkerOptions(
    base_options=base_options,
    running_mode=vision.RunningMode.IMAGE,
    num_poses=1,
    min_pose_detection_confidence=0.3,
    min_tracking_confidence=0.3,
)
detector = vision.PoseLandmarker.create_from_options(options)

results = []
total = len(image_paths)
for idx, img_path in enumerate(image_paths):
    img = cv2.imread(img_path)
    if img is None:
        results.append(None)
        continue
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    h, w = img.shape[:2]
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)
    result = detector.detect(mp_image)
    if not result.pose_landmarks:
        results.append(None)
        continue
    lms = [{"x": lm.x / w, "y": lm.y / h, "z": lm.z / w, "visibility": lm.visibility or 1.0}
           for lm in result.pose_landmarks[0]]
    results.append(lms)
    if idx % 100 == 0:
        print(f"PROGRESS:{idx}/{total}", flush=True)
detector.close()
os.remove(list_file)
print("__RESULT_START__")
print(json.dumps(results))
print("__RESULT_END__")
`;

      return new Promise((resolve, reject) => {
        const proc = spawn('python3', ['-c', script, tmpFile]);
        let stdout = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        let stderr = '';
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', code => {
          if (code !== 0) {
            console.error('[python-detector] stderr:', stderr.slice(-500));
            reject(new Error(`Python detector exit ${code}`));
            return;
          }
          try {
            const match = stdout.match(/__RESULT_START__\s*([\s\S]*?)\s*__RESULT_END__/);
            if (!match) { reject(new Error('Invalid python output format')); return; }
            const data = JSON.parse(match[1]);
            resolve(data);
          } catch (err) {
            console.error('[python-detector] parse error:', String(err).slice(0, 200));
            reject(err);
          }
        });
        proc.on('error', reject);
      });
    },
    async dispose() {},
  };
}

async function tryCreateDetector(): Promise<Detector> {
  try {
    return await createMediaPipeDetector();
  } catch (err) {
    console.warn('[coach-video-processor] MediaPipe WASM failed, trying Python:', err);
    try {
      return await createPythonDetector();
    } catch (err2) {
      throw new Error(
        `骨架提取不可用。请安装 mediapipe Python 包: pip install mediapipe opencv-python`,
      );
    }
  }
}

// ─── 主入口 ────────────────────────────────────────

export class CoachVideoProcessor {
  static async process(videoPath: string, recordingId: string): Promise<void> {
    const statusPath = path.join(SKELETONS_DIR, `${recordingId}.status.json`);
    const outputPath = path.join(SKELETONS_DIR, `${recordingId}.json`);
    const framesDir = path.join(SKELETONS_DIR, `${recordingId}_frames`);

    const updateStatus = async (status: string, progress: number) => {
      await writeFile(statusPath, JSON.stringify({ recordingId, status, progress }));
    };

    try {
      await updateStatus('checking_ffmpeg', 0);

      if (!(await ffmpegAvailable())) {
        await updateStatus('error', 0);
        throw new Error('未检测到 FFmpeg，请安装 FFmpeg 后再试');
      }

      // 检查视频时长
      const durationMs = await getVideoDuration(videoPath);
      if (durationMs > 30 * 60 * 1000) {
        await updateStatus('error', 0);
        throw new Error('视频时长超过 30 分钟上限');
      }

      await updateStatus('extracting_frames', 10);
      await mkdir(framesDir, { recursive: true });

      // 拆帧
      const frameFiles = await extractFrames(videoPath, framesDir);
      if (frameFiles.length === 0) {
        throw new Error('未能从视频中提取帧');
      }

      // 初始化检测器
      await updateStatus('loading_pose_model', 20);
      const detector = await tryCreateDetector();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const batchDetector = detector as any;

      // 逐帧/批量检测
      const frames: CoachFrame[] = [];
      const total = frameFiles.length;

      const hasBatch = typeof batchDetector.detectBatch === 'function';

      if (hasBatch) {
        // 批量模式：一次 Python 调用处理所有帧
        const results = await batchDetector.detectBatch(frameFiles);
        for (let i = 0; i < results.length; i++) {
          const landmarks = results[i];
          if (landmarks && landmarks.length >= 28) {
            frames.push({ frameIndex: i, timeMs: (i / EXTRACT_FPS) * 1000, landmarks });
          }
        }
        await updateStatus('detecting', 90);
      } else {
        // 单帧模式（WASM）
        for (let i = 0; i < total; i++) {
          try {
            const landmarks = await detector.detect(frameFiles[i]);
            if (landmarks && landmarks.length >= 28) {
              frames.push({ frameIndex: i, timeMs: (i / EXTRACT_FPS) * 1000, landmarks });
            }
          } catch { /* skip failed frames */ }
          if (i % Math.max(1, Math.floor(total / 10)) === 0) {
            const progress = 20 + Math.round((i / total) * 70);
            await updateStatus('detecting', progress);
          }
        }
      }

      await detector.dispose();

      // 清理临时帧文件
      await rm(framesDir, { recursive: true, force: true }).catch(() => {});

      // 帧间插值弥补丢失帧
      const interpolated = CoachVideoProcessor.interpolateMissing(frames);

      // 保存骨架数据
      const data: CoachSkeletonData = {
        recordingId,
        totalFrames: interpolated.length,
        fps: EXTRACT_FPS,
        frames: interpolated,
        metadata: { durationMs, extractFps: EXTRACT_FPS },
      };

      await writeFile(outputPath, JSON.stringify(data));
      await updateStatus('ready', 100);

      console.log(
        `[coach-video-processor] done: ${recordingId} — ${interpolated.length} frames (${total} raw, ${total - interpolated.length} interpolated)`,
      );
    } catch (err) {
      console.error('[coach-video-processor] failed:', err);
      const msg = err instanceof Error ? err.message : '未知错误';
      await updateStatus('error', 0);
      await writeFile(statusPath, JSON.stringify({ recordingId, status: 'error', error: msg }));
    }
  }

  /** 线性插值填补丢失的帧 */
  private static interpolateMissing(frames: CoachFrame[]): CoachFrame[] {
    if (frames.length <= 1) return frames;

    const result: CoachFrame[] = [];
    const maxGap = 3; // 最多补齐连续 3 帧

    for (let i = 0; i < frames.length; i++) {
      result.push(frames[i]);

      if (i < frames.length - 1) {
        const gap = frames[i + 1].frameIndex - frames[i].frameIndex;
        if (gap > 1 && gap <= maxGap) {
          // 在中间插入插值帧
          for (let g = 1; g < gap; g++) {
            const t = g / gap;
            const prev = frames[i].landmarks;
            const next = frames[i + 1].landmarks;
            const interp = prev.map((lm, idx) => ({
              x: lm.x + (next[idx].x - lm.x) * t,
              y: lm.y + (next[idx].y - lm.y) * t,
              z: lm.z + (next[idx].z - lm.z) * t,
              visibility: Math.min(lm.visibility, next[idx].visibility),
            }));
            result.push({
              frameIndex: frames[i].frameIndex + g,
              timeMs: frames[i].timeMs + (g / EXTRACT_FPS) * 1000,
              landmarks: interp,
            });
          }
        }
      }
    }

    return result;
  }
}
