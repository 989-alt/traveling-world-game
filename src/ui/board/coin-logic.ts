// 코인 변화 연출의 순수 계산(사용자 요청 2026-10-28, DESIGN §2 "코인 증감 숫자 패널 튀어오름"):
//  ① 롤링 숫자 — 바뀐 자리만 릴(0~9 띠)로 돌린다  ② 증감 팝 "이유 +480"  ③ 코인 흐름(자리↔자리, 은행↔자리).
// 서버 필드를 늘리지 않고 이미 받는 로그 이벤트에서 이유를 고른다. 로그로 못 맞춘 차이는 실제 코인 차이로 메운다(숫자는 늘 상태가 기준).
import { BOARD_SIZE, ISLAND_TILE } from '../../shared/board';
import { ISLAND_ESCAPE_COST, SALARY, TF_REWARD } from '../../shared/economy';
import type { LogEvent, Seat } from '../../shared/types';

// ── ① 롤링 숫자 ─────────────────────────────────────────

/** 릴 한 칸. '' = 빈 자리(자리수가 늘거나 줄 때) */
export type ReelCell = string;
export interface Reel {
  /** 위→아래로 그리는 띠. spin 이 아니면 한 칸 */
  strip: ReelCell[];
  spin: boolean;
  /** 띠를 아래에서 위로(값이 커짐) 굴리나, 위에서 아래로(작아짐) */
  up: boolean;
  /** 끝나면 사라질 칸(자리수가 줄 때 앞자리·쉼표) */
  exit: boolean;
  /** 새로 생긴 쉼표(살짝 나타남) */
  enter: boolean;
  /** 돌아가는 릴 중 왼쪽부터 몇 번째(멈추는 순서) */
  order: number;
}

export const fmtCoin = (n: number) => n.toLocaleString('ko-KR');
/** 돌아가는 바퀴 수(한 바퀴 = 10칸) */
export const REEL_TURNS = 2;
/** 첫 릴이 멈추는 시간과 오른쪽 릴마다 늦어지는 간격(ms): 왼쪽→오른쪽으로 거의 같이 멈춘다 */
export const REEL_MS = 680;
export const REEL_STAGGER_MS = 50;
export const reelMs = (order: number) => REEL_MS + order * REEL_STAGGER_MS;

const isDigit = (c: string) => c >= '0' && c <= '9';

/** from → to 숫자 띠. 오른쪽 자리끼리 맞대고, 같은 글자인 자리는 멈춰 있다 */
export function digitReels(from: number, to: number): Reel[] {
  const a = fmtCoin(from), b = fmtCoin(to);
  const n = Math.max(a.length, b.length);
  const up = to >= from;
  const out: Reel[] = [];
  for (let i = 0; i < n; i++) {
    const ca = a[a.length - n + i] ?? '', cb = b[b.length - n + i] ?? '';
    const exit = cb === '';
    if (ca === cb || (!isDigit(ca) && !isDigit(cb))) { // 같은 글자 · 쉼표가 생기거나 사라짐
      out.push({ strip: [exit ? ca : cb], spin: false, up, exit, enter: ca === '' && cb !== '', order: -1 });
      continue;
    }
    out.push({ strip: reelStrip(ca, cb, up), spin: true, up, exit, enter: false, order: 0 });
  }
  let k = 0;
  for (const r of out) if (r.spin) r.order = k++;
  return out;
}

/** 한 릴의 띠: 시작 글자에서 REEL_TURNS 바퀴 + 남은 칸만큼 굴러 목표에 선다. 빈 자리는 0 앞(커질 때)·9 뒤(작아질 때)에 끼운다.
 *  up 이면 [시작 … 목표] 순서(위에서 그려 위로 굴림), 아니면 [목표 … 시작](아래로 굴림) */
export function reelStrip(from: string, to: string, up: boolean): ReelCell[] {
  const d0 = from === '' ? null : Number(from), d1 = to === '' ? null : Number(to);
  const seq: ReelCell[] = [from];
  // 숫자 사이 걸음 수(빈 자리는 커질 때 -1 = 0 바로 앞, 작아질 때 10 = 9 바로 뒤로 본다)
  const s = d0 ?? (up ? -1 : 10), e = d1 ?? (up ? 10 : -1);
  const dir = up ? 1 : -1;
  const rest = (((e - s) * dir) % 10 + 10) % 10;
  const steps = REEL_TURNS * 10 + rest;
  let cur = s;
  for (let k = 1; k <= steps; k++) {
    cur += dir;
    const last = k === steps;
    if (last) { seq.push(to); break; }
    seq.push(String(((cur % 10) + 10) % 10));
  }
  return up ? seq : seq.reverse();
}

// ── ② 증감 + ③ 흐름: 로그 → 변화 목록 ───────────────────

export type CoinFlow =
  | { kind: 'transfer'; from: Seat; to: Seat }
  /** 은행에 냄(땅·건설·탈출비): 패널에서 코인이 빠진다 */
  | { kind: 'pay'; seat: Seat }
  /** 은행에서 받음(월급·보너스): 코인이 패널로 떨어진다 */
  | { kind: 'gain'; seat: Seat };

export interface CoinDelta { seat: Seat; amount: number; reason: string }
/** 한 번의 코인 이동: 팝(자리마다)과 흐름 하나 */
export interface CoinChange { flow: CoinFlow; deltas: CoinDelta[] }

export const popText = (d: Pick<CoinDelta, 'amount' | 'reason'>) => `${d.reason} ${d.amount >= 0 ? '+' : '−'}${fmtCoin(Math.abs(d.amount))}`;

const gain = (seat: Seat, amount: number, reason: string): CoinChange => ({ flow: { kind: 'gain', seat }, deltas: [{ seat, amount, reason }] });
const pay = (seat: Seat, amount: number, reason: string): CoinChange => ({ flow: { kind: 'pay', seat }, deltas: [{ seat, amount: -amount, reason }] });
const transfer = (from: Seat, to: Seat, amount: number, reason: string): CoinChange => ({
  flow: { kind: 'transfer', from, to },
  deltas: [{ seat: from, amount: -amount, reason }, { seat: to, amount, reason }],
});

/** 이동 로그가 출발 칸을 지났나(엔진 moveBy: from + 걸음 ≥ 칸 수면 월급). 무인도 보내기(sendToIsland)는 월급 없음 */
function passedStart(e: Extract<LogEvent, { ev: 'move' }>, dice: { d1: number; d2: number } | undefined): boolean {
  if (e.via === 'dice') {
    if (!dice) return e.to <= e.from && e.from !== e.to;
    const steps = dice.d1 + dice.d2;
    if ((e.from + steps) % BOARD_SIZE !== e.to) return false; // 세 번째 더블 → 무인도로 바로(이동 걸음과 다름)
    return e.from + steps >= BOARD_SIZE;
  }
  if (e.via === 'mission' && e.to === ISLAND_TILE) return false; // 미션 보상 '무인도'
  return e.to <= e.from; // 여행·미션 앞으로 가기: 걸음 = (to - from) mod 칸 수, 0 이면 한 바퀴
}

/**
 * 새 로그 묶음에서 코인 변화를 순서대로 고른다.
 * owners: 묶음 전 칸 주인(인수 때 받는 쪽). before/after: 묶음 전후 자리별 코인. bankrupt: 묶음 뒤 파산 여부(관전 정답 보상 없음).
 * 로그 합이 실제 차이와 다르면(강제 매각 등) 차이만큼 한 줄 더한다 — 숫자는 상태가 기준.
 */
export function coinChanges(fresh: readonly LogEvent[], owners: readonly (Seat | null)[], before: readonly number[], after: readonly number[], bankrupt: readonly boolean[] = []): CoinChange[] {
  const out: CoinChange[] = [];
  let dice: { seat: Seat; d1: number; d2: number } | undefined;
  for (const e of fresh) {
    switch (e.ev) {
      case 'dice': dice = e; break;
      case 'move':
        if (passedStart(e, dice && dice.seat === e.seat ? dice : undefined)) out.push(gain(e.seat, SALARY, '월급'));
        dice = undefined;
        break;
      case 'toll': if (e.paid > 0) out.push(transfer(e.payer, e.owner, e.paid, '통행료')); break;
      case 'buy': if (e.price > 0) out.push(pay(e.seat, e.price, '땅 사기')); break;
      case 'build': if (e.cost > 0) out.push(pay(e.seat, e.cost, '건설')); break;
      case 'takeover': {
        const from = owners[e.tile];
        if (e.shielded || e.cost <= 0) break;
        out.push(from !== null && from !== undefined && from !== e.seat ? transfer(e.seat, from, e.cost, '인수') : pay(e.seat, e.cost, '인수'));
        break;
      }
      case 'tf_answer': if (e.correct && !bankrupt[e.seat]) out.push(gain(e.seat, TF_REWARD, '관전 정답')); break;
      case 'event': {
        const p = e.payload;
        if (e.kind === 'island' && p.escape === 'coin') out.push(pay(e.seat, ISLAND_ESCAPE_COST, '탈출비'));
        else if ((e.kind === 'korea' || e.kind === 'antarctic') && typeof p.bonus === 'number' && p.bonus > 0) out.push(gain(e.seat, p.bonus, '정답 보너스'));
        else if (e.kind === 'festival' && typeof p.fund === 'number' && p.fund > 0) out.push(gain(e.seat, p.fund, '기금'));
        else if (e.kind === 'fund' && typeof p.received === 'number' && p.received > 0) out.push(gain(e.seat, p.received, '미션 보상'));
        break;
      }
      default: break;
    }
  }
  return reconcile(out, fresh, before, after);
}

/** 자리마다 로그 합 = 실제 차이가 되게. 월급을 잘못 짚었으면(드문 겹침) 빼고, 그래도 남으면 차이 한 줄 */
function reconcile(list: CoinChange[], fresh: readonly LogEvent[], before: readonly number[], after: readonly number[]): CoinChange[] {
  let out = list;
  for (let s = 0; s < after.length; s++) {
    const seat = s as Seat;
    const real = (after[s] ?? 0) - (before[s] ?? 0);
    const sum = () => out.reduce((a, c) => a + c.deltas.filter((d) => d.seat === seat).reduce((x, d) => x + d.amount, 0), 0);
    let diff = real - sum();
    if (diff === 0) continue;
    // 월급으로 본 것이 틀렸나: 월급 하나 뺀 만큼 정확히 맞으면 뺀다
    if (diff < 0 && diff % SALARY === 0) {
      let n = -diff / SALARY;
      out = out.filter((c) => !(n > 0 && c.flow.kind === 'gain' && c.deltas[0].seat === seat && c.deltas[0].reason === '월급' && n--));
      diff = real - sum();
      if (diff === 0) continue;
    }
    const sold = fresh.some((e) => e.ev === 'sold' && e.seat === seat);
    const fix = diff > 0 ? gain(seat, diff, sold ? '매각' : '코인') : pay(seat, -diff, '코인');
    // 매각은 내기 전에 일어난다: 그 자리 첫 변화 앞에
    if (sold && diff > 0) {
      const i = out.findIndex((c) => c.deltas.some((d) => d.seat === seat));
      out = i < 0 ? [...out, fix] : [...out.slice(0, i), fix, ...out.slice(i)];
    } else out = [...out, fix];
  }
  return out;
}

// ── 시간표 ─────────────────────────────────────────────

/** 변화 사이 간격(ms) */
export const POP_GAP_MS = 500;
/** 날아가는 코인이 받는 패널에 닿는 시간 */
export const FLY_MS = 650;
/** 은행에서 떨어지는 코인이 패널에 닿는 시간 */
export const DROP_MS = 380;
/** 팝이 떠 있는 시간 */
export const POP_MS = 1500;
export const POP_REDUCED_MS = 1000;

export interface TimedPop { seat: Seat; text: string; gain: boolean; at: number }
export interface Plan {
  pops: TimedPop[];
  flows: { flow: CoinFlow; amount: number; at: number }[];
  /** 자리별 숫자를 최종값으로 굴리기 시작할 시각 */
  rollAt: Map<Seat, number>;
  /** 묶음 연출이 끝나는 시각(다음 묶음은 이 뒤에) */
  end: number;
}

/** 변화 목록 → 시간표(ms, start 기준). 내는 쪽은 바로, 받는 쪽은 코인이 닿을 때 숫자가 돈다(자리마다 첫 변화 때 최종값으로 한 번) */
export function plan(changes: CoinChange[], start: number): Plan {
  const pops: TimedPop[] = [];
  const flows: Plan['flows'] = [];
  const rollAt = new Map<Seat, number>();
  let end = start;
  changes.forEach((c, i) => {
    const t = start + i * POP_GAP_MS;
    const land = c.flow.kind === 'transfer' ? FLY_MS : c.flow.kind === 'gain' ? DROP_MS : 0;
    flows.push({ flow: c.flow, amount: Math.abs(c.deltas[0].amount), at: t });
    for (const d of c.deltas) {
      const at = d.amount > 0 ? t + land : t;
      pops.push({ seat: d.seat, text: popText(d), gain: d.amount > 0, at });
      if (!rollAt.has(d.seat)) rollAt.set(d.seat, at);
      end = Math.max(end, at);
    }
  });
  return { pops, flows, rollAt, end: end + (changes.length ? POP_GAP_MS : 0) };
}

/** 코인 아이콘 개수: 많이 움직일수록 조금 더(3~7개) */
export const coinCount = (amount: number) => Math.min(7, 3 + Math.floor(Math.log10(Math.max(1, amount / 100)) * 2));
