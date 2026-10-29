// 1366×768 판을 화면에 맞춘 배율(contain). U7: 노치(safe-area 왼쪽·오른쪽·위) 안쪽에 들어가게 맞춘다.
// 판은 화면 가운데 두므로 양쪽 중 큰 여백 × 2 를 뺀다. 아래 홈 표시줄(아이폰 가로 21px)은 빼지 않는다 —
// 노치처럼 화면을 가리지 않고, 빼면 휴대폰 가로 배율이 11% 더 작아진다(글자 크기가 더 급하다, U7 실측 보고).
export const STAGE_W = 1366;
export const STAGE_H = 768;

let probe: HTMLElement | null = null;

/** env(safe-area-inset-*) 를 px 로(노치 없는 기기·viewport-fit 없는 브라우저 = 0) */
export function safeInsets(): { t: number; r: number; b: number; l: number } {
  if (typeof document === 'undefined' || !document.body) return { t: 0, r: 0, b: 0, l: 0 };
  if (!probe || !probe.isConnected) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
      + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
  }
  const s = getComputedStyle(probe);
  const n = (v: string) => parseFloat(v) || 0;
  return { t: n(s.paddingTop), r: n(s.paddingRight), b: n(s.paddingBottom), l: n(s.paddingLeft) };
}

export function fitScale(): number {
  const i = safeInsets();
  const w = innerWidth - 2 * Math.max(i.l, i.r);
  const h = innerHeight - 2 * i.t;
  return Math.min(w / STAGE_W, h / STAGE_H);
}
