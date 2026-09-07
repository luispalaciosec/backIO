'use client';
/** Confeti al completar un requerimiento. Carga la librería solo cuando hace falta. */
export async function celebrar(origen?: { x: number; y: number }) {
  try {
    const mod = await import('canvas-confetti');
    const confetti = mod.default;
    const o = origen ?? { x: 0.5, y: 0.6 };
    void confetti({ particleCount: 90, spread: 70, startVelocity: 38, origin: o, colors: ['#0B7A3B', '#00C875', '#0073EA', '#FDAB3D', '#ffffff'], zIndex: 9999 });
    setTimeout(() => void confetti({ particleCount: 50, spread: 110, startVelocity: 25, origin: o, scalar: 0.8, zIndex: 9999 }), 180);
  } catch { /* sin confeti no pasa nada */ }
}
