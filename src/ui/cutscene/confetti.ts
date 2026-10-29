// 색종이 40 (DESIGN §12 랜드마크 컷씬 파티클) — 컷씬과 독점 연출(§16.5)이 같이 쓴다. canvas 2D, 1366×768 스테이지 좌표.
export interface ConfettiPiece { x: number; vx: number; vy: number; r: number; c: string }

export const CONFETTI_MS = 1700;
const COLOR_VARS = ['--gold-shine', '--seat-1', '--seat-2', '--seat-3', '--seat-4'];

/** 토큰 색(자리 4 + 금) — 못 읽으면 빈 배열(색종이 건너뜀) */
export const confettiColors = (el: Element) => {
  const css = getComputedStyle(el);
  return COLOR_VARS.map((v) => css.getPropertyValue(v).trim()).filter(Boolean);
};

/** 좌우 가장자리 둘레에서 떨어지는 40장 */
export function makeConfetti(rnd: () => number, colors: string[], n = 40): ConfettiPiece[] {
  return Array.from({ length: n }, (_, i) => ({ x: (i % 2 ? 1366 * 0.9 : 1366 * 0.1) + (rnd() - 0.5) * 300, vx: (rnd() - 0.5) * 120, vy: 120 + rnd() * 160, r: rnd() * 6, c: colors[i % colors.length] }));
}

/** tf 초(0~1.7) 시점의 색종이를 그린다. 마지막 0.4초 페이드 */
export function drawConfetti(ctx: CanvasRenderingContext2D, pieces: ConfettiPiece[], tf: number) {
  if (tf <= 0 || tf >= CONFETTI_MS / 1000 || !pieces.length || !pieces[0].c) return;
  ctx.globalAlpha = Math.min(1, (CONFETTI_MS / 1000 - tf) / 0.4);
  for (const p of pieces) {
    ctx.fillStyle = p.c;
    ctx.save();
    ctx.translate(p.x + p.vx * tf, -20 + p.vy * tf * 2);
    ctx.rotate(p.r + tf * 6);
    ctx.fillRect(-6, -3, 12, 6);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** canvas 한 장에 색종이만 1.7초 재생하고 스스로 멈춘다. 반환 = 정지 함수 */
export function playConfetti(cv: HTMLCanvasElement | null, seed = 11): () => void {
  const ctx = cv?.getContext('2d');
  if (!cv || !ctx) return () => {};
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pieces = makeConfetti(rnd, confettiColors(cv));
  const t0 = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, cv.width, cv.height);
    drawConfetti(ctx, pieces, t);
    if (t < CONFETTI_MS / 1000) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
