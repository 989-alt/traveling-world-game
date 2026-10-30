// 방 하나 = Durable Object 하나 (PRD §9, §10). 판정은 전부 엔진, 시간·자리·저장은 여기.
// 저장: 키 `room` 한 개(JSON, 로그 뺀 전체) + 로그는 append-only 조각 `log:000000`…
// 시간: 알람은 하나뿐이라 턴 마감·봇 뜸·끊김 30초·전원 끊김 60초 멈춤·놀이 시간 끝·14일 만료 중 가장 이른 것에 건다.
import { apply, createGame, stepMs } from '../src/engine/engine';
import {
  CHAR_COUNT, CODE_RE, CUT_RESUME_MS, CUTSCENE_MS, NICK_ADJ_COUNT, NICK_ANIMAL_COUNT, parseClient, parseSettings, PIN_TRY_MS, stepKey,
} from '../src/shared/protocol';
import type { ClientAct, ClientMsg, ErrorCode, MissionReveal, MissionShown, PublicCard, PublicGame, ServerMsg } from '../src/shared/protocol';
import { TOTAL_MINUTES } from '../src/shared/types';
import type { Action, Content, GameState, LogEvent, MissionAnswer, Seat, Settings, TotalMinutes } from '../src/shared/types';
import { BOT_ACCURACY } from '../src/shared/economy';
import type { Mission } from '../src/shared/content-types';
import { BOARD } from '../src/shared/board';
import { MAP_OF_IMAGE, SPOT_OF, ZONE_OF_LABEL } from '../src/ui/missions/map-spots';
import cards from '../src/data/cards.json';
import questions from '../src/data/questions.json';
import tf from '../src/data/tf.json';
import culture from '../src/data/culture-cards.json';
import missions from '../src/data/missions.json';
import { missionReveal } from './reveal';
import { botAction, botDelayMs, botSeats, drawAccuracy } from '../src/engine/bot';
import { nextFloat } from '../src/engine/rng';
import { movesShowMs, PICK_BOT_FLASH_MS } from '../src/shared/timing';

export const CONTENT = { cards, questions, tf, culture, missions } as unknown as Content;
export const EXPIRE_MS = 14 * 86_400_000;
export const OFFLINE_BOT_MS = 30_000;
/** 사람 자리 전원이 이만큼 끊기면 서버가 멈춘다(봇끼리 시계를 태우지 않게, PRD §3.7) */
export const AUTO_PAUSE_MS = 60_000;
export const LOG_CAP_BYTES = 2 * 1024 * 1024;
export const MAX_BAD_PINS = 5;
export const PIN_LOCK_MS = 60_000;
/** 기기는 카드를 받은 뒤 표시 시간을 다 채우고 shown 을 보내므로 마감보다 늦게 닿는다(왕복 지연). 그만큼만 더 기다린다 */
export const SHOWN_WAIT_MS = 2_000;
/** 단계 시작부터 (표시 시간 − 이만큼)이 지나기 전에 온 shown 은 버린다(망·시계 오차 여유) */
export const SHOWN_SLACK_MS = 1_000;

interface SeatRec {
  pin: string;
  nick: [number, number];
  charId: number;
  claimed: boolean; // 사람이 앉은 적 있음
  connected: boolean;
  lastSeen: number;
  offSince: number | null; // 끊긴 시각(게임 중). 30초 지나면 봇
  returning: boolean; // 봇 자리에 사람이 돌아옴 — 자기 턴이 아닐 때 사람으로
  badPins: number; // 이 자리 PIN 연속 실패(모든 소켓 합산)
  lockedUntil: number; // 5번 틀리면 이 시각까지 잠금: PIN 비교를 PIN_TRY_MS 에 한 번만
  tryAt: number; // 잠긴 동안 다음 PIN 비교를 받는 시각(모든 소켓 합산)
}

export interface RoomRec {
  /** 저장 꼴 판. 필드를 더하면 REC_V 를 올리고 migrate() 에 기본값을 둔다 */
  v: number;
  code: string;
  settings: Settings;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
  hostSeat: Seat;
  seats: SeatRec[];
  game: Omit<GameState, 'log'> | null;
  lastTickAt: number | null;
  deadlineAt: number | null;
  stepKey: string;
  /** 지금 단계가 시작된 서버 시각. 답 ms 는 이 값으로 잰다 */
  stepAt: number;
  botAt: number | null;
  botStuck: string; // 이 stepKey 에서 봇 입력이 전부 거부됨 → timeout 까지 기다림
  /** 봇 정답률: 판마다 자리별로 한 번 뽑는다(§4.5). 끊겨 봇이 되는 자리도 같은 값 */
  botAccuracy: number[];
  /** 봇 rng 상태(uint32). 주사위처럼 시드에서 나오고 저장되므로 복원 뒤에도 같은 수열 */
  botRng: number;
  logLen: number;
  logBytes: number;
  logChunks: number;
  /** 지금(또는 마지막) 연결·블록·순서 미션의 표시 순서. 저장되므로 복원·재접속 뒤에도 같다 */
  missionOrder: MissionOrder | null;
  /** 랜드마크 컷씬(build 4)을 본 서버 시각과 그때 차례. 다음 문항 하나에만 남은 컷씬 시간을 더한다 */
  cutscene: { at: number; seat: Seat; next: Seat | null } | null;
  /** 컷씬을 찾으려고 훑은 로그 길이(같은 이벤트로 다시 켜지 않게). 이동 연출 시간도 같은 구간에서 센다 */
  cutsceneScan: number;
  /** 이 시각까지 이동 연출(줌·홉) 중 — 봇은 그 뒤에 움직인다(R4 T-E) */
  showUntil?: number;
  /** 마지막 랜드마크 컷씬: 칸·세운 자리·서버 시작 시각. 재접속한 기기가 남은 구간을 잇는다(DESIGN §12.3). 위 cutscene(마감 유예용)과 따로 */
  lastCut: { tile: number; seat: Seat; at: number } | null;
  /** shownKey 해설 단계에서 shown 을 보낸 자리. 해설을 닫을 때 엔진에 넘긴다.
   *  단계 키로 묶어 두므로 같은 해설 단계로 돌아오면(정지·재개 등) 받은 것이 그대로 남는다 */
  shown: Seat[];
  shownKey: string;
  /** 해설 마감이 됐는데 아직 shown 이 안 온 기기가 있어 SHOWN_WAIT_MS 만큼 더 기다리는 중 */
  shownWait: boolean;
  /** 대기실 안내. 새 판을 시작하면 지운다.
   *  oldBoard = 옛 판(40칸·옛 시계) 게임 저장본을 버림, oldTime = 20분 게임 저장본을 버림,
   *  newTime = 대기실 저장본의 옛 놀이 시간 설정을 40분으로 바꿈(U123 L3·L4) */
  notice: Notice;
}

interface Att { seat: Seat | null }
type Notice = 'oldBoard' | 'oldTime' | 'newTime' | null;

/** 4 = 2026-10-26 판 재설계(30칸). 5 = 2026-10-28 U1 놀이 시간(settings.totalMinutes·clock).
 *  4 이하 저장본의 게임은 옛 시계(lesson)라 이어 할 수 없다(migrate 없음, PRD §9.1).
 *  6 = 2026-10-28 U3 20분 삭제: 5 저장본도 migrateSettings 를 다시 거친다(대기실 20 → 40, 20분 게임은 dropOldBoard)
 *  7 = 2026-10-29 QA6 players.laps(바퀴 하한). 옛 저장본은 0 으로 복원(PRD §9.1) */
export const REC_V = 7;
/** 이 판 이전 저장본의 게임은 버린다(보드·시계 꼴이 다름) */
export const BOARD_REC_V = 5;
/** 옛 설정(lessons·minutesPerLesson) → 놀이 시간. 대기실 저장본만 여기까지 온다(게임은 dropOldBoard 가 버림) */
function migrateSettings(v: unknown): Settings {
  const o = (v ?? {}) as Partial<Settings>;
  return { totalMinutes: TOTAL_MINUTES.includes(o.totalMinutes!) ? o.totalMinutes! : 40, touristQuiz: o.touristQuiz === true };
}
/** 저장된 놀이 시간이 지금 고를 수 있는 값이 아니다(옛 차시 설정·20분) → migrateSettings 가 40 으로 바꾼다 */
const oldMinutes = (v: unknown) => !TOTAL_MINUTES.includes((v as Partial<Settings> | null)?.totalMinutes as TotalMinutes);
/** 옛 저장본(botAccuracy 없음)용: 그 놀이 시간 범위의 가운데 */
const midAccuracy = (m: unknown) => {
  const [lo, hi] = BOT_ACCURACY[TOTAL_MINUTES.includes(m as TotalMinutes) ? (m as TotalMinutes) : 40];
  return (lo + hi) / 2;
};
/** 봇 rng 시드: 주사위 시드와 같은 출처, 다른 수열 */
const botSeed = (seed: number) => (seed ^ 0x9e3779b9) >>> 0;

/** 옛 저장본(v 없음)에 없던 필드를 채운다. 저장 꼴 기본값은 여기 한 곳에만 */
export function migrate(rec: RoomRec): RoomRec {
  if (rec.v === REC_V) return rec;
  const r = rec as RoomRec & Partial<RoomRec>;
  r.stepAt ??= r.lastActiveAt;
  r.botAt ??= null;
  r.botStuck ??= '';
  r.botAccuracy ??= r.seats.map(() => midAccuracy(r.settings?.totalMinutes)); // 그 길이 범위(BOT_ACCURACY)의 가운데
  r.botRng ??= r.game ? botSeed(r.game.rngSeed) : 0;
  r.missionOrder ??= null;
  r.cutscene ??= null;
  r.cutsceneScan ??= r.logLen;
  r.lastCut ??= null;
  r.shown ??= [];
  r.shownKey ??= '';
  r.shownWait ??= false;
  r.notice ??= null;
  // 대기실만 있는 옛 저장본의 놀이 시간이 40분으로 바뀌면 방장이 알 수 있게 안내(U123 L4). 게임 저장본은 dropOldBoard 가 먼저 안내를 단다
  if (!r.game && !r.notice && oldMinutes(r.settings)) r.notice = 'newTime';
  r.settings = migrateSettings(r.settings);
  // claimed 없는 저장본: 사람이 한 번이라도 앉았으면(lastSeen 이 찍힘) true. 시작부터 봇·빈자리는 false(PRD §9.1 QA8)
  for (const s of r.seats) { s.badPins ??= 0; s.lockedUntil ??= 0; s.tryAt ??= 0; s.claimed ??= s.lastSeen > 0; }
  for (const p of r.game?.players ?? []) p.laps ??= 0;
  r.v = REC_V;
  return r;
}

/** 옛 판(BOARD_REC_V 이전) 저장본에 게임이 있으면 버리고 대기실로 돌린다. 자리·PIN·방장은 그대로(같은 기기로 다시 앉는다).
 *  끝난 판도 버린다(PRD §9.1 — 옛 칸 번호는 현재 판과 나라가 달라 결과·카드를 바르게 그릴 수 없다).
 *  버렸으면 true — 호출자가 로그 조각(log:*)을 지운다. 게임 없는 대기실 저장본은 그대로 둔다. */
export function dropOldBoard(rec: RoomRec): boolean {
  // 2026-10-28 U3: 20분 판 저장본도 같은 길(재개 불가, 새 판 안내). 대기실 설정 20 은 migrateSettings 가 40 으로
  const oldBoard = (rec.v ?? 0) < BOARD_REC_V;
  const oldTime = (rec.game?.settings?.totalMinutes as number) === 20;
  if (!(oldBoard || oldTime) || !rec.game) return false;
  Object.assign(rec, {
    game: null, lastTickAt: null, deadlineAt: null, stepKey: 'lobby', botAt: null, botStuck: '',
    logLen: 0, logBytes: 0, logChunks: 0, missionOrder: null, cutscene: null, cutsceneScan: 0, lastCut: null,
    shown: [], shownKey: '', shownWait: false, notice: oldBoard ? 'oldBoard' : 'oldTime',
  });
  for (const s of rec.seats) Object.assign(s, { offSince: null, returning: false });
  return true;
}

/** 미션 표시 순서: 표시 번호 d → 원래 번호. left·right 는 pairs, steps 는 steps 의 번호 */
export interface MissionOrder { id: string; left: number[]; right: number[]; steps: number[] }

const fnv = (str: string) => {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};

/** 시드 결정적 순열(Fisher–Yates, mulberry32). 항등 순서는 피한다(순서 미션이면 정답이 그대로 보이므로) */
export function permute(seed: number, n: number): number[] {
  let st = seed >>> 0;
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const [v, next] = nextFloat(st);
    st = next;
    const j = Math.floor(v * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  if (n > 1 && a.every((v, i) => v === i)) a.push(a.shift()!);
  return a;
}

/** 방 시드 + 미션 + 출제 시점(로그 길이)에서 좌·우·단계 순열을 각각 따로 뽑는다 */
export function missionOrder(seed: number, m: Mission, salt: number): MissionOrder {
  const p = (k: string, n: number) => permute((seed ^ fnv(`${m.id}|${salt}|${k}`)) >>> 0, n);
  const n = m.pairs?.length ?? 0;
  const left = p('L', n);
  let right = p('R', n);
  // 좌·우가 같은 순열이면 줄마다 짝이 나란히 선다 → 오른쪽을 한 칸 돌린다
  if (n > 1 && right.every((v, i) => v === left[i])) right = [...right.slice(1), right[0]];
  return { id: m.id, left, right, steps: p('S', m.steps?.length ?? 0) };
}

const SHUFFLED = new Set<Mission['type']>(['connect', 'block', 'order']);

const rand4 = () => String(crypto.getRandomValues(new Uint16Array(1))[0] % 10000).padStart(4, '0');
const randInt = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;

export class Room {
  rec: RoomRec | null = null;
  game: GameState | null = null;
  /** 엔진에 넘길 문항 풀. 테스트는 고정 픽스처로 바꿔 끼운다 */
  content: Content = CONTENT;
  private dirty = false;
  private resync: WebSocket | null = null; // 이 처리 끝에 전체 로그를 받을 기기(입장·sync)
  /** 이 처리에서 봇이 칸을 골랐다(세계여행·내 땅으로·축제 지정) → 화면은 그 칸을 PICK_BOT_FLASH_MS 반짝인 뒤 이동한다 */
  private botPicked = false;

  constructor(private ctx: DurableObjectState, _env: unknown) {
    this.load();
  }

  // ── 저장·복원 ───────────────────────────────────────────

  private load() {
    const kv = this.ctx.storage.kv;
    const raw = kv.get<string>('room');
    const parsed = raw ? (JSON.parse(raw) as RoomRec) : null;
    if (parsed && dropOldBoard(parsed)) {
      // 옛 판 로그 조각을 지운다(새 판 로그가 log:000000 부터 다시 쌓인다)
      // 지연 커서를 순회하며 지우지 않도록 키를 먼저 모은다
      const keys = [...kv.list<string>({ prefix: 'log:' })].map(([k]) => k);
      for (const k of keys) kv.delete(k);
      kv.put('room', JSON.stringify(migrate(parsed)));
    }
    this.rec = parsed ? migrate(parsed) : null;
    this.game = null;
    if (this.rec?.game) {
      const log: LogEvent[] = [];
      for (const [, chunk] of kv.list<string>({ prefix: 'log:' })) log.push(...(JSON.parse(chunk) as LogEvent[]));
      this.game = { ...this.rec.game, log } as GameState;
    }
  }

  /** false = 로그 상한 초과로 거부(아무것도 쓰지 않음) */
  private save(): boolean {
    const kv = this.ctx.storage.kv;
    const r = this.rec!;
    if (this.game) {
      const fresh = this.game.log.slice(r.logLen);
      if (fresh.length) {
        const json = JSON.stringify(fresh);
        const bytes = new TextEncoder().encode(json).length;
        // 로그는 평가 증거라 자르거나 압축하지 않는다. 넘치면 이 입력 자체를 거부한다
        if (r.logBytes + bytes > LOG_CAP_BYTES) return false;
        kv.put(`log:${String(r.logChunks).padStart(6, '0')}`, json);
        r.logChunks++;
        r.logLen += fresh.length;
        r.logBytes += bytes;
      }
      const { log: _log, ...rest } = this.game;
      r.game = rest;
    }
    kv.put('room', JSON.stringify(r));
    return true;
  }

  init(code: string, settings: Settings): boolean {
    if (this.rec || !CODE_RE.test(code)) return false;
    const now = Date.now();
    this.rec = {
      v: REC_V, code, settings, createdAt: now, lastActiveAt: now, expiresAt: now + EXPIRE_MS, hostSeat: 0,
      seats: [0, 1, 2, 3].map(() => ({
        pin: rand4(), nick: [0, 0], charId: 0, claimed: false, connected: false, lastSeen: 0, offSince: null, returning: false,
        badPins: 0, lockedUntil: 0, tryAt: 0,
      })),
      game: null, lastTickAt: null, deadlineAt: null, stepKey: 'lobby', stepAt: now, botAt: null, botStuck: '', botAccuracy: [], botRng: 0,
      logLen: 0, logBytes: 0, logChunks: 0, missionOrder: null, cutscene: null, cutsceneScan: 0, lastCut: null, shown: [], shownKey: '', shownWait: false, notice: null,
    };
    this.save();
    this.schedule();
    return true;
  }

  // ── 입구 ────────────────────────────────────────────────

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/init') {
      const body = (await req.json().catch(() => null)) as { code?: unknown; settings?: unknown } | null;
      const settings = parseSettings(body?.settings);
      if (!settings || typeof body?.code !== 'string') return new Response(null, { status: 400 });
      return new Response(null, { status: this.init(body.code, settings) ? 201 : 409 });
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response(null, { status: 426 });
    if (!this.rec) return new Response(null, { status: 404 });
    const pair = new WebSocketPair();
    this.accept(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  accept(ws: WebSocket) {
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ seat: null } satisfies Att);
    this.run(ws, () => {}); // 구경 연결은 활동이 아니다(만료 갱신·저장 없음)
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.rec) return void ws.close(1008, 'gone');
    const msg = parseClient(raw);
    if (!msg) return this.send(ws, { t: 'error', code: 'bad' });
    this.run(ws, () => {
      if (msg.t !== 'sync') this.touch(); // sync 는 다시 받기일 뿐 활동이 아니다
      return this.onMessage(ws, msg);
    });
  }

  webSocketClose(ws: WebSocket) {
    try { ws.close(1000); } catch { /* 이미 닫힘 */ }
    this.disconnect(ws);
  }

  webSocketError(ws: WebSocket) {
    this.disconnect(ws);
  }

  async alarm() {
    if (!this.rec) return;
    if (Date.now() >= this.rec.expiresAt) {
      for (const ws of this.ctx.getWebSockets()) try { ws.close(1001, 'expired'); } catch { /* 무시 */ }
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      this.rec = null;
      this.game = null;
      return;
    }
    this.run(null, () => {});
  }

  // ── 한 번의 처리: 시계 → 할 일 → 입력 → 정리 → 저장 → 알람 → 방송 ──

  private run(from: WebSocket | null, body: () => ErrorCode | void) {
    const now = Date.now();
    this.dirty = false;
    this.resync = null;
    const logFrom = this.rec!.logLen;
    const before = this.meta();
    this.advance(now);
    const err = body();
    this.settle(now);
    // 바뀐 것이 없으면(sync, 구경 연결, 무시된 입력) 쓰지 않는다
    if ((this.dirty || this.meta() !== before) && !this.save()) {
      this.load(); // 저장 못 한 변경은 버린다
      this.schedule(); // 만료 알람은 살려 둔다
      if (from) this.send(from, { t: 'error', code: 'logFull' });
      return;
    }
    this.schedule();
    if (err && from) this.send(from, { t: 'error', code: err });
    if (this.dirty) this.broadcast(logFrom);
    if (this.resync) this.send(this.resync, this.stateMsg(0, this.seatOf(this.resync)));
    else if (from && !this.dirty) this.send(from, this.stateMsg(logFrom, this.seatOf(from))); // 무시된 입력: 그 기기에만 상태 재전송
  }

  /** game 을 뺀 rec 의 JSON — 저장할 변경이 있는지 비교용(작다) */
  private meta() {
    const { game: _g, ...m } = this.rec!;
    return JSON.stringify(m);
  }

  private touch() {
    const r = this.rec!;
    r.lastActiveAt = Date.now();
    r.expiresAt = r.lastActiveAt + EXPIRE_MS;
  }

  /** 봇용 시드 rng. 상태는 rec.botRng 에 있어 저장·복원된다 */
  private botRand = () => {
    const [v, next] = nextFloat(this.rec!.botRng);
    this.rec!.botRng = next;
    return v;
  };

  private act(a: Action): boolean {
    if (!this.game) return false;
    const next = apply(this.game, a, this.content);
    if (next === this.game) return false;
    this.game = next;
    this.dirty = true;
    return true;
  }

  /** 시간이 정한 일: 놀이 시계, 전원 끊김 → 멈춤, 끊긴 자리 → 봇, 봇 입력, 턴 마감 */
  private advance(now: number) {
    const r = this.rec!;
    if (this.game?.phase !== 'playing') return;
    if (r.lastTickAt !== null && now > r.lastTickAt) this.act({ type: 'tick', ms: now - r.lastTickAt });
    r.lastTickAt = now;
    this.settle(now);
    const off = this.allOffSince();
    if (off !== null && now - off >= AUTO_PAUSE_MS && this.game?.phase === 'playing' && !this.game.clock.pauseBy) {
      this.act({ type: 'pause', by: 'auto' });
      this.settle(now);
    }
    if (this.game?.phase !== 'playing') return;
    r.seats.forEach((s, i) => {
      if (s.offSince === null || now - s.offSince < OFFLINE_BOT_MS || !this.game) return;
      s.offSince = null;
      s.returning = false;
      this.game.seats[i].isBot = true;
      r.botAccuracy[i] = drawAccuracy(this.botRand, this.game.settings.totalMinutes); // 대체 봇도 그 판 길이 범위에서 새로(PRD §4.5 U2)
      this.dirty = true;
    });
    this.settle(now);
    if (r.botAt !== null && now >= r.botAt) {
      r.botAt = null;
      let moved = false;
      for (const seat of botSeats(this.game!)) {
        const a = botAction(this.game!, seat, this.content, this.botRand, r.botAccuracy[seat]);
        if (a && this.act(a)) {
          moved = true;
          if (a.type === 'travel' || a.type === 'pickTile' || (a.type === 'pickFestival' && a.tile !== null)) this.botPicked = true;
        }
      }
      if (!moved) r.botStuck = r.stepKey;
      this.settle(now);
    }
    if (r.deadlineAt !== null && now >= r.deadlineAt && this.game?.phase === 'playing') {
      if (this.game.turn.step === 'explanation' && !r.shownWait && this.awaitingShown()) {
        r.shownWait = true; // 한 번만
        r.deadlineAt = now + SHOWN_WAIT_MS;
        return;
      }
      this.act({ type: 'timeout', shown: this.acked() });
      this.settle(now);
      if (r.deadlineAt !== null && r.deadlineAt <= now) r.deadlineAt = now + stepMs(this.game!); // 거부된 timeout 이 알람을 되풀이하지 않게
    }
  }

  /** 상태가 바뀐 뒤: 돌아온 사람 넘겨주기, 단계가 바뀌면 마감 다시 걸기, 봇 예약 */
  private settle(now: number) {
    const r = this.rec!;
    const g = this.game;
    if (!g) return;
    r.seats.forEach((s, i) => {
      if (!s.returning || (g.phase === 'playing' && g.turn.seat === i)) return; // 다음 턴부터 사람
      s.returning = false;
      g.seats[i].isBot = false;
      this.dirty = true;
    });
    // 클라이언트는 컷씬이 끝날 때까지 문항을 띄우지 않으므로(알림 줄) 남은 컷씬 시간만큼 답할 시간을 돌려준다
    const lm = g.log.slice(r.cutsceneScan).reverse().find((e) => e.ev === 'build' && e.level === 4);
    if (lm?.ev === 'build') {
      r.cutscene = { at: now, seat: lm.seat, next: null }; // seat = 세운 사람(그다음 차례가 '다음 도착자')
      r.lastCut = { tile: lm.tile, seat: lm.seat, at: now };
    }
    // 화면 연출(주사위 · 줌 in · 홉 · 착지 머묾 · 복귀 · 알림 카드, shared/timing): 화면은 연출·알림이 끝난 뒤 카드·문항을 연다
    // → 그 단계 마감·봇 행동을 그만큼 늦춘다(PRD §4.3 U10). 봇이 칸을 골랐으면 그 칸 반짝임 1초도 앞에 붙는다
    const moveShow = movesShowMs(g.log.slice(r.cutsceneScan), { step: g.turn.step, tile: g.turn.tile })
      + (this.botPicked ? PICK_BOT_FLASH_MS : 0);
    this.botPicked = false;
    r.cutsceneScan = g.log.length;
    // 로그 길이를 넣는 까닭: 더블 뒤 같은 자리·같은 roll 단계도 새 마감이어야 한다
    const key = g.phase === 'playing' ? stepKey(g.turn.seat, g.turn.step, g.log.length) : g.phase;
    if (key !== r.stepKey) {
      const wasPlaying = r.stepKey.includes('|');
      r.stepKey = key;
      r.stepAt = now;
      r.shownWait = false;
      const cs = r.cutscene;
      let grace = moveShow;
      if (cs && g.phase === 'playing') {
        if (g.turn.step === 'question') { grace += Math.max(0, cs.at + CUTSCENE_MS - now); r.cutscene = null; } // 다음 문항 하나만
        else if (g.turn.seat !== cs.seat && cs.next === null) cs.next = g.turn.seat; // 다음 차례 시작
        else if (cs.next !== null && g.turn.seat !== cs.next) r.cutscene = null; // 그 차례도 끝남(문항 없이)
      }
      r.deadlineAt = g.phase === 'playing' ? now + stepMs(g) + grace : null;
      r.showUntil = g.phase === 'playing' ? now + moveShow : 0;
      const m = g.phase === 'playing' && g.turn.step === 'mission' ? this.content.missions.find((x) => x.id === g.turn.missionId) : undefined;
      if (m && SHUFFLED.has(m.type)) r.missionOrder = missionOrder(g.rngSeed, m, g.log.length);
      r.botAt = null;
      r.botStuck = '';
      if (g.phase !== 'playing') r.lastTickAt = null;
      if (g.phase === 'paused' && wasPlaying) this.sendPins();
    }
    // 표시 순서가 없는 미션 단계(T05b 전에 저장된 방을 복원): 지금 시드·로그 길이로 한 번 만들어 저장한다
    if (g.phase === 'playing' && (g.turn.step === 'mission' || g.turn.step === 'tf') && g.turn.missionId && r.missionOrder?.id !== g.turn.missionId) {
      const m = this.content.missions.find((x) => x.id === g.turn.missionId);
      if (m && SHUFFLED.has(m.type)) r.missionOrder = missionOrder(g.rngSeed, m, g.log.length);
    }
    if (g.phase === 'playing' && r.botAt === null && r.botStuck !== key && botSeats(g).length) r.botAt = Math.max(now, r.showUntil ?? 0) + botDelayMs(this.botRand, g.turn.step); // 봇도 연출·알림이 끝나 창이 열린 뒤 단계별 지연(PRD §4.5 U10 BOT_DELAY_MS)
  }

  private schedule() {
    const r = this.rec!;
    const g = this.game;
    const at = [r.expiresAt];
    if (g?.phase === 'playing') {
      if (r.deadlineAt !== null) at.push(r.deadlineAt);
      if (r.botAt !== null) at.push(r.botAt);
      if (r.lastTickAt !== null && g.clock.remainingMs > 0) at.push(r.lastTickAt + g.clock.remainingMs);
      const off = this.allOffSince();
      if (off !== null && !g.clock.pauseBy) at.push(off + AUTO_PAUSE_MS);
      for (const s of r.seats) if (s.offSince !== null) at.push(s.offSince + OFFLINE_BOT_MS);
    }
    void this.ctx.storage.setAlarm(Math.min(...at));
  }

  // ── 메시지 ──────────────────────────────────────────────

  private onMessage(ws: WebSocket, msg: ClientMsg): ErrorCode | void {
    const r = this.rec!;
    const att = ws.deserializeAttachment() as Att;
    const now = Date.now();
    switch (msg.t) {
      case 'sync': this.resync = ws; return;
      case 'pickPreview': {
        // 선택 옮김: 엔진이 단계·차례·고를 수 있는 칸을 본다(아니면 상태 그대로). 바뀌면 방송 = 관전자 중계
        if (att.seat === null || !this.game) return 'notSeated';
        this.act({ type: 'pickPreview', seat: att.seat, tile: msg.tile });
        return;
      }
      case 'shown': {
        if (att.seat === null) return 'notSeated';
        const g = this.game;
        // 지금 해설 단계의 stepKey 일 때만(늦게 온 것·다른 단계·지어낸 키는 버린다)
        if (g?.phase !== 'playing' || g.turn.step !== 'explanation' || msg.stepKey !== r.stepKey) return;
        if (now - r.stepAt < stepMs(g) - SHOWN_SLACK_MS) return; // 표시 시간을 못 채운 채 온 것(서버가 최소 시간을 지킨다)
        r.shown = [...new Set([...this.acked(), att.seat])];
        r.shownKey = r.stepKey;
        if (r.shownWait && !this.awaitingShown()) this.act({ type: 'timeout', shown: r.shown }); // 기다리던 마지막 기기
        return;
      }
      case 'hello': {
        if (att.seat !== null) return;
        if (this.game) return 'started';
        const i = r.seats.findIndex((s) => !s.claimed);
        if (i < 0) return 'full';
        Object.assign(r.seats[i], { charId: msg.charId, pin: rand4() });
        this.bind(ws, i as Seat, att);
        return;
      }
      case 'rejoin': {
        const s = r.seats[msg.seat];
        // 사람이 앉은 적 없는 자리(시작부터 봇·빈자리)는 PIN 값과 무관하게 거부한다(PRD §8-15 2026-10-29 QA8).
        // 끊김 대체 봇(claimed=true)은 그 사람 PIN 으로 복귀한다. 실패 횟수는 세지 않는다(봇 여부는 state 로 이미 공개)
        if (!s.claimed) return 'pin';
        // 잠긴 자리: 모든 소켓 합쳐 PIN_TRY_MS 에 한 번만 비교한다(무차별 대입 제한). 나머지는 비교 없이 'locked'.
        // 남이 잠가도 주인의 맞는 PIN 은 그 한 번에 통과한다(클라가 'locked' 면 잠시 뒤 다시 보낸다)
        if (now < s.lockedUntil) {
          if (now < s.tryAt) return 'locked';
          s.tryAt = now + PIN_TRY_MS;
        }
        if (s.pin !== msg.pin) {
          // 실패는 자리 단위로 센다: 소켓을 새로 열어도 이어지고, 잠긴 동안 틀린 것도 세어 잠금을 늘린다
          if (++s.badPins >= MAX_BAD_PINS) Object.assign(s, { badPins: 0, lockedUntil: now + PIN_LOCK_MS, tryAt: now + PIN_TRY_MS });
          return 'pin';
        }
        Object.assign(s, { badPins: 0, lockedUntil: 0, tryAt: 0 });
        // 다른 자리로 옮겨 앉으면 앞 자리는 끊김 처리(30초 뒤 봇)
        if (att.seat !== null && att.seat !== msg.seat) {
          const old = att.seat;
          att.seat = null;
          ws.serializeAttachment(att);
          if (!this.liveOn(old, ws)) this.markOff(old);
        }
        for (const other of this.ctx.getWebSockets()) {
          if (other !== ws && (other.deserializeAttachment() as Att | null)?.seat === msg.seat) {
            other.serializeAttachment({ seat: null } satisfies Att);
            try { other.close(4000, 'replaced'); } catch { /* 무시 */ }
          }
        }
        if (this.game) {
          this.act({ type: 'setConnected', seat: msg.seat, connected: true });
          if (this.game.seats[msg.seat].isBot) s.returning = true;
        }
        this.bind(ws, msg.seat, att);
        return;
      }
      case 'start': {
        if (att.seat !== r.hostSeat) return 'notHost';
        if (this.game) return 'started';
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        this.game = createGame({ seed, settings: r.settings, bots: r.seats.map((s) => !s.claimed) });
        r.notice = null;
        r.botRng = botSeed(seed);
        // 빈자리(사람 1~3명이면 나머지)는 봇. 정답률은 자리마다 놀이 시간 범위에서 한 번(PRD §4.5 U2)
        r.botAccuracy = r.seats.map(() => drawAccuracy(this.botRand, r.settings.totalMinutes));
        this.dirty = true;
        r.lastTickAt = now;
        r.seats.forEach((s, i) => {
          if (s.claimed && !s.connected) { this.act({ type: 'setConnected', seat: i as Seat, connected: false }); s.offSince = now; }
        });
        return;
      }
      case 'pause': {
        if (att.seat !== r.hostSeat) return 'notHost';
        // 멈춤: 지금 턴을 마친 뒤 정지·PIN(남은 시간은 그대로 — 같은 코드로 이어 하기)
        if (this.game?.phase === 'playing') this.act({ type: 'pause', by: 'host' });
        return;
      }
      case 'resume': {
        if (this.game?.phase !== 'paused') return;
        const back = r.seats.filter((s) => s.claimed && s.connected).length;
        if (att.seat !== r.hostSeat && (att.seat === null || back < 2)) return 'notHost';
        this.act({ type: 'resume' }); // 남은 시간 0 이면 엔진이 바로 끝낸다(U123 L1)
        if ((this.game as GameState | null)?.phase !== 'playing') return;
        r.lastTickAt = now;
        r.seats.forEach((s, i) => { if (s.claimed && !s.connected && !this.game!.seats[i].isBot) s.offSince = now; });
        return;
      }
      case 'act': {
        if (att.seat === null || !this.game) return 'notSeated';
        const a = this.toAction(att.seat, msg.a);
        if (a) this.act(a);
        return;
      }
    }
  }

  /** 자리에 앉힘. 처음 앉으면 겹치지 않는 별명을 뽑는다 */
  private bind(ws: WebSocket, seat: Seat, att: Att) {
    const r = this.rec!;
    const s = r.seats[seat];
    if (!s.claimed) {
      const others = r.seats.filter((x) => x.claimed);
      const taken = others.map((x) => x.nick.join());
      do s.nick = [randInt(NICK_ADJ_COUNT), randInt(NICK_ANIMAL_COUNT)]; while (taken.includes(s.nick.join()));
      // 캐릭터는 먼저 앉은 사람 것. 겹치면 비어 있는 첫 번호(0부터)를 준다 — 캐릭터 6 > 자리 4 라 늘 있다
      const used = others.map((x) => x.charId);
      if (used.includes(s.charId)) s.charId = [...Array(CHAR_COUNT).keys()].find((c) => !used.includes(c))!;
    }
    Object.assign(s, { claimed: true, connected: true, lastSeen: Date.now(), offSince: null });
    this.resync = ws;
    att.seat = seat;
    ws.serializeAttachment(att);
    this.dirty = true;
    this.send(ws, { t: 'welcome', seat, pin: this.rec!.seats[seat].pin });
  }

  /** 미션 답 번호 → 엔진이 채점할 내용. 범위 밖 번호는 null(무시) */
  private toAction(seat: Seat, a: ClientAct): Action | null {
    // 답 ms 는 서버가 단계 시작부터 잰 값이 상한(클라이언트가 더 짧게 부풀릴 수만 있고 길게는 못 함)
    const ms = Math.min(a.type === 'answer' || a.type === 'missionAnswer' ? a.ms : 0, Date.now() - this.rec!.stepAt);
    if (a.type === 'answer') return { ...a, seat, ms };
    if (a.type !== 'missionAnswer') return { ...a, seat } as Action;
    const m = this.content.missions.find((x) => x.id === this.game!.turn.missionId);
    if (!m) return null;
    // 연결·블록·순서: 번호는 표시 목록의 자리 → 저장해 둔 순열로 원래 번호를 찾는다. 채점은 엔진
    const mo = this.rec!.missionOrder?.id === m.id ? this.rec!.missionOrder : null;
    const answer: MissionAnswer = {};
    if (a.pairs) {
      const ps = m.pairs ?? [];
      if (!mo || a.pairs.some(([l, rr]) => mo.left[l] === undefined || mo.right[rr] === undefined)) return null;
      answer.pairs = a.pairs.map(([l, rr]) => ({ left: ps[mo.left[l]].left, right: ps[mo.right[rr]].right }));
    }
    if (a.steps) {
      const st = m.steps ?? [];
      if (!mo || a.steps.some((i) => mo.steps[i] === undefined)) return null;
      answer.steps = a.steps.map((i) => st[mo.steps[i]]);
    }
    if (a.selected) answer.selected = a.selected;
    return { type: 'missionAnswer', seat, answer, ms };
  }

  private disconnect(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Att | null;
    if (!this.rec || att?.seat == null) return;
    const seat = att.seat;
    // 같은 자리에 다른 연결이 살아 있으면(기기 바꿔 들어옴) 끊김이 아니다
    if (this.liveOn(seat, ws)) return;
    this.run(null, () => this.markOff(seat));
  }

  /** 지금 단계에서 shown 을 보낸 자리 */
  private acked(): Seat[] {
    const r = this.rec!;
    return r.shownKey === r.stepKey ? r.shown ?? [] : [];
  }

  /** 해설 단계: 연결된 사람 자리 중 아직 shown 을 안 보낸 자리가 있다 */
  private awaitingShown() {
    const g = this.game!;
    const got = this.acked();
    return this.rec!.seats.some((s, i) => s.connected && !g.seats[i].isBot && !got.includes(i as Seat));
  }

  private liveOn(seat: Seat, except: WebSocket) {
    return this.ctx.getWebSockets().some((o) => o !== except && (o.deserializeAttachment() as Att | null)?.seat === seat);
  }

  /** 사람이 앉은 자리가 전부 끊겼으면 마지막으로 끊긴 시각, 아니면 null */
  private allOffSince(): number | null {
    const claimed = this.rec!.seats.filter((s) => s.claimed);
    if (!claimed.length || claimed.some((s) => s.connected)) return null;
    return Math.max(...claimed.map((s) => s.lastSeen));
  }

  /** 자리 끊김: 게임 중이면 30초 타이머 */
  private markOff(seat: Seat) {
    const s = this.rec!.seats[seat];
    s.connected = false;
    s.returning = false;
    s.lastSeen = Date.now();
    this.dirty = true;
    if (!this.game) return;
    this.act({ type: 'setConnected', seat, connected: false });
    if (!this.game.seats[seat].isBot) s.offSince = Date.now();
  }

  // ── 보내기 ──────────────────────────────────────────────

  private send(ws: WebSocket, m: ServerMsg) {
    try { ws.send(JSON.stringify(m)); } catch { /* 닫히는 중 */ }
  }

  private seatOf(ws: WebSocket): Seat | null {
    return (ws.deserializeAttachment() as Att | null)?.seat ?? null;
  }

  /** 상태 메시지. viewer = 받는 자리(자리 없는 소켓 null). 실제 전송(send·broadcast)은 늘 viewer 를 넘긴다.
   *  생략(undefined)은 서버 안 전체 보기(시험·도구): 도착자 시점과 같다 */
  stateMsg(logFrom: number, viewer?: Seat | null, now = Date.now()): ServerMsg {
    const r = this.rec!;
    const lc = r.lastCut;
    const g = this.game;
    let game: PublicGame | null = null;
    if (g) {
      const { rngSeed: _a, rngState: _b, log: _c, turn, ...pub } = g;
      // 정답·카드 id 는 해설이 시작될 때까지 아무 기기에도 안 보낸다. 참/거짓은 문장 id 만
      const q = turn.question;
      const question = q && (turn.step === 'question' ? (({ answer: _x, cardId: _y, ...rest }) => rest)(q) : q);
      // 결과 단계(tfResult)엔 정답도(결과 2초 동안 정답 선지를 밝힌다). 답하는 동안엔 문장 id 만
      const tf = turn.tf && (turn.step === 'tfResult' ? { stmtId: turn.tf.stmtId, answer: turn.tf.answer } : { stmtId: turn.tf.stmtId });
      // 실패 해설(정답 키 + explain)은 참/거짓 단계에 실패한 도착자 자리에만(PRD §3.5). 관전자·구경 소켓·풀이 중엔 없음
      const reveal = viewer === undefined || viewer === turn.seat ? this.missionRevealOf(g) : null;
      game = { ...pub, turn: { ...turn, question, tf, mission: this.missionShown(g), reveal } };
    }
    return {
      t: 'state', code: r.code, phase: g ? g.phase : 'lobby', settings: r.settings, hostSeat: r.hostSeat,
      seats: r.seats.map((s, i) => ({
        taken: s.claimed, isBot: g ? g.seats[i].isBot : false, connected: s.connected, nick: s.nick, charId: s.charId,
      })),
      game, deadlineAt: r.deadlineAt, stepAt: r.stepAt, showUntil: g?.phase === 'playing' ? r.showUntil ?? null : null, now, cards: this.publicCards(),
      notice: r.notice,
      cutscene: g?.phase === 'playing' && lc && now < lc.at + CUT_RESUME_MS ? { tile: lc.tile, builder: lc.seat, t0: lc.at } : null,
      // 문항 mTags(오답 선지 태그 모음)는 참/거짓 형식이면 정답을 알려 준다(거짓 문장만 태그가 있음) → 방송에선 뺀다.
      // 결과 화면은 answer.chosenMTags 를 쓴다. 서버 저장 로그는 그대로
      // mission.mTags 도 같은 까닭(관전 참/거짓 문장 태그와 겹친다)으로 뺀다
      logFrom, log: g ? g.log.slice(logFrom).map((e) => (e.ev === 'question' || e.ev === 'mission' ? { ...e, mTags: [] } : e)) : [],
    };
  }

  /** 연결·블록·순서 미션: 섞인 표시 목록(미션·관전 참/거짓 단계 동안) */
  private missionShown(g: GameState): MissionShown | null {
    const mo = this.rec!.missionOrder;
    const t = g.turn;
    if (!mo || mo.id !== t.missionId || (t.step !== 'mission' && t.step !== 'tf' && t.step !== 'tfResult')) return null;
    const m = this.content.missions.find((x) => x.id === mo.id);
    if (!m) return null;
    const ps = m.pairs ?? [];
    const spots = !!m.image && MAP_OF_IMAGE[m.image] === 'spots' && ps.every((x) => SPOT_OF[x.left]);
    return {
      left: mo.left.map((i) => ps[i].left), right: mo.right.map((i) => ps[i].right), steps: mo.steps.map((i) => m.steps![i]),
      // 지도 칸 위치·구역 색은 서버만 안다(번들에 이름→위치·구역 표가 없게)
      ...(spots ? { at: mo.right.map((i) => SPOT_OF[ps[i].left]) } : {}),
      ...(m.image && MAP_OF_IMAGE[m.image] === 'zones' ? { zones: mo.right.map((i) => ZONE_OF_LABEL[ps[i].right] ?? '') } : {}),
    };
  }

  /** 실패 해설: 판정 뒤(참/거짓 단계) 실패했을 때만. 풀이 중(mission)·성공·다른 단계엔 null */
  private missionRevealOf(g: GameState): MissionReveal | null {
    const t = g.turn;
    // 참/거짓 창과 이어지는 결과 2초(tfResult) 동안
    if (g.phase !== 'playing' || (t.step !== 'tf' && t.step !== 'tfResult') || !t.missionId || t.missionSuccess) return null;
    const m = this.content.missions.find((x) => x.id === t.missionId);
    if (!m) return null;
    const mo = this.rec!.missionOrder;
    return missionReveal(m, mo && mo.id === m.id ? mo : null);
  }

  /** 카드 글은 번들에 없다. 해설·참/거짓 단계엔 그 카드만, 정지·끝엔 재개 화면(함께 본 카드)과 결과 마그넷용 카드 */
  private publicCards(): PublicCard[] {
    const g = this.game;
    if (!g) return [];
    const pub = (id: string): PublicCard[] => {
      const c = this.content.cards.find((x) => x.id === id);
      if (!c) return [];
      const { mTags: _m, topics: _t, ...rest } = c;
      return [rest];
    };
    if (g.phase === 'playing') {
      const q = g.turn.question;
      return q && (g.turn.step === 'explanation' || g.turn.step === 'tf' || g.turn.step === 'tfResult') ? pub(q.cardId) : [];
    }
    const landmarks = new Set<string>(g.log.flatMap((e) => (e.ev === 'build' && e.level === 4 ? [BOARD[e.tile].country ?? ''] : [])));
    const ids = new Set([...g.revealedCards, ...this.content.cards.filter((c) => c.level < 4 && landmarks.has(c.country)).map((c) => c.id)]);
    return [...ids].flatMap(pub);
  }

  private broadcast(logFrom: number) {
    const m = JSON.stringify(this.stateMsg(logFrom, null));
    // 실패 해설이 있으면 도착자 자리 소켓에만 그 판을 따로 보낸다
    const seat = this.game?.turn.seat;
    const own = seat !== undefined && this.missionRevealOf(this.game!) ? JSON.stringify(this.stateMsg(logFrom, seat)) : m;
    for (const ws of this.ctx.getWebSockets()) try { ws.send(this.seatOf(ws) === seat ? own : m); } catch { /* 닫히는 중 */ }
  }

  /** 멈춤: 자리마다 자기 PIN 하나만(방장도 같음, PRD §8-11 2026-10-29 QA8). 시작부터 봇인 자리 PIN 은 아무에게도 보내지 않는다.
   *  끊겨서 봇이 된 사람 자리 PIN 은 그 사람만 안다 */
  private sendPins() {
    const r = this.rec!;
    for (const ws of this.ctx.getWebSockets()) {
      const seat = (ws.deserializeAttachment() as Att | null)?.seat;
      if (seat == null) continue;
      this.send(ws, { t: 'pins', pins: [{ seat, pin: r.seats[seat].pin }] });
    }
  }
}
