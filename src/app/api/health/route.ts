import { NextRequest, NextResponse } from 'next/server';
import {
  upsertHealth,
  getHealth,
  updateProfile,
  assessHeartRate,
  sleepAdvice,
  type HealthProfile,
} from '@/lib/health-store';

/** GET: 获取最新健康数据 */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId') || 'default';
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
    const body = await req.json();
    const sessionId = body.sessionId || body.session_id || 'default';

    // 支持多种心率字段名（兼容快捷指令的各种写法）
    const heartRate = body.heartRate ?? body.heart_rate ?? body.value ?? body.bpm ?? undefined;
    const restingHR = body.restingHeartRate ?? body.resting_heart_rate ?? undefined;
    const sleepHours = body.sleepHours ?? body.sleep_hours ?? body.sleepDuration ?? undefined;
    const sleepQuality = body.sleepQuality ?? body.sleep_quality ?? undefined;
    const heartRateRecovery = body.heartRateRecovery ?? body.heart_rate_recovery ?? body.hr_recovery ?? undefined;

    const updated = upsertHealth(sessionId, {
      heartRate: heartRate ? Number(heartRate) : undefined,
      restingHeartRate: restingHR ? Number(restingHR) : undefined,
      sleepHours: sleepHours ? Number(sleepHours) : undefined,
      sleepQuality: sleepQuality ?? undefined,
      heartRateRecovery: heartRateRecovery ? Number(heartRateRecovery) : undefined,
    });

    return NextResponse.json({ ok: true, health: updated });
  } catch (err) {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
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
