export interface MonsterModel {
  id: string;
  name: string;
  url: string;
  /** 0 = mild, 10 = maximum intensity */
  intensity: number;
}

export const MONSTER_MODELS: MonsterModel[] = [
  { id: 'orange',       name: '怪兽橙',   url: 'https://prod.spline.design/nrJ0KxfhMwCC5Ggi/scene.splinecode', intensity: 0 },
  { id: 'blue',         name: '怪兽蓝',   url: 'https://prod.spline.design/DxK6VB8BA22ezp4s/scene.splinecode', intensity: 1 },
  { id: 'green',        name: '怪兽绿',   url: 'https://prod.spline.design/4jabPUqZm8qC6udL/scene.splinecode', intensity: 2 },
  { id: 'purple',       name: '怪兽紫',   url: 'https://prod.spline.design/Iksy7KOHGBhVvP9L/scene.splinecode', intensity: 3 },
  { id: 'pink',         name: '粉红怪兽', url: 'https://prod.spline.design/kJnye6hI-JHR2jjJ/scene.splinecode', intensity: 4 }
];

/**
 * Compute a "danger intensity" score 0–10 from biometric + workout data.
 *   HR ratio < 0.6 → 0; at threshold → 5; ≥ 1.2× threshold → 8.
 *   Form-deform penalty: +2.
 */
export function computeIntensity(
  heartRate: number,
  hrThreshold: number,
  isFormDeformed: boolean,
): number {
  const hrRatio = heartRate / hrThreshold;
  const hrScore = Math.min(8, Math.max(0, (hrRatio - 0.6) * 12.5));
  const formPenalty = isFormDeformed ? 2 : 0;
  return Math.min(10, Math.round(hrScore + formPenalty));
}

/** Pick the model whose intensity is closest to the target. */
export function pickModel(intensity: number): MonsterModel {
  if (intensity <= 0) return MONSTER_MODELS[0];
  let best = MONSTER_MODELS[0];
  let bestDist = Math.abs(best.intensity - intensity);
  for (let i = 1; i < MONSTER_MODELS.length; i++) {
    const dist = Math.abs(MONSTER_MODELS[i].intensity - intensity);
    if (dist < bestDist) { bestDist = dist; best = MONSTER_MODELS[i]; }
  }
  return best;
}

/** Look up model by id; falls back to first model. */
export function getModelById(id: string): MonsterModel {
  return MONSTER_MODELS.find((m) => m.id === id) ?? MONSTER_MODELS[0];
}
