// 봇 정책 (PRD §4.5). 서버와 시뮬이 같이 쓴다. Math.random 없음 — rand 는 호출자가 시드로 만든다.
import { BOARD, TRAVEL_TILE } from '../shared/board';
import { BOT_ACCURACY } from '../shared/economy';
import { movesShowMs, PICK_BOT_FLASH_MS } from '../shared/timing';
import type { Action, Content, GameState, MissionAnswer, Seat, Step, TotalMinutes } from '../shared/types';
import { apply, stepMs } from './engine';
import { buildCost, landPrice, tollQuote } from './pay';
import { nextFloat } from './rng';

export type Rand = () => number;

/** 시드 RNG (엔진과 같은 mulberry32) */
export function seededRand(seed: number): Rand {
  let st = seed >>> 0;
  return () => {
    const [v, next] = nextFloat(st);
    st = next;
    return v;
  };
}

/** 판마다 자리별로 놀이 시간의 범위(BOT_ACCURACY)에서 균일 추출(PRD §4.5 U2). 문항·참/거짓·미션에 같은 값을 쓴다 */
export function drawAccuracy(rand: Rand, totalMinutes: TotalMinutes): number {
  const [lo, hi] = BOT_ACCURACY[totalMinutes] ?? BOT_ACCURACY[40];
  return lo + (hi - lo) * rand();
}
/** 봇이 행동하는 단계(문화 카드·해설·참/거짓 결과는 시간으로만 넘어간다) */
export type BotStep = Exclude<Step, 'culture' | 'explanation' | 'tfResult'>;

/** 단계별 봇 지연 [하한, 상한] ms — 사람 화면에서 그 창이 열린 뒤(서버 showUntil 뒤)부터 센다. PRD §4.5 U10 단일 출처, sim 도 쓴다.
 *  참/거짓 상한 5초 < 창 6초, 미션 상한 12초 < 창 45초 */
export const BOT_DELAY_MS: Record<BotStep, readonly [number, number]> = {
  roll: [1000, 2000],
  question: [5000, 8000],
  tf: [3000, 5000],
  action: [2500, 3500],
  toll: [2500, 3500],
  takeover: [2500, 3500],
  mission: [8000, 12000],
  reward: [2000, 3000],
  festival: [2000, 3000],
  travel: [2000, 3000],
  pickTile: [2000, 3000],
  shield: [2000, 3000],
};

const isBotStep = (st: Step): st is BotStep => Object.hasOwn(BOT_DELAY_MS, st);

/** 그 단계의 봇 지연 한 번(균일 추출, 서버가 쓴다). 봇이 행동하지 않는 단계면 0 */
export function botDelayMs(rand: Rand, step: Step): number {
  if (!isBotStep(step)) return 0;
  const [lo, hi] = BOT_DELAY_MS[step];
  return lo + Math.round((hi - lo) * rand());
}

/** 지연 중앙값(sim 의 턴 시간 재측정용, rand 를 쓰지 않는다) */
export const botDelayMid = (step: Step) => (isBotStep(step) ? (BOT_DELAY_MS[step][0] + BOT_DELAY_MS[step][1]) / 2 : 0);

/** 지금 무언가 해야 하는 봇 자리 */
export function botSeats(s: GameState): Seat[] {
  if (s.phase !== 'playing') return [];
  const t = s.turn;
  const bot = (i: number) => s.seats[i].isBot && !s.players[i].bankrupt;
  if (t.step === 'tf') {
    return s.seats.flatMap((_, i) => (bot(i) && i !== t.seat && !t.tf?.answers.some((a) => a.seat === i) ? [i as Seat] : []));
  }
  if (t.step === 'shield') {
    const owner = s.tiles[t.tile!].owner;
    return owner !== null && s.seats[owner].isBot ? [owner] : [];
  }
  // 문화 카드·해설·참/거짓 결과는 시간으로만 넘어간다(PRD §4.5 U10: 봇은 문화 카드를 넘기지 않는다)
  return s.seats[t.seat].isBot && isBotStep(t.step) ? [t.seat] : [];
}

/** 예비금 = 보드 최고 통행료 (남의 땅 중, 지금 배율 그대로·할인 없음) */
export function reserve(s: GameState, seat: Seat): number {
  let max = 0;
  s.tiles.forEach((t, i) => {
    if (t.owner !== null && t.owner !== seat) max = Math.max(max, tollQuote(s, i, false, null).paid);
  });
  return max;
}

/** 봇이 낼 입력 하나. null 이거나 엔진이 거부하면 호출자는 그 단계 timeout 을 보낸다 */
export function botAction(s: GameState, seat: Seat, c: Content, rand: Rand, accuracy: number): Action | null {
  const t = s.turn;
  const p = s.players[seat];
  const right = () => rand() < accuracy;
  switch (t.step) {
    case 'roll':
      // 무인도: 탈출 카드가 있으면 쓴다. 코인 탈출은 안 한다(더블을 기다림)
      if (p.islandTurns > 0 && p.items.includes('escape')) return { type: 'escape', seat, method: 'item' };
      return { type: 'roll', seat };
    case 'travel': {
      // 앞에서 가장 가까운 빈 나라 칸, 없으면 아무 칸
      for (let k = 1; k < BOARD.length; k++) {
        const i = (p.pos + k) % BOARD.length;
        if (BOARD[i].kind === 'country' && s.tiles[i].owner === null) return { type: 'travel', seat, tile: i };
      }
      const tile = Math.floor(rand() * (BOARD.length - 1));
      return { type: 'travel', seat, tile: tile >= TRAVEL_TILE ? tile + 1 : tile };
    }
    case 'culture': return null; // 넘기지 않는다 — 시간(5초·3초)으로만 닫힘
    case 'question': {
      const q = t.question!;
      const choice = q.format === 'tf'
        ? (right() ? q.answer : !q.answer)
        : (right() ? q.answer : ((q.answer as number) + 1 + Math.floor(rand() * 3)) % 4);
      return { type: 'answer', seat, choice, ms: 2000 };
    }
    case 'tf': return { type: 'tfAnswer', seat, value: right() ? t.tf!.answer : !t.tf!.answer };
    case 'toll': {
      // 면제는 이 통행료가 보드 최고일 때, 절반은 최고의 절반 이상일 때
      const toll = tollQuote(s, t.tile!, t.correct === true, null).paid;
      const top = reserve(s, seat);
      if (p.items.includes('tollFree') && toll >= top) return { type: 'payToll', seat, item: 'tollFree' };
      if (p.items.includes('tollHalf') && toll * 2 >= top) return { type: 'payToll', seat, item: 'tollHalf' };
      return { type: 'payToll', seat, item: null };
    }
    case 'action': {
      const tile = t.tile!;
      const st = s.tiles[tile];
      const cost = st.owner === null ? landPrice(tile, t.correct === true) : buildCost(tile, st.level + 1);
      if (p.coin < cost + reserve(s, seat)) return { type: 'pass', seat };
      return st.owner === null ? { type: 'buy', seat } : { type: 'build', seat };
    }
    case 'takeover': {
      // 정답(엔진이 보장) + 코인 충분(인수비 + 예비금)이면 인수(PRD §4.5, 2026-10-28 U3).
      // 옛 '그 대륙에 내 땅 ≥ 1칸' 조건은 U3 에서 삭제 — 봇이 더 적극적으로 인수한다. 학생 규칙(§3.2)은 그대로
      return p.coin >= t.takeoverCost + reserve(s, seat) ? { type: 'takeover', seat } : { type: 'pass', seat };
    }
    case 'shield': return { type: 'shield', seat, use: true };
    case 'explanation': return null; // 해설은 시간으로만 넘어간다
    case 'mission': {
      const m = c.missions.find((x) => x.id === t.missionId);
      if (!m || !right()) return { type: 'missionAnswer', seat, answer: {}, ms: 5000 };
      const answer: MissionAnswer = m.pairs ? { pairs: m.pairs } : m.steps ? { steps: m.steps }
        : { selected: (m.options ?? []).flatMap((o, i) => (o.correct ? [i] : [])) };
      return { type: 'missionAnswer', seat, answer, ms: 5000 };
    }
    case 'reward': return { type: 'chooseReward', seat, index: Math.floor(rand() * t.rewardOptions.length) };
    case 'pickTile':
    case 'festival': {
      // 통행료가 가장 비싼 내 땅
      let best = -1;
      let bestToll = -1;
      s.tiles.forEach((x, i) => {
        if (x.owner !== seat) return;
        const toll = tollQuote(s, i, false, null).base;
        if (toll > bestToll) { best = i; bestToll = toll; }
      });
      if (t.step === 'festival') return { type: 'pickFestival', seat, tile: best < 0 ? null : best };
      return best < 0 ? null : { type: 'pickTile', seat, tile: best };
    }
  }
  return null;
}

/** 봇 4명 한 판을 끝까지 (시뮬·테스트용). 멈춤은 없다(멈추면 바로 이어 하기).
 *  시계: turnMs 를 주면 턴마다 그만큼 tick(옛 고정 가정). 안 주면 **잰 턴 시간**(PRD §4.3·§4.5 U10) — 한 턴이 끝난 뒤 그 턴의
 *  화면 연출 합(shared/timing movesShowMs·봇 칸 반짝) + 봇 행동 지연 중앙값(BOT_DELAY_MS) + 무응답 단계의 남은 마감(stepMs)만큼 tick.
 *  참/거짓은 서버처럼 봇들이 한 시각에 답한다(지연 한 번). rand 를 더 쓰지 않으므로 같은 시드의 행동 순서는 turnMs 와 무관하다.
 *  timeoutP 확률로 무응답(timeout)을 섞는다. 정답률 0 인 자리는 답하는 단계에서 무응답 없이 늘 오답을 낸다.
 *  bankruptHalf = 놀이 시간이 절반 지난 순간의 파산 수. 절반 전에 끝난 판은 끝난 순간 값. turnsMs = 잰 턴마다 길이(turnMs 를 주면 빈 배열) */
export function playBotGame(o: {
  state: GameState; content: Content; rand: Rand; accuracy: number[]; turnMs?: number; timeoutP: number;
}): { state: GameState; bankruptHalf: number; turnsMs: number[] } {
  const { content: c, rand, accuracy, turnMs, timeoutP } = o;
  const bankrupts = (x: GameState) => x.players.filter((p) => p.bankrupt).length;
  const turnStart = (st: string) => st === 'roll' || st === 'travel';
  const key = (x: GameState) => `${x.turn.seat}|${x.turn.step}|${x.log.length}`; // 서버 stepKey 와 같은 규칙
  const halfMs = (o.state.settings.totalMinutes * 60_000) / 2;
  const turnsMs: number[] = [];
  let s = o.state;
  let bankruptHalf: number | null = null;
  let needTick = true;
  let wall = 0; // 지난 tick 뒤 흐른 시간(잰 시계)
  let stepWall = 0; // 지금 단계 창이 열린 뒤 흐른 시간
  for (let guard = 0; s.phase !== 'finished'; guard++) {
    if (guard > 200_000) throw new Error('playBotGame: 끝나지 않음');
    if (bankruptHalf === null && s.clock.remainingMs <= halfMs) bankruptHalf = bankrupts(s);
    if (s.phase === 'paused') {
      s = apply(s, { type: 'resume' }, c);
      needTick = true;
      continue;
    }
    const step = s.turn.step;
    if (needTick && turnStart(step)) {
      needTick = false;
      if (turnMs === undefined && wall > 0) turnsMs.push(wall);
      s = apply(s, { type: 'tick', ms: turnMs ?? wall }, c); // 첫 턴 앞(wall 0)은 엔진이 거부 → 그대로
      wall = 0;
      continue;
    }
    const seat = botSeats(s)[0];
    const sure = seat !== undefined && accuracy[seat] === 0 && (step === 'question' || step === 'tf' || step === 'mission');
    let act: Action | null = seat === undefined || (!sure && rand() < timeoutP) ? null : botAction(s, seat, c, rand, accuracy[seat]);
    let next = act ? apply(s, act, c) : s;
    if (next === s) { act = { type: 'timeout' }; next = apply(s, act, c); }
    if (next === s) throw new Error(`playBotGame: 진행 불가 (step ${step})`);
    if (turnMs === undefined) {
      // 이 단계에서 흐른 시간: 무응답이면 마감까지 남은 만큼, 봇이면 지연 중앙값(참/거짓은 첫 답의 지연 한 번 — 서버는 봇들이 한 시각에 답한다)
      const dt = act!.type === 'timeout' ? Math.max(0, stepMs(s) - stepWall) : Math.max(0, botDelayMid(step) - stepWall);
      const picked = act!.type === 'travel' || act!.type === 'pickTile' || (act!.type === 'pickFestival' && act!.tile !== null);
      const show = movesShowMs(next.log.slice(s.log.length), { step: next.turn.step, tile: next.turn.tile }) + (picked ? PICK_BOT_FLASH_MS : 0);
      wall += dt + show;
      stepWall = key(next) === key(s) ? stepWall + dt : 0;
    }
    // 새 턴 시작: 턴 시작 단계로 들어왔거나, 턴 시작 단계에서 굴림·이동·timeout 을 소비한 뒤 다시 턴 시작 단계(다음 자리·더블)
    if (turnStart(next.turn.step) && (!turnStart(step) || act!.type !== 'escape')) needTick = true;
    s = next;
  }
  if (turnMs === undefined && wall > 0) turnsMs.push(wall);
  return { state: s, bankruptHalf: bankruptHalf ?? bankrupts(s), turnsMs };
}
