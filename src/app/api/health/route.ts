import { NextRequest, NextResponse } from 'next/server';
import {
  upsertHealth,
  getHealth,
  updateProfile,
  assessHeartRate,
  sleepAdvice,
  type HealthProfile,
} from '@/lib/health-store';

type HealthUploadBody = Record<string, unknown>;

async function readHealthBody(req: NextRequest): Promise<HealthUploadBody> {
  const contentType = req.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    return req.json() as Promise<HealthUploadBody>;
  }

  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    return Object.fromEntries((await req.formData()).entries());
  }

  const text = (await req.text()).trim();
  if (!text) return {};

  try {
    return JSON.parse(text) as HealthUploadBody;
  } catch {
    return { heartRate: text, value: text };
  }
}

function pickNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function pickSleepQuality(value: unknown): 'poor' | 'fair' | 'good' | undefined {
  if (value === 'poor' || value === 'fair' || value === 'good') return value;
  return undefined;
}

/** GET: 获取最新健康数据 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')
    || req.nextUrl.searchParams.get('session_id')
    || 'default';
  const health = getHealth(sessionId);

  if (!health) {
    return NextResponse.json({ health: null, sessionId });
  }

  const safety = health.heartRate && health.profile?.age
    ? assessHeartRate(health.heartRate, health.profile.age)
    : null;

  const sleepTip = health.sleepQuality
    ? sleepAdvice(health.sleepQuality)
    : null;

  return NextResponse.json({
    health,
    sessionId,
    safety,
    sleepTip,
  });
}

/** POST: 接收健康数据（快捷指令/手动上传） */
export async function POST(req: NextRequest) {
  try {
    const body = await readHealthBody(req);
    // URL query param 优先于 body（快捷指令通过 URL 传 sessionId）
    const sessionId = req.nextUrl.searchParams.get('sessionId')
      || req.nextUrl.searchParams.get('session_id')
      || body.sessionId || body.session_id
      || 'default';

    // 支持多种心率字段名（兼容快捷指令的各种写法）
    const heartRate = body.heartRate ?? body.heart_rate ?? body.value ?? body.bpm ?? undefined;
    const restingHR = body.restingHeartRate ?? body.resting_heart_rate ?? undefined;
    const sleepHours = body.sleepHours ?? body.sleep_hours ?? body.sleepDuration ?? undefined;
    const sleepQuality = body.sleepQuality ?? body.sleep_quality ?? undefined;
    const heartRateRecovery = body.heartRateRecovery ?? body.heart_rate_recovery ?? body.hr_recovery ?? undefined;

    const updated = upsertHealth(String(sessionId), {
      heartRate: pickNumber(heartRate),
      restingHeartRate: pickNumber(restingHR),
      sleepHours: pickNumber(sleepHours),
      sleepQuality: pickSleepQuality(sleepQuality),
      heartRateRecovery: pickNumber(heartRateRecovery),
    });

    return NextResponse.json({ ok: true, health: updated });
  } catch (err) {
    return NextResponse.json({ ok: false, error: 'Invalid health payload' }, { status: 400 });
  }
}

/** PUT: 更新健康问卷档案 */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = body.sessionId || 'default';
    const profile: HealthProfile = {
      age: Number(body.age) || 25,
      fitnessLevel: body.fitnessLevel || 'intermediate',
      goal: body.goal || 'general',
      injuryHistory: Array.isArray(body.injuryHistory) ? body.injuryHistory : [],
      weight: body.weight ? Number(body.weight) : undefined,
      height: body.height ? Number(body.height) : undefined,
    };

    const updated = updateProfile(sessionId, profile);
    return NextResponse.json({ ok: true, health: updated });
  } catch (err) {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
}
