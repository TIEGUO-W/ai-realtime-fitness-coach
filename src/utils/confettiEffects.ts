import confetti from 'canvas-confetti';

/**
 * High-score celebration — score > 85.
 * Flowers and clapping emoji burst from bottom corners upward.
 * Duration ~1.5s.
 */
export function triggerHighScore() {
  const flower = confetti.shapeFromText({ text: '🌸', scalar: 3 });
  const clap = confetti.shapeFromText({ text: '👏', scalar: 3 });
  const star = confetti.shapeFromText({ text: '⭐', scalar: 2.5 });

  // Left-bottom burst
  confetti({
    particleCount: 25,
    spread: 60,
    startVelocity: 50,
    angle: 60,
    origin: { x: 0, y: 1 },
    shapes: [flower, star],
    scalar: 1,
    ticks: 120,
    gravity: 0.8,
    decay: 0.94,
    zIndex: 200,
    colors: ['#ff69b4', '#ffb6c1', '#ff1493'],
  });

  // Right-bottom burst
  confetti({
    particleCount: 25,
    spread: 60,
    startVelocity: 50,
    angle: 120,
    origin: { x: 1, y: 1 },
    shapes: [clap, star],
    scalar: 1,
    ticks: 120,
    gravity: 0.8,
    decay: 0.94,
    zIndex: 200,
    colors: ['#ffd700', '#ffa500', '#ffff00'],
  });

  // Small delay — second wave
  setTimeout(() => {
    confetti({
      particleCount: 15,
      spread: 90,
      startVelocity: 35,
      angle: 90,
      origin: { x: 0.15, y: 0.95 },
      shapes: [flower, clap],
      scalar: 0.8,
      ticks: 100,
      gravity: 0.6,
      decay: 0.92,
      zIndex: 200,
    });
    confetti({
      particleCount: 15,
      spread: 90,
      startVelocity: 35,
      angle: 90,
      origin: { x: 0.85, y: 0.95 },
      shapes: [flower, clap],
      scalar: 0.8,
      ticks: 100,
      gravity: 0.6,
      decay: 0.92,
      zIndex: 200,
    });
  }, 400);
}

/**
 * Low-score warning — score < 60.
 * Fire and anger emoji fall slowly from top-center.
 */
export function triggerLowScore() {
  const fire = confetti.shapeFromText({ text: '🔥', scalar: 4 });
  const anger = confetti.shapeFromText({ text: '💢', scalar: 3.5 });

  confetti({
    particleCount: 20,
    spread: 100,
    startVelocity: 15,
    angle: 90,
    origin: { x: 0.5, y: 0.15 },
    shapes: [fire, anger],
    scalar: 1,
    ticks: 200,
    gravity: 1.2,
    decay: 0.96,
    drift: 1.5,
    zIndex: 200,
  });

  // Second wave — slightly offset
  setTimeout(() => {
    confetti({
      particleCount: 15,
      spread: 80,
      startVelocity: 10,
      angle: 90,
      origin: { x: 0.35, y: 0.1 },
      shapes: [fire],
      scalar: 0.9,
      ticks: 180,
      gravity: 1,
      decay: 0.95,
      drift: -1,
      zIndex: 200,
    });
    confetti({
      particleCount: 15,
      spread: 80,
      startVelocity: 10,
      angle: 90,
      origin: { x: 0.65, y: 0.1 },
      shapes: [anger],
      scalar: 0.9,
      ticks: 180,
      gravity: 1,
      decay: 0.95,
      drift: 1,
      zIndex: 200,
    });
  }, 500);
}

/**
 * Grand celebration — workout complete.
 * Full-screen ribbon burst with trophy and gold medal emoji.
 * Duration ~3.5s of continuous bursts.
 */
export function triggerWorkoutComplete() {
  const trophy = confetti.shapeFromText({ text: '🏆', scalar: 5 });
  const medal = confetti.shapeFromText({ text: '🥇', scalar: 5 });
  const fire = confetti.shapeFromText({ text: '🎉', scalar: 4 });
  const star = confetti.shapeFromText({ text: '✨', scalar: 3 });

  const defaults = {
    zIndex: 200,
  };

  // Wave 1 — left & right heavy bursts
  const leftBurst = () => {
    confetti({
      ...defaults,
      particleCount: 40,
      spread: 70,
      startVelocity: 60,
      angle: 60,
      origin: { x: 0, y: 0.5 },
      ticks: 250,
      gravity: 0.8,
      decay: 0.92,
      scalar: 1,
      colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'],
    });
    confetti({
      ...defaults,
      particleCount: 15,
      spread: 40,
      startVelocity: 50,
      angle: 70,
      origin: { x: 0.05, y: 0.6 },
      shapes: [trophy, medal],
      scalar: 1.2,
      ticks: 220,
      gravity: 0.7,
      decay: 0.93,
    });
  };

  const rightBurst = () => {
    confetti({
      ...defaults,
      particleCount: 40,
      spread: 70,
      startVelocity: 60,
      angle: 120,
      origin: { x: 1, y: 0.5 },
      ticks: 250,
      gravity: 0.8,
      decay: 0.92,
      scalar: 1,
      colors: ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'],
    });
    confetti({
      ...defaults,
      particleCount: 15,
      spread: 40,
      startVelocity: 50,
      angle: 110,
      origin: { x: 0.95, y: 0.6 },
      shapes: [trophy, medal],
      scalar: 1.2,
      ticks: 220,
      gravity: 0.7,
      decay: 0.93,
    });
  };

  const centerBurst = () => {
    confetti({
      ...defaults,
      particleCount: 60,
      spread: 120,
      startVelocity: 45,
      angle: 90,
      origin: { x: 0.5, y: 0.4 },
      ticks: 280,
      gravity: 0.6,
      decay: 0.91,
      scalar: 0.9,
      shapes: [fire, star],
    });
  };

  // Wave 1 — immediate
  leftBurst();
  rightBurst();

  // Wave 2 — 0.5s
  setTimeout(() => {
    centerBurst();
  }, 500);

  // Wave 3 — 1.2s
  setTimeout(() => {
    leftBurst();
    rightBurst();
  }, 1200);

  // Wave 4 — 2.0s
  setTimeout(() => {
    centerBurst();
  }, 2000);

  // Wave 5 — 2.8s (finale)
  setTimeout(() => {
    confetti({
      ...defaults,
      particleCount: 80,
      spread: 150,
      startVelocity: 55,
      angle: 90,
      origin: { x: 0.5, y: 0.5 },
      ticks: 300,
      gravity: 0.5,
      decay: 0.9,
      scalar: 1,
      shapes: [trophy, medal, fire, star],
      colors: ['#ffd700', '#ff6b6b', '#51cf66', '#339af0', '#f06595'],
    });
  }, 2800);
}
