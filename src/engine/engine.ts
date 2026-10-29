// 규칙 엔진: apply(state, action, content) → 새 state. I/O·시간·Math.random 없음.
// 잘못된 seat·단계·값의 입력은 원래 state 를 그대로 돌려준다(참조 동일).
import { BOARD, BOARD_SIZE, CONTINENTS, ISLAND_TILE, TRAVEL_TILE, continentTiles, monopolyNeedsBuilding } from '../shared/board';
import type { Tile } from '../shared/board';
import type { CountryId, Mission } from '../shared/content-types';
import {
  ANTARCTIC_BONUS, GAUGE_REROLL, ISLAND_ESCAPE_COST, ISLAND_TURNS, ITEM_LIMIT, KOREA_BONUS,
  SALARY, SELL_RATE, START_COIN, STEP_MS, TAKEOVER_MAX_LEVEL, TF_REWARD, CLIMATE_TURNS,
} from '../shared/economy';
import type {
  Action, Content, GameState, ItemKind, LogEvent, MissionAnswer, PendingQuestion, Reward, Seat, Settings, TurnState,
} from '../shared/types';
import { assetsOf, buildCost, landPrice, takeoverCost, tollQuote } from './pay';
import { nextFloat } from './rng';

type S = GameState;
type C = Content;
const KEEP_ITEMS: ItemKind[] = ['tollFree', 'tollHalf', 'escape', 'shield', 'hint'];
const CLIMATE_KINDS = ['drought', 'flood', 'heatwave', 'blizzard', 'typhoon'];

const freshTurn = (seat: Seat): TurnState => ({
  seat, step: 'roll', tile: null, correct: null, discount: false, rolledDouble: false, extraRoll: false,
  question: null, tf: null, missionId: null, missionSuccess: false, rewardOptions: [], takeoverCost: 0,
});

export function createGame(o: { seed: number; settings?: Partial<Settings>; bots?: boolean[] }): S {
  const settings: Settings = { totalMinutes: 40, touristQuiz: false, ...o.settings };
  const remainingMs = settings.totalMinutes * 60_000;
  const bots = o.bots ?? [false, false, false, false];
  return {
    settings,
    seats: bots.map((isBot) => ({ isBot, connected: true })),
    phase: 'playing',
    clock: { remainingMs, pauseBy: null },
    tiles: BOARD.map(() => ({ owner: null, level: 0, festivalTarget: false })),
    players: bots.map(() => ({ coin: START_COIN, pos: 0, items: [], islandTurns: 0, bankrupt: false, doubles: 0, travelPending: false, laps: 0 })),
    turn: freshTurn(0),
    revealedCards: [],
    usedQuestionIds: [],
    usedTfIds: [],
    usedMissionIds: [],
    seenCountries: [],
    fund: 0,
    climateEvent: null,
    monopolies: [],
    winner: null,
    rngSeed: o.seed >>> 0,
    rngState: o.seed >>> 0,
    log: [{ ev: 'clock', kind: 'start', remainingMs, by: 'host' }],
  };
}

export function apply(state: S, a: Action, content: C): S {
  // structuredClone 은 Node 17+ 또는 Workers 에서만 있다. 로그 이벤트는 추가 뒤 바뀌지 않으므로 배열만 복사한다
  const { log, ...rest } = state;
  const s: S = { ...structuredClone(rest), log: log.slice() };
  return handle(s, a, content) ? s : state;
}

/** 지금 단계의 제한 시간. 서버가 이 시간이 지나면 { type: 'timeout' } 을 보낸다 */
export function stepMs(s: S): number {
  const st = s.turn.step;
  if (st === 'explanation') return s.turn.question?.variant === 'short' ? STEP_MS.explanationShort : STEP_MS.explanationFull;
  return STEP_MS[st];
}

// ── 공용 ────────────────────────────────────────────────

const push = (s: S, e: LogEvent) => { s.log.push(e); };
function rand(s: S): number {
  const [v, next] = nextFloat(s.rngState);
  s.rngState = next;
  return v;
}
const randInt = (s: S, n: number) => Math.floor(rand(s) * n);
const isSeat = (s: S, x: unknown): x is Seat => Number.isInteger(x) && (x as number) >= 0 && (x as number) < s.seats.length;
const me = (s: S) => s.players[s.turn.seat];
const tileOf = (s: S) => BOARD[s.turn.tile!];
const ownedBy = (s: S, seat: Seat) => s.tiles.flatMap((t, i) => (t.owner === seat ? [i] : []));
const tileCountry = (t: Tile) => t.country as CountryId;

// ── 입력 분기 ────────────────────────────────────────────

function handle(s: S, a: Action, c: C): boolean {
  if (a.type === 'setConnected') {
    if (!isSeat(s, a.seat) || s.seats[a.seat].connected === !!a.connected) return false;
    s.seats[a.seat].connected = !!a.connected;
    // 자동 멈춤(전원 끊김) 대기 중에 사람이 돌아오면 취소한다. 방장 멈춤은 그대로(U123 L2)
    if (a.connected && s.phase === 'playing' && s.clock.pauseBy === 'auto') s.clock.pauseBy = null;
    return true;
  }
  if (a.type === 'resume') {
    // 이어 하기: 남은 시간 그대로 시계를 다시 돌린다(옛 시계처럼 다시 채우지 않음)
    if (s.phase !== 'paused') return false;
    s.phase = 'playing';
    s.clock.pauseBy = null;
    // 남은 시간이 없으면 멈춘 채 갇히지 않게 바로 시간 끝(자산승)으로 마친다(U123 L1)
    if (s.clock.remainingMs <= 0) { s.clock.remainingMs = 0; timeUp(s); return true; }
    push(s, { ev: 'clock', kind: 'resume', remainingMs: s.clock.remainingMs, by: 'host' });
    return true;
  }
  if (s.phase !== 'playing') return false;
  if (a.type === 'tick') {
    if (!(a.ms > 0)) return false;
    s.clock.remainingMs = Math.max(0, s.clock.remainingMs - a.ms);
    if (s.clock.remainingMs === 0 && atTurnStart(s)) timeUp(s); // 턴 시작 전이면 바로 끝
    return true;
  }
  if (a.type === 'pause') {
    if (s.clock.pauseBy || (a.by !== 'host' && a.by !== 'auto')) return false;
    s.clock.pauseBy = a.by;
    // 턴 시작 전이면 바로, 아니면 이 턴을 마친 뒤(endTurn). 그 사이(대기 중)에는 시계가 계속 줄어든다(tick 은 playing 이면 받는다).
    // 대기 중에 시간이 다 되면 endTurn 에서 시간 끝이 멈춤보다 먼저다
    if (atTurnStart(s)) pauseNow(s);
    return true;
  }
  if (a.type === 'timeout') return onTimeout(s, c, a.shown ?? []);

  if (!isSeat(s, a.seat)) return false;
  const step = s.turn.step;
  // 남의 턴에 낼 수 있는 입력: 참/거짓(도착자 제외), 방패(땅 주인)
  if (a.type === 'tfAnswer') return step === 'tf' && tfAnswer(s, c, a.seat, a.value);
  if (a.type === 'shield') {
    return step === 'shield' && a.seat === s.tiles[s.turn.tile!].owner && (a.use ? blockTakeover(s) : doTakeover(s), true);
  }
  if (a.seat !== s.turn.seat) return false;

  switch (a.type) {
    case 'roll': return step === 'roll' && doRoll(s, c, a.gauge);
    case 'escape': return step === 'roll' && escape(s, a.method);
    case 'travel':
      if (step !== 'travel' || !Number.isInteger(a.tile) || a.tile < 0 || a.tile >= BOARD_SIZE || a.tile === TRAVEL_TILE) return false;
      me(s).travelPending = false;
      moveForwardTo(s, c, a.tile, 'travel');
      return true;
    case 'ack': {
      const cc = s.log[s.log.length - 1]; // culture 단계의 마지막 로그는 늘 culture_card
      if (step !== 'culture' || cc?.ev !== 'culture_card' || cc.firstVisit) return false; // 첫 방문은 3초 고정
      afterCulture(s, c);
      return true;
    }
    case 'answer': return step === 'question' && answer(s, c, a.choice, a.ms);
    case 'useHint': return step === 'question' && useHint(s);
    case 'payToll': {
      if (step !== 'toll') return false;
      if (a.item !== null && (!['tollFree', 'tollHalf'].includes(a.item) || !me(s).items.includes(a.item))) return false;
      payToll(s, a.item);
      return true;
    }
    case 'buy': return step === 'action' && buy(s);
    case 'build': return step === 'action' && build(s);
    case 'takeover': return step === 'takeover' && takeover(s, c);
    case 'pass': return (step === 'action' || step === 'takeover') && (endTurn(s), true);
    case 'missionAnswer': return step === 'mission' && missionResult(s, c, a.answer, a.ms);
    case 'chooseReward': return step === 'reward' && chooseReward(s, c, a.index);
    case 'pickTile':
      if (step !== 'pickTile' || s.tiles[a.tile]?.owner !== a.seat) return false;
      moveForwardTo(s, c, a.tile, 'mission');
      return true;
    case 'pickFestival':
      if (step !== 'festival' || (a.tile !== null && s.tiles[a.tile]?.owner !== a.seat)) return false;
      pickFestival(s, a.tile);
      return true;
  }
  return false;
}

function onTimeout(s: S, c: C, shown: Seat[]): boolean {
  switch (s.turn.step) {
    case 'roll': return doRoll(s, c, undefined);
    case 'travel': me(s).travelPending = false; s.turn.step = 'roll'; return true;
    case 'culture': afterCulture(s, c); return true;
    case 'question': return answer(s, c, null, STEP_MS.question);
    case 'explanation': afterExplanation(s, c, shown); return true;
    case 'tf': closeTf(s, c); return true;
    case 'toll': payToll(s, null); return true;
    case 'action': case 'takeover': case 'pickTile': endTurn(s); return true;
    case 'shield': blockTakeover(s); return true; // 무응답 = 자동 방어
    case 'mission': return missionResult(s, c, null, STEP_MS.mission);
    case 'reward': return chooseReward(s, c, 0);
    case 'festival': pickFestival(s, null); return true;
  }
}

// ── 주사위·이동 ───────────────────────────────────────────

function rollDice(s: S, gauge: number | undefined): [number, number] {
  const roll = (): [number, number] => [1 + randInt(s, 6), 1 + randInt(s, 6)];
  let d = roll();
  if (typeof gauge === 'number' && Number.isFinite(gauge)) {
    const g = Math.min(1, Math.max(0, gauge));
    const strength = Math.abs(g - 0.5) * 2;
    // 원하는 쪽(합 7 이상/미만)이 아니면 세기만큼의 확률로 한 번 다시 굴린다
    if (strength > 0 && d[0] + d[1] >= 7 !== g > 0.5 && rand(s) < GAUGE_REROLL * strength) d = roll();
  }
  return d;
}

function doRoll(s: S, c: C, gauge: number | undefined): boolean {
  const seat = s.turn.seat;
  const p = me(s);
  const [d1, d2] = rollDice(s, gauge);
  push(s, { ev: 'dice', seat, d1, d2 });
  if (p.islandTurns > 0) {
    if (d1 === d2) { p.islandTurns = 0; moveBy(s, c, d1 + d2, 'dice'); return true; } // 탈출, 추가 굴림 없음
    p.islandTurns--;
    endTurn(s);
    return true;
  }
  if (d1 === d2) {
    p.doubles++;
    if (p.doubles >= 3) { sendToIsland(s, 'dice'); endTurn(s); return true; }
    s.turn.rolledDouble = true;
  }
  moveBy(s, c, d1 + d2, 'dice');
  return true;
}

function escape(s: S, method: 'coin' | 'item'): boolean {
  const p = me(s);
  if (p.islandTurns === 0) return false;
  if (method === 'coin') {
    if (p.coin < ISLAND_ESCAPE_COST) return false;
    charge(s, s.turn.seat, ISLAND_ESCAPE_COST, 'fund'); // 탈출비 → 은행 기금 적립(§3.6)
  } else if (method === 'item') {
    if (!useItem(p.items, 'escape')) return false;
  } else return false;
  p.islandTurns = 0;
  push(s, { ev: 'event', seat: s.turn.seat, kind: 'island', payload: { escape: method } });
  return true;
}

function useItem(items: ItemKind[], k: ItemKind): boolean {
  const i = items.indexOf(k);
  if (i < 0) return false;
  items.splice(i, 1);
  return true;
}

function moveBy(s: S, c: C, steps: number, via: 'dice' | 'travel' | 'mission') {
  const p = me(s);
  const from = p.pos;
  const to = (from + steps) % BOARD_SIZE;
  if (from + steps >= BOARD_SIZE) { p.coin += SALARY; p.laps = (p.laps ?? 0) + 1; } // 출발 통과(도착 포함). laps = 바퀴 하한(§3.3)의 단일 출처
  p.pos = to;
  push(s, { ev: 'move', seat: s.turn.seat, from, to, via });
  land(s, c, to);
}

const moveForwardTo = (s: S, c: C, tile: number, via: 'travel' | 'mission') =>
  moveBy(s, c, (tile - me(s).pos + BOARD_SIZE) % BOARD_SIZE || BOARD_SIZE, via);

function sendToIsland(s: S, via: 'dice' | 'mission') {
  const p = me(s);
  const from = p.pos;
  p.pos = ISLAND_TILE;
  p.islandTurns = ISLAND_TURNS;
  p.doubles = 0;
  s.turn.rolledDouble = false;
  push(s, { ev: 'move', seat: s.turn.seat, from, to: ISLAND_TILE, via });
  push(s, { ev: 'event', seat: s.turn.seat, kind: 'island', payload: {} });
}

// ── 도착 ─────────────────────────────────────────────────

function land(s: S, c: C, tile: number) {
  const seat = s.turn.seat;
  const p = me(s);
  const t = BOARD[tile];
  s.turn.tile = tile;
  switch (t.kind) {
    case 'start': // 출발·한국: 탐험형 — 문화 카드(한국) → 문항 → 해설 → 참/거짓 (§3.6). 월급은 moveBy 가 이미 줬다
    case 'country':
    case 'tourist': {
      const country = t.country!;
      const firstVisit = !s.seenCountries.includes(country);
      if (firstVisit) s.seenCountries.push(country);
      const card = c.culture.find((x) => x.country === country);
      if (t.kind === 'tourist') push(s, { ev: 'event', seat, kind: 'tourist', payload: { tile } });
      push(s, { ev: 'culture_card', seat, country, firstVisit, badgeShown: !!card?.badge });
      s.turn.step = 'culture';
      return;
    }
    case 'mission': return startMission(s, c);
    case 'antarctic': {
      const cards = c.cards.filter((x) => x.country === 'aq').map((x) => x.id).sort();
      return askOrDecide(s, c, cards, 'aq');
    }
    case 'island':
      p.islandTurns = ISLAND_TURNS;
      p.doubles = 0;
      s.turn.rolledDouble = false;
      push(s, { ev: 'event', seat, kind: 'island', payload: {} });
      return endTurn(s);
    case 'travel':
      p.travelPending = true;
      s.turn.rolledDouble = false;
      push(s, { ev: 'event', seat, kind: 'travel', payload: {} });
      return endTurn(s);
    case 'festival': {
      const fund = s.fund;
      p.coin += fund;
      s.fund = 0;
      push(s, { ev: 'event', seat, kind: 'festival', payload: { fund } });
      if (ownedBy(s, seat).length) { s.turn.step = 'festival'; return; }
      return endTurn(s);
    }
  }
}

/** 남극 탐험 뒤 기후 위기 발생(정답 무관, §3.6): 무작위 기후 사건이 무작위 한 대륙에 → 그 대륙 통행료 2턴 ×0.5 */
function startClimate(s: S) {
  const seat = s.turn.seat;
  const continent = CONTINENTS[randInt(s, CONTINENTS.length)];
  const kind = CLIMATE_KINDS[randInt(s, CLIMATE_KINDS.length)];
  s.climateEvent = { continent, turnsLeft: CLIMATE_TURNS, bySeat: seat };
  push(s, { ev: 'event', seat, kind: 'climate', payload: { continent, kind } });
}

/** 바퀴 하한(PRD §3.3, 2026-10-29 QA6): 도착자가 이 판에서 월급을 한 번이라도 받았으면(출발 통과·도착) 카드 단계 ≥ 2.
 *  3·4단계는 건물·방문으로만 오른다. 옛 저장본(laps 없음)은 0 */
const lapFloor = (s: S) => ((me(s).laps ?? 0) >= 1 ? 2 : 1);

function afterCulture(s: S, c: C) {
  const t = tileOf(s);
  if (t.kind === 'tourist' && !s.settings.touristQuiz) return decide(s, c);
  // 한국 = 방문 단계만(건물 없음, §3.3): 이 판에서 누구든 출발 칸에 도착한 횟수
  if (t.kind === 'start') {
    const visits = s.log.filter((e) => e.ev === 'culture_card' && e.country === t.country).length;
    return askOrDecide(s, c, [`${t.country}-${Math.min(4, Math.max(1, visits, lapFloor(s)))}`], tileCountry(t));
  }
  const st = s.tiles[t.index];
  // §3.3: 빈 땅·건물 없는 남의 땅 → 1, 내 땅 → 다음 단계, 남의 땅 → 현재 단계, 랜드마크 → 4
  const building = st.owner === s.turn.seat ? Math.min(4, st.level + 1) : Math.max(1, st.level);
  // 방문 단계: 이 판에서 누구든 이 칸에 도착한 횟수(이번 포함). 로그에서 세므로 복원해도 같다
  const visits = s.log.filter((e) => e.ev === 'culture_card' && e.country === t.country).length;
  const level = Math.max(building, Math.min(4, visits), lapFloor(s));
  askOrDecide(s, c, [`${t.country}-${level}`], tileCountry(t));
}

/** §3.3 출제 규칙 (2026-10-22 사용자 결정 반영). 도착하면 늘 퀴즈가 나온다.
 *  1) 도착 카드: 미공개 → 초출+전체판, 공개 → 복습+짧은판 → 같은 나라 다른 공개 카드 복습 → 참/거짓 형식
 *  2) 다 쓰면 같은 나라 다음 단계 카드(4 다음은 1로 돌아감)에서 빌림: 카드마다 초출 → 복습 → 참/거짓 형식
 *  3) 그 나라 문항·참/거짓을 전부 쓴 뒤에만 가장 오래전에 낸 것을 review: true 로 다시 낸다 */
function chooseQuestion(s: S, c: C, primary: string[], country: CountryId): PendingQuestion | null {
  const used = (id: string) => s.usedQuestionIds.includes(id) || s.usedTfIds.includes(id);
  const card = (id: string) => c.cards.find((x) => x.id === id);
  const variant = (id: string) => (s.revealedCards.includes(id) ? 'short' : 'full');
  const fromQ = (id: string, kind: 'initial' | 'review'): PendingQuestion | null => {
    const q = c.questions.find((x) => x.cardId === id && x.kind === kind && !used(x.id));
    const cd = card(id);
    return q && cd ? { qid: q.id, cardId: id, country, level: cd.level, format: 'choice', answer: q.answer, variant: variant(id), hintRemoved: [], review: false } : null;
  };
  const fromTf = (id: string): PendingQuestion | null => {
    const t = c.tf.find((x) => x.cardId === id && !used(x.id));
    const cd = card(id);
    return t && cd ? { qid: t.id, cardId: id, country, level: cd.level, format: 'tf', answer: t.answer, variant: 'short', hintRemoved: [], review: false } : null;
  };
  for (const id of primary) if (card(id) && !s.revealedCards.includes(id)) { const q = fromQ(id, 'initial'); if (q) return q; }
  const revealed = [...primary.filter((id) => s.revealedCards.includes(id)),
    ...s.revealedCards.filter((id) => !primary.includes(id) && card(id)?.country === country)];
  for (const id of revealed) { const q = fromQ(id, 'review'); if (q) return q; }
  for (const id of revealed) { const q = fromTf(id); if (q) return q; }
  // 빌림: 도착 카드 단계 다음부터 차례로 (같은 나라 카드 전부)
  const all = c.cards.filter((x) => x.country === country).sort((x, y) => x.level - y.level || x.id.localeCompare(y.id));
  const start = Math.max(...primary.map((id) => card(id)?.level ?? 0), 0);
  const order = [...all.filter((x) => x.level > start), ...all.filter((x) => x.level <= start)].map((x) => x.id);
  for (const id of order) { const q = fromQ(id, 'initial') ?? fromQ(id, 'review') ?? fromTf(id); if (q) return q; }
  // 전부 소진: 가장 오래전에 낸 것(usedQuestionIds 는 낸 순서, 다시 내면 뒤로 보낸다)
  const mine = new Set(all.map((x) => x.id));
  const cardOf = (id: string) => c.questions.find((x) => x.id === id)?.cardId ?? c.tf.find((x) => x.id === id)?.cardId;
  const oldest = [...s.usedQuestionIds, ...s.usedTfIds].find((id) => mine.has(cardOf(id) ?? ''));
  if (!oldest) return null; // 그 나라 콘텐츠가 아예 없을 때만(예: touristQuiz=true 인데 호주 카드 없음)
  const id = cardOf(oldest)!;
  const q = c.questions.find((x) => x.id === oldest);
  const cd = card(id)!;
  return q
    ? { qid: q.id, cardId: id, country, level: cd.level, format: 'choice', answer: q.answer, variant: 'short', hintRemoved: [], review: true }
    : { qid: oldest, cardId: id, country, level: cd.level, format: 'tf', answer: c.tf.find((x) => x.id === oldest)!.answer, variant: 'short', hintRemoved: [], review: true };
}

function askOrDecide(s: S, c: C, primary: string[], country: CountryId) {
  const q = chooseQuestion(s, c, primary, country);
  if (!q) return afterTf(s, c); // 콘텐츠 없는 칸만 여기로 온다
  if (q.review) {
    s.usedQuestionIds = s.usedQuestionIds.filter((x) => x !== q.qid);
    s.usedTfIds = s.usedTfIds.filter((x) => x !== q.qid);
  }
  s.usedQuestionIds.push(q.qid);
  s.turn.question = q;
  if (q.format === 'choice') {
    const src = c.questions.find((x) => x.id === q.qid)!;
    const mTags = [...new Set(src.choices.flatMap((ch) => ch.mTags ?? []))];
    push(s, { ev: 'question', seat: s.turn.seat, qid: q.qid, country, level: q.level, kind: src.kind, topics: src.topics, mTags, review: q.review });
  } else {
    const src = c.tf.find((x) => x.id === q.qid)!;
    push(s, { ev: 'question', seat: s.turn.seat, qid: q.qid, country, level: q.level, kind: 'review', topics: src.topics, mTags: src.mTags, review: q.review });
  }
  s.turn.step = 'question';
}

function useHint(s: S): boolean {
  const q = s.turn.question!;
  if (q.format !== 'choice' || q.hintRemoved.length || !useItem(me(s).items, 'hint')) return false;
  const wrong = [0, 1, 2, 3].filter((i) => i !== q.answer);
  wrong.splice(randInt(s, 3), 1);
  q.hintRemoved = wrong;
  return true;
}

function answer(s: S, c: C, choice: number | boolean | null, ms: number): boolean {
  const q = s.turn.question!;
  if (choice !== null) {
    const ok = q.format === 'choice'
      ? Number.isInteger(choice) && (choice as number) >= 0 && (choice as number) <= 3 && !q.hintRemoved.includes(choice as number)
      : typeof choice === 'boolean';
    if (!ok) return false;
  }
  const seat = s.turn.seat;
  const correct = choice !== null && choice === q.answer;
  const msOk = Number.isFinite(ms) ? Math.min(STEP_MS.question, Math.max(0, Math.round(ms))) : STEP_MS.question;
  // 고른 선지의 오개념 태그: 정답이면 [], 무응답이면 null. 참/거짓 형식 오답은 그 문장의 태그
  const chosenMTags = choice === null ? null : correct ? []
    : q.format === 'choice' ? c.questions.find((x) => x.id === q.qid)?.choices[choice as number].mTags ?? []
    : c.tf.find((x) => x.id === q.qid)?.mTags ?? [];
  push(s, { ev: 'answer', seat, qid: q.qid, choice, correct, ms: msOk, isBot: s.seats[seat].isBot, chosenMTags });
  s.turn.correct = correct;
  s.turn.discount = correct;
  if (correct) push(s, { ev: 'stamp', seat, country: q.country, level: q.level });
  if (!s.revealedCards.includes(q.cardId)) s.revealedCards.push(q.cardId);
  s.turn.step = 'explanation';
  return true;
}

/** 해설 단계 끝: explanation 이벤트(shownTo = 봇 또는 기기가 shown 을 보낸 자리) → 관전 참/거짓 */
function afterExplanation(s: S, c: C, shown: Seat[]) {
  const q = s.turn.question!;
  const prev = s.log[s.log.length - 1];
  // T05c 전 저장본은 답할 때 이미 남겼다(그 방을 해설 중에 복원하면 두 번 남기지 않는다)
  if (!(prev?.ev === 'explanation' && prev.qid === q.qid)) {
    push(s, {
      ev: 'explanation', qid: q.qid, cardId: q.cardId, variant: q.variant,
      shownTo: s.seats.map((x, i) => x.isBot || shown.includes(i as Seat)),
      shownMs: q.variant === 'full' ? STEP_MS.explanationFull : STEP_MS.explanationShort,
    });
  }
  const fresh = (x: { id: string }) => x.id !== q.qid && !s.usedTfIds.includes(x.id) && !s.usedQuestionIds.includes(x.id);
  // 이 카드에 안 쓴 문장이 없으면 같은 나라 다른 카드에서 빌린다
  const sameCard = c.tf.filter((x) => x.cardId === q.cardId && fresh(x));
  const mine = (x: { cardId: string }) => c.cards.find((k) => k.id === x.cardId)?.country === q.country;
  const pool = sameCard.length ? sameCard : c.tf.filter((x) => fresh(x) && mine(x));
  if (pool.length) {
    const t = pool[randInt(s, pool.length)];
    s.usedTfIds.push(t.id);
    s.turn.tf = { stmtId: t.id, answer: t.answer, answers: [] };
    s.turn.step = 'tf';
    return;
  }
  // 그 나라 문장을 다 썼으면 가장 오래전에 낸 문장을 review 로 다시 낸다(문항 복습 재출제와 같은 원칙). 다시 낸 것은 맨 뒤로
  const ids = new Set(c.tf.filter((x) => x.id !== q.qid && mine(x)).map((x) => x.id));
  const oldest = [...s.usedTfIds, ...s.usedQuestionIds].find((id) => ids.has(id));
  const t = oldest ? c.tf.find((x) => x.id === oldest)! : null;
  if (!t) return afterTf(s, c); // 그 나라 문장이 아예 없을 때만
  s.usedTfIds = [...s.usedTfIds.filter((x) => x !== t.id), t.id];
  s.usedQuestionIds = s.usedQuestionIds.filter((x) => x !== t.id);
  s.turn.tf = { stmtId: t.id, answer: t.answer, answers: [], review: true };
  s.turn.step = 'tf';
}

function tfAnswer(s: S, c: C, seat: Seat, value: boolean): boolean {
  const tf = s.turn.tf!;
  if (seat === s.turn.seat || s.players[seat].bankrupt || typeof value !== 'boolean' || tf.answers.some((x) => x.seat === seat)) return false;
  tf.answers.push({ seat, value });
  // 미션 실패 tf: 도착자 화면에 정답·해설(reveal)이 tf 창(STEP_MS.tf) 동안 떠 있다 → 다 답해도 응답만 저장하고 timeout 까지 연다(PRD §3.5)
  if (holdsReveal(s)) return true;
  const eligible = s.players.filter((p, i) => i !== s.turn.seat && !p.bankrupt).length;
  if (tf.answers.length === eligible) closeTf(s, c);
  return true;
}

/** 지금 tf 단계가 미션 실패 정답·해설을 보여 주는 창인가(이때는 관전자가 다 답해도 마감까지 닫지 않는다) */
export function holdsReveal(s: GameState): boolean {
  const t = s.turn;
  return t.step === 'tf' && t.missionId !== null && !t.missionSuccess && t.tf?.stmtId === `${t.missionId}-tf`;
}

function closeTf(s: S, c: C) {
  const tf = s.turn.tf!;
  // tf 이벤트는 닫을 때 남긴다: mTag(거짓 문장이면 M 번호)가 답하는 동안 방송 로그로 정답을 흘리지 않게
  const m = s.turn.missionId !== null && tf.stmtId === `${s.turn.missionId}-tf` ? c.missions.find((x) => x.id === s.turn.missionId) : undefined;
  const st = m ? null : c.tf.find((x) => x.id === tf.stmtId);
  if (m) push(s, { ev: 'tf', cardId: m.id, stmtId: tf.stmtId, mTag: m.spectatorTf.mTags[0] ?? null, topics: m.topics, review: false });
  else if (st) push(s, { ev: 'tf', cardId: st.cardId, stmtId: st.id, mTag: st.mTags[0] ?? null, topics: st.topics, review: !!tf.review });
  s.seats.forEach((x, i) => {
    if (i === s.turn.seat) return;
    const value = tf.answers.find((a) => a.seat === i)?.value ?? null;
    const correct = value === tf.answer;
    if (correct && !s.players[i].bankrupt) s.players[i].coin += TF_REWARD;
    push(s, { ev: 'tf_answer', seat: i as Seat, stmtId: tf.stmtId, value, correct, isBot: x.isBot });
  });
  s.turn.tf = null;
  afterTf(s, c);
}

function afterTf(s: S, c: C) {
  const t = tileOf(s);
  if (t.kind === 'mission') return s.turn.missionSuccess ? offerRewards(s) : endTurn(s);
  if (t.kind === 'antarctic') return antarcticReward(s);
  if (t.kind === 'start') return koreaReward(s);
  decide(s, c);
}

// ── 행동: 구매·건설·통행료·인수 ─────────────────────────────

function decide(s: S, c: C) {
  const t = tileOf(s);
  const st = s.tiles[t.index];
  const p = me(s);
  const correct = s.turn.correct === true;
  if (st.owner === null) {
    if (p.coin >= landPrice(t.index, correct)) { s.turn.step = 'action'; return; }
    return endTurn(s);
  }
  if (st.owner === s.turn.seat) {
    if (correct && t.kind === 'country' && st.level < 4 && p.coin >= buildCost(t.index, st.level + 1)) { s.turn.step = 'action'; return; }
    return endTurn(s);
  }
  if (p.items.includes('tollFree') || p.items.includes('tollHalf')) { s.turn.step = 'toll'; return; }
  payToll(s, null);
}

function payToll(s: S, item: 'tollFree' | 'tollHalf' | null) {
  const seat = s.turn.seat;
  const t = tileOf(s);
  const st = s.tiles[t.index];
  const owner = st.owner!;
  const correct = s.turn.correct === true;
  const q = tollQuote(s, t.index, correct, item);
  if (q.itemUsed && item) useItem(me(s).items, item);
  const paid = charge(s, seat, q.paid, owner);
  // 기후 위기로 깎인 차액(주인이 못 받은 몫)은 은행 기금에 쌓인다(§3.6). 다 못 내고 파산하면 실제로 낸 비율만큼만 — 없던 코인을 만들지 않는다
  if (q.climateCut > 0 && q.paid > 0) s.fund += Math.round((q.climateCut * paid) / q.paid);
  push(s, { ev: 'toll', payer: seat, owner, tile: t.index, base: q.base, multiplier: q.multiplier, discounted: q.discounted, paid });
  if (s.phase !== 'playing') return;
  const cost = takeoverCost(s, t.index);
  if (!me(s).bankrupt && correct && t.kind === 'country' && st.level <= TAKEOVER_MAX_LEVEL && me(s).coin >= cost) {
    s.turn.takeoverCost = cost;
    s.turn.step = 'takeover';
    return;
  }
  endTurn(s);
}

function buy(s: S): boolean {
  const t = tileOf(s);
  const st = s.tiles[t.index];
  const p = me(s);
  const correct = s.turn.correct === true;
  const price = landPrice(t.index, correct);
  // 살 수 있는 칸은 여행지·관광지뿐(출발·한국 등 특수 칸은 소유 불가, §3.6)
  if ((t.kind !== 'country' && t.kind !== 'tourist') || st.owner !== null || p.coin < price) return false;
  p.coin -= price;
  st.owner = s.turn.seat;
  push(s, { ev: 'buy', seat: s.turn.seat, tile: t.index, price, discounted: correct });
  if (!checkMonopoly(s)) endTurn(s);
  return true;
}

function build(s: S): boolean {
  const t = tileOf(s);
  const st = s.tiles[t.index];
  const p = me(s);
  if (st.owner !== s.turn.seat || s.turn.correct !== true || t.kind !== 'country' || st.level >= 4) return false;
  const level = (st.level + 1) as 1 | 2 | 3 | 4;
  const cost = buildCost(t.index, level);
  if (p.coin < cost) return false;
  p.coin -= cost;
  st.level = level;
  push(s, { ev: 'build', seat: s.turn.seat, tile: t.index, level, cost });
  if (!checkMonopoly(s)) endTurn(s); // 4칸 대륙: 건물이 마지막 조건일 수 있다(㉒)
  return true;
}

function takeover(s: S, c: C): boolean {
  const owner = s.tiles[s.turn.tile!].owner!;
  if (me(s).coin < s.turn.takeoverCost || s.tiles[s.turn.tile!].level > TAKEOVER_MAX_LEVEL) return false;
  if (s.players[owner].items.includes('shield')) { s.turn.step = 'shield'; return true; }
  doTakeover(s);
  return true;
}

function doTakeover(s: S) {
  const tile = s.turn.tile!;
  const st = s.tiles[tile];
  const cost = s.turn.takeoverCost;
  me(s).coin -= cost;
  s.players[st.owner!].coin += cost;
  st.owner = s.turn.seat; // 건물 승계
  st.festivalTarget = false;
  push(s, { ev: 'takeover', seat: s.turn.seat, tile, correct: true, shielded: false, cost });
  if (!checkMonopoly(s)) endTurn(s); // 인수한 턴엔 건설 없음
}

function blockTakeover(s: S) {
  const tile = s.turn.tile!;
  useItem(s.players[s.tiles[tile].owner!].items, 'shield');
  push(s, { ev: 'takeover', seat: s.turn.seat, tile, correct: true, shielded: true, cost: 0 });
  endTurn(s);
}

// ── 코인 지불·파산·승리 ──────────────────────────────────

/** 강제 지불. 모자라면 건물 → 땅 순으로 팔고, 그래도 모자라면 있는 만큼 내고 파산. 실제 낸 금액을 돌려준다 */
function charge(s: S, seat: Seat, amount: number, to: Seat | 'fund'): number {
  const p = s.players[seat];
  if (p.coin < amount) {
    const mine = ownedBy(s, seat);
    const before = mine.map((i) => s.tiles[i].level);
    for (const i of mine) {
      const st = s.tiles[i];
      while (p.coin < amount && st.level > 0) { p.coin += Math.round(buildCost(i, st.level) * SELL_RATE); st.level--; }
    }
    for (const i of mine) {
      if (p.coin >= amount) break;
      p.coin += Math.round((BOARD[i].price ?? 0) * SELL_RATE);
      s.tiles[i] = { owner: null, level: 0, festivalTarget: false };
    }
    // 판 칸마다 한 번: 건물을 잃었거나 땅을 팔았으면(결과 화면이 잃은 랜드마크를 빼도록)
    mine.forEach((i, k) => {
      if (s.tiles[i].level !== before[k] || s.tiles[i].owner !== seat) push(s, { ev: 'sold', seat, tile: i, levelBefore: before[k] });
    });
  }
  const paid = Math.max(0, Math.min(amount, p.coin));
  p.coin -= paid;
  if (to === 'fund') s.fund += paid;
  else s.players[to].coin += paid;
  if (paid < amount) goBankrupt(s, seat);
  return paid;
}

function goBankrupt(s: S, seat: Seat) {
  const p = s.players[seat];
  Object.assign(p, { coin: 0, bankrupt: true, items: [], islandTurns: 0, travelPending: false, doubles: 0 });
  s.tiles.forEach((t, i) => { if (t.owner === seat) s.tiles[i] = { owner: null, level: 0, festivalTarget: false }; });
  const alive = s.players.flatMap((x, i) => (x.bankrupt ? [] : [i as Seat]));
  if (alive.length === 1) finish(s, alive[0], 'bankruptcy');
}

function checkMonopoly(s: S): boolean {
  const seat = s.turn.seat;
  const has = (i: number) => s.tiles[i].owner === seat;
  // 독점승 = 한 대륙 여행지 칸 전부 (관광지 쌍 불필요, PRD c9d27ac). 한국·호주는 어느 대륙에도 안 든다
  // 4칸 대륙은 그 대륙 칸에 건물 1개 이상도 있어야 한다(PRD §3.7 ㉒) → 건설로도 독점이 성립할 수 있다
  const won = CONTINENTS.filter((k) => continentTiles(k).every(has)
    && (!monopolyNeedsBuilding(k) || continentTiles(k).some((i) => s.tiles[i].level >= 1)));
  if (!won.length) return false;
  // 독점 성립: 로그 + 영구 상태(광장 지도·이정표 자리색, 결과 화면 — §3.7)
  for (const continent of won) {
    if (s.monopolies.some((m) => m.continent === continent && m.seat === seat)) continue;
    s.monopolies.push({ continent, seat });
    push(s, { ev: 'event', seat, kind: 'monopoly', payload: { continent } });
  }
  finish(s, seat, 'monopoly');
  return true;
}

function ranks(s: S): Seat[] {
  const assets = s.players.map((_, i) => assetsOf(s, i));
  return s.players.map((_, i) => i as Seat).sort((a, b) =>
    Number(s.players[a].bankrupt) - Number(s.players[b].bankrupt) || assets[b] - assets[a] || a - b);
}

function finish(s: S, seat: Seat, kind: 'bankruptcy' | 'monopoly' | 'assets') {
  s.winner = { seat, kind };
  s.phase = 'finished';
  s.clock.pauseBy = null;
  push(s, { ev: 'clock', kind: 'end', remainingMs: s.clock.remainingMs, by: kind === 'assets' ? 'timeout' : 'auto' });
  // 1위 = 실제 승자(파산승·독점승은 자산 순위와 다를 수 있다 — PRD §3.7). 나머지는 자산순
  push(s, { ev: 'result', finalRanks: [seat, ...ranks(s).filter((x) => x !== seat)], assets: s.players.map((_, i) => assetsOf(s, i)) });
}

const atTurnStart = (s: S) => s.turn.step === 'roll' || s.turn.step === 'travel';

/** 놀이 시간이 다 됨 → 자산승(PRD §3.7) */
function timeUp(s: S) {
  finish(s, ranks(s)[0], 'assets');
}

/** 멈춤: 시계 정지, 턴은 다음 사람 시작 단계에서 기다린다 */
function pauseNow(s: S) {
  const by = s.clock.pauseBy ?? 'host';
  s.phase = 'paused';
  s.clock.pauseBy = null;
  push(s, { ev: 'clock', kind: 'pause', remainingMs: s.clock.remainingMs, by });
}

// ── 턴 넘김 ──────────────────────────────────────────────

function endTurn(s: S) {
  if (s.phase !== 'playing') return;
  const seat = s.turn.seat;
  const p = s.players[seat];
  const again = !p.bankrupt && (s.turn.extraRoll || (s.turn.rolledDouble && p.islandTurns === 0 && !p.travelPending));
  let next = seat;
  if (!again) {
    p.doubles = 0;
    for (let k = 1; k <= s.players.length; k++) {
      const n = ((seat + k) % s.players.length) as Seat;
      if (s.climateEvent?.bySeat === n) tickClimate(s); // 파산한 자리도 지나가며 센다
      if (!s.players[n].bankrupt) { next = n; break; }
    }
  }
  s.turn = freshTurn(next); // 할인 플래그 등 이 도착의 상태는 여기서 사라진다
  if (!again && s.players[next].travelPending) s.turn.step = 'travel';
  if (s.clock.remainingMs === 0) timeUp(s);
  else if (s.clock.pauseBy) pauseNow(s);
}

/** 기후 위기: 일으킨 자리 차례가 돌아올 때마다(=한 바퀴) 1 줄어든다 */
function tickClimate(s: S) {
  const e = s.climateEvent!;
  if (--e.turnsLeft <= 0) s.climateEvent = null;
}

// ── 미션·보상·특수 ────────────────────────────────────────

/** 방이 이 판에서 만난 대번호(PRD §6 S3 '만남' = 도착 문항·참/거짓·미션 topics 합산). 로그에서 세므로 복원해도 같다 */
export function metMajors(log: readonly LogEvent[]): Set<string> {
  const met = new Set<string>();
  for (const e of log) if (e.ev === 'question' || e.ev === 'tf' || e.ev === 'mission') for (const t of e.topics) met.add(String(t).split('.')[0]);
  return met;
}
/** 학습 커버리지 대상 대번호(교과분석: 2~5 지형, 7~10 기후) */
export const COVERAGE_MAJORS = ['2', '3', '4', '5', '7', '8', '9', '10'] as const;

function startMission(s: S, c: C) {
  const fresh = c.missions.filter((m) => !s.usedMissionIds.includes(m.id));
  // §3.5 활동 고르기(2026-10-29 QA6): 안 쓴 활동 중 방이 아직 못 만난 대번호를 가진 것을 먼저. 없으면 안 쓴 전체, 다 썼으면 40 전체
  const met = metMajors(s.log);
  const missing = new Set<string>(COVERAGE_MAJORS.filter((m) => !met.has(m)));
  const prefer = fresh.filter((m) => m.topics.some((t) => missing.has(String(t).split('.')[0])));
  const pool = prefer.length ? prefer : fresh.length ? fresh : c.missions;
  if (!pool.length) return endTurn(s);
  const m = pool[randInt(s, pool.length)];
  if (!s.usedMissionIds.includes(m.id)) s.usedMissionIds.push(m.id);
  s.turn.missionId = m.id;
  s.turn.step = 'mission';
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

function judgeMission(m: Mission, a: MissionAnswer | null): boolean {
  if (!a || typeof a !== 'object') return false;
  const key = (p: { left: string; right: string }) => `${p.left}\u0001${p.right}`;
  switch (m.type) {
    case 'connect':
    case 'block':
      return Array.isArray(a.pairs) && !!m.pairs && sameSet(a.pairs.map((p) => key(p ?? { left: '', right: '' })), m.pairs.map(key));
    case 'order':
      return Array.isArray(a.steps) && !!m.steps && a.steps.length === m.steps.length && a.steps.every((x, i) => x === m.steps![i]);
    default:
      return Array.isArray(a.selected) && !!m.options &&
        sameSet(a.selected.map(String), m.options.flatMap((o, i) => (o.correct ? [String(i)] : [])));
  }
}

function missionResult(s: S, c: C, ans: MissionAnswer | null, ms: number): boolean {
  const m = c.missions.find((x) => x.id === s.turn.missionId);
  if (!m) return false;
  const success = judgeMission(m, ans);
  push(s, {
    ev: 'mission', seat: s.turn.seat, missionId: m.id, type: m.type, topics: m.topics, mTags: m.mTags,
    analytic: m.analytic, success, ms: Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : STEP_MS.mission,
  });
  s.turn.missionSuccess = success;
  const stmtId = `${m.id}-tf`;
  s.turn.tf = { stmtId, answer: m.spectatorTf.answer, answers: [] };
  s.turn.step = 'tf';
  return true;
}

function offerRewards(s: S) {
  const p = me(s);
  const pool: Reward[] = ['travelTile', 'island', 'doubleRoll', 'toStart'];
  if (ownedBy(s, s.turn.seat).length) pool.push('toMyLand');
  if (s.fund > 0) pool.push('takeFund');
  if (p.items.length < ITEM_LIMIT) pool.push(...KEEP_ITEMS);
  const n = 2 + randInt(s, 2); // 무작위 2~3개 중 하나
  const opts: Reward[] = [];
  while (opts.length < n) opts.push(...pool.splice(randInt(s, pool.length), 1));
  s.turn.rewardOptions = opts;
  s.turn.step = 'reward';
}

function chooseReward(s: S, c: C, index: number): boolean {
  const r = s.turn.rewardOptions[index];
  if (!Number.isInteger(index) || !r) return false;
  const p = me(s);
  s.turn.rewardOptions = [];
  switch (r) {
    case 'travelTile': moveForwardTo(s, c, TRAVEL_TILE, 'mission'); break;
    case 'island': sendToIsland(s, 'mission'); endTurn(s); break;
    case 'doubleRoll': s.turn.extraRoll = true; endTurn(s); break;
    case 'toStart': moveForwardTo(s, c, 0, 'mission'); break;
    case 'toMyLand': s.turn.step = 'pickTile'; break;
    case 'takeFund':
      push(s, { ev: 'event', seat: s.turn.seat, kind: 'fund', payload: { received: s.fund } });
      p.coin += s.fund;
      s.fund = 0;
      endTurn(s);
      break;
    default: p.items.push(r); endTurn(s);
  }
  return true;
}

function pickFestival(s: S, tile: number | null) {
  if (tile !== null) {
    s.tiles.forEach((t) => { if (t.owner === s.turn.seat) t.festivalTarget = false; });
    s.tiles[tile].festivalTarget = true;
  }
  endTurn(s);
}

function antarcticReward(s: S) {
  const p = me(s);
  const correct = s.turn.correct === true;
  let item: ItemKind | null = null;
  if (correct) {
    p.coin += ANTARCTIC_BONUS;
    if (p.items.length < ITEM_LIMIT) p.items.push((item = KEEP_ITEMS[randInt(s, KEEP_ITEMS.length)]));
  }
  push(s, { ev: 'event', seat: s.turn.seat, kind: 'antarctic', payload: { correct, bonus: correct ? ANTARCTIC_BONUS : 0, item } });
  startClimate(s);
  endTurn(s);
}

/** 출발·한국 탐험 끝: 정답이면 보너스 코인만(아이템 없음 — 자주 도착하는 칸이라 아이템 풀 과잉 방지, §3.6) */
function koreaReward(s: S) {
  const correct = s.turn.correct === true;
  if (correct) me(s).coin += KOREA_BONUS;
  push(s, { ev: 'event', seat: s.turn.seat, kind: 'korea', payload: { correct, bonus: correct ? KOREA_BONUS : 0 } });
  endTurn(s);
}
