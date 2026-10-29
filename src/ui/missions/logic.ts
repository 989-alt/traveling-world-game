// 미션 UI 순수 로직. 판정은 하지 않는다(서버 엔진 몫) — 여기는 화면 상태와 제출 꾸러미만 만든다.

export const SNAP = 24; // 타깃 상자에서 이만큼 안쪽·바깥이면 붙는다(px)

/** protocol.ts 의 missionAnswer 에서 type 을 뺀 모양. 번호는 화면에 준 목록의 자리:
 *  실제 게임은 서버 표시 목록(MissionShown)의 번호(서버가 원래 번호로 되돌린다), 하네스는 미션 원본 pairs·steps 번호. 사진·그래프는 options 번호 */
export interface MissionAnswerMsg {
  pairs?: [number, number][];
  steps?: number[];
  selected?: number[];
  ms: number;
}

/** 같은 미션이면 누구에게나 같은 섞임(관전자 화면과 일치). 항등 순서는 피한다 */
export function shuffled(n: number, seed: string): number[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (n > 1 && a.every((v, i) => v === i)) a.push(a.shift()!);
  return a;
}

// ── 연결하기 ──────────────────────────────────────────────
/** 왼쪽 번호 → 오른쪽 번호. 한 항목은 선 하나만: 다시 이으면 이전 선이 사라진다 */
export type Links = Record<number, number>;

export function link(links: Links, left: number, right: number): Links {
  const next: Links = {};
  for (const [l, r] of Object.entries(links)) if (Number(l) !== left && r !== right) next[Number(l)] = r;
  next[left] = right;
  return next;
}

const linksToPairs = (links: Links): [number, number][] =>
  Object.entries(links).map(([l, r]) => [Number(l), r]);

// ── 블록 놓기·순서 맞히기 (같은 틀: 블록을 번호 있는 칸에 놓는다) ──
/** 칸 번호 → 그 칸에 놓인 블록 번호(없으면 null) */
export type Slots = (number | null)[];

export const emptySlots = (n: number): Slots => Array.from({ length: n }, () => null);
export const slotOf = (slots: Slots, block: number) => slots.indexOf(block);

/** 블록을 칸에 놓는다. 이미 다른 블록이 있으면 서로 자리를 바꾼다(원래 칸이 없으면 그 블록은 트레이로) */
export function place(slots: Slots, block: number, slot: number): Slots {
  const next = [...slots];
  const from = next.indexOf(block);
  const old = next[slot];
  if (from === slot) return next;
  if (from >= 0) next[from] = old; // 바꿔 앉기(old 가 null 이면 빈 칸이 됨)
  next[slot] = block;
  return next;
}

export const takeOut = (slots: Slots, block: number): Slots => slots.map((b) => (b === block ? null : b));

export interface Rect { left: number; top: number; right: number; bottom: number }

/** 점에서 상자까지 거리(안이면 0) */
const distToRect = (x: number, y: number, r: Rect) =>
  Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));

/** 놓은 점에서 SNAP 안에 드는 가장 가까운 칸. 없으면 -1(원위치로 되돌린다) */
export function snapTo(x: number, y: number, rects: Rect[], snap = SNAP): number {
  let best = -1;
  let bd = Infinity;
  rects.forEach((r, i) => {
    const d = distToRect(x, y, r);
    if (d <= snap && d < bd) { bd = d; best = i; }
  });
  return best;
}

// ── 제출 꾸러미 ───────────────────────────────────────────
/** 블록 놓기: 칸 r 에 블록 l 이 놓였으면 [l, r]. 안 채운 칸은 빼고 보낸다(부분 정답은 서버가 실패로 판정) */
export const blocksAnswer = (slots: Slots, ms: number): MissionAnswerMsg => ({
  pairs: slots.flatMap((b, r) => (b === null ? [] : [[b, r] as [number, number]])),
  ms,
});

/** 순서 맞히기: 칸 순서대로 블록 번호. 비면 건너뛰어 짧아지고 서버가 실패로 판정 */
export const orderAnswer = (slots: Slots, ms: number): MissionAnswerMsg => ({
  steps: slots.filter((b): b is number => b !== null),
  ms,
});

export const choiceAnswer = (selected: number[], ms: number): MissionAnswerMsg => ({
  selected: [...selected].sort((a, b) => a - b),
  ms,
});

export const connectAnswer = (links: Links, ms: number): MissionAnswerMsg => ({ pairs: linksToPairs(links), ms });

/** 서버가 알려 준 마감(deadlineAt)과 지금으로 남은 ms·걸린 ms */
export const timeLeft = (deadlineAt: number, now: number) => Math.max(0, deadlineAt - now);
export const elapsed = (deadlineAt: number, durationMs: number, now: number) =>
  Math.min(durationMs, Math.max(0, durationMs - (deadlineAt - now)));

/** 요소가 화면에 그려진 배율. 미션은 오버레이 Stage(scale(s)) 안에 뜨므로 getBoundingClientRect·clientX 차이(화면 px)를
 *  요소 안 좌표(스테이지 px: SVG 선·transform)로 쓸 때는 이 값으로 나눈다(QA4: 태블릿 s≈0.86 에서 선 끝이 26~92px 어긋남) */
export function drawScale(el: HTMLElement): number {
  let e: HTMLElement | null = el; // display: contents(지도 구역 배치의 .pl)는 상자가 없어 잴 수 없다 → 상자 있는 조상에서 잰다
  while (e && e.offsetWidth === 0) e = e.parentElement;
  if (!e) return 1;
  const k = e.getBoundingClientRect().width / e.offsetWidth;
  return k > 0 && Number.isFinite(k) ? k : 1;
}
