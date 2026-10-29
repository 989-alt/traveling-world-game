import { afterEach, describe, expect, it, vi } from 'vitest';
import { withDice } from '../../src/engine/__tests__/helpers';
import { EXPIRE_MS, LOG_CAP_BYTES, REC_V, Room } from '../room';
import type { RoomRec } from '../room';
import { FakeCtx, advance, advanceTo, asWS, connect, game, join, runUntil, say, setup, newRoom } from './fakes';

afterEach(() => { vi.useRealTimers(); });

const stored = (ctx: FakeCtx) => JSON.parse(ctx.data.get('room') as string) as RoomRec;
const logKeys = (ctx: FakeCtx) => [...ctx.data.keys()].filter((k) => k.startsWith('log:')).sort();
const drop = (room: Room, ws: { close(): void }) => { room.webSocketClose(asWS(ws as never)); ws.close(); };

function started(n = 4) {
  const { ctx, room } = setup();
  const ws = join(room, ctx, n);
  say(room, ws[0], { t: 'start' });
  return { ctx, room, ws };
}

describe('놀이 시계·멈춤 (2026-10-28 U1)', () => {
  it('서버 시계가 0 이 되면 현재 턴을 마친 뒤 바로 최종 결과(중간 정지 없음)', async () => {
    const { ctx, room } = started(2); // 자리 2·3 은 봇
    await runUntil(room, ctx, () => game(room).clock.remainingMs === 0 || game(room).phase === 'finished');
    if (game(room).phase !== 'finished') expect(Date.now() - room.rec!.createdAt).toBe(40 * 60_000); // 서버 시계 = 실제 경과
    await runUntil(room, ctx, () => game(room).phase === 'finished');
    expect(game(room).log.some((e) => e.ev === 'clock' && e.kind === 'pause')).toBe(false);
    expect(stored(ctx).game!.phase).toBe('finished');
  });

  it("방장 '멈춤': 지금 턴 마친 뒤 paused + 저장 + 자리마다 자기 PIN, 남은 시간 그대로. 방장 아니면 notHost", async () => {
    const { ctx, room, ws } = started(4);
    await advance(room, ctx, 5_000);
    say(room, ws[1], { t: 'pause' });
    expect(ws[1].last('error')?.code).toBe('notHost');
    expect(game(room).phase).toBe('playing');
    say(room, ws[0], { t: 'pause' });
    expect(game(room).phase).toBe('paused'); // 주사위 대기 중이면 바로
    const left = game(room).clock.remainingMs;
    expect(left).toBe(40 * 60_000 - 5_000);
    expect(game(room).log.at(-1)).toEqual({ ev: 'clock', kind: 'pause', remainingMs: left, by: 'host' });
    expect(stored(ctx).game!.phase).toBe('paused');
    for (const [i, w] of ws.entries()) expect(w.last('pins')!.pins[0]).toEqual({ seat: i, pin: room.rec!.seats[i].pin });
    // 멈춘 동안에는 시계·마감·봇이 멈춘다
    const len = game(room).log.length;
    await advance(room, ctx, 10 * 60_000);
    expect(game(room).log.length).toBe(len);
    expect(game(room).clock.remainingMs).toBe(left);
    expect(ctx.alarmAt).toBe(room.rec!.expiresAt);
  });

  it('멈춤: 턴 중이면 그 턴을 마친 뒤 멈춘다', async () => {
    const { ctx, room, ws } = started(1); // 자리 1~3 봇
    room.game = withDice(game(room), 1, 2); // 더블 아님 → 나라 칸
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    expect(game(room).turn.step).not.toBe('roll');
    say(room, ws[0], { t: 'pause' });
    expect(game(room).phase).toBe('playing');
    expect(game(room).clock.pauseBy).toBe('host');
    await runUntil(room, ctx, () => game(room).phase === 'paused');
    expect(game(room).turn.step).toBe('roll'); // 턴 경계에서 멈춤
    expect(game(room).clock.remainingMs).toBeGreaterThan(0);
  });

  it('사람 자리 전원이 60초 끊기면 서버가 멈춘다(by auto), 한 명이라도 있으면 안 멈춘다', async () => {
    const { ctx, room, ws } = started(2);
    drop(room, ws[1]);
    await advance(room, ctx, 70_000);
    expect(game(room).phase).toBe('playing'); // 방장은 남아 있다
    drop(room, ws[0]);
    const t0 = Date.now();
    await runUntil(room, ctx, () => game(room).phase !== 'playing');
    expect(game(room).phase).toBe('paused');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(60_000);
    expect(game(room).log.filter((e) => e.ev === 'clock').at(-1)).toMatchObject({ kind: 'pause', by: 'auto' });
    expect(game(room).clock.remainingMs).toBeGreaterThan(0);
  });

  it('이어 하기: 같은 코드로 돌아와 방장, 또는 자리 2명 이상이면 재개 — 남은 시간 그대로', async () => {
    const { ctx, room, ws } = started(4);
    await advance(room, ctx, 3_000);
    say(room, ws[0], { t: 'pause' });
    const left = game(room).clock.remainingMs;
    const pins = room.rec!.seats.map((s) => s.pin);
    ws.forEach((w) => drop(room, w));
    await advance(room, ctx, 86_400_000); // 다음 날
    // 자리 1 혼자 → 거부, 자리 2 가 오면 → 재개
    const a = connect(room, ctx);
    say(room, a, { t: 'rejoin', seat: 1, pin: pins[1] });
    expect(a.last('state')!.phase).toBe('paused'); // 이어 하기 화면
    say(room, a, { t: 'resume' });
    expect(a.last('error')?.code).toBe('notHost');
    expect(game(room).phase).toBe('paused');
    const b = connect(room, ctx);
    say(room, b, { t: 'rejoin', seat: 2, pin: pins[2] });
    say(room, b, { t: 'resume' });
    expect(game(room).phase).toBe('playing');
    expect(game(room).clock).toEqual({ remainingMs: left, pauseBy: null });
    expect(game(room).log.at(-1)).toMatchObject({ ev: 'clock', kind: 'resume', remainingMs: left });
    // 안 돌아온 자리 0·3 은 30초 뒤 봇, 시계는 재개 뒤만 줄어든다
    await advance(room, ctx, 30_000);
    expect(game(room).seats.map((s) => s.isBot)).toEqual([true, false, false, true]);
    expect(game(room).clock.remainingMs).toBe(left - 30_000);

    const { ctx: c2, room: r2, ws: w2 } = started(2);
    say(r2, w2[0], { t: 'pause' });
    say(r2, w2[0], { t: 'resume' }); // 방장은 혼자서도
    expect(game(r2).phase).toBe('playing');
    void c2;
  });

  it('(U123 L1) 멈춘 방의 남은 시간이 0 이면 이어 하기 → 바로 최종 결과(멈춤에 갇히지 않음)', async () => {
    const { ctx, room, ws } = started(2);
    await advance(room, ctx, 3_000);
    say(room, ws[0], { t: 'pause' });
    expect(game(room).phase).toBe('paused');
    room.game = { ...game(room), clock: { remainingMs: 0, pauseBy: null } };
    say(room, ws[0], { t: 'resume' });
    expect(game(room).phase).toBe('finished');
    expect(game(room).winner?.kind).toBe('assets');
    expect(game(room).log.filter((e) => e.ev === 'clock').at(-1)).toMatchObject({ kind: 'end', by: 'timeout' });
    expect(stored(ctx).game!.phase).toBe('finished');
    expect(ws[0].last('state')!.phase).toBe('finished');
  });

  it('(U123 L2) 자동 멈춤 대기 중(턴 중)에 사람이 돌아오면 취소된다 — 턴이 끝나도 멈추지 않는다', async () => {
    const { ctx, room, ws } = started(1); // 자리 1~3 봇
    room.game = withDice(game(room), 1, 2); // 더블 아님 → 나라 칸(턴 중)
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    expect(game(room).turn.step).not.toBe('roll');
    const pin = room.rec!.seats[0].pin;
    drop(room, ws[0]);
    const left0 = game(room).clock.remainingMs;
    room.game = { ...game(room), clock: { ...game(room).clock, pauseBy: 'auto' } }; // 60초 뒤 자동 멈춤 요청이 대기 중인 상태
    await advance(room, ctx, 1_000);
    const back = connect(room, ctx);
    say(room, back, { t: 'rejoin', seat: 0, pin });
    expect(game(room).clock.remainingMs).toBe(left0 - 1_000); // 대기 중에도 시계는 줄었다(멈춤은 턴을 마친 뒤)
    expect(game(room).clock.pauseBy).toBeNull();
    await advance(room, ctx, 5 * 60_000);
    expect(game(room).phase).toBe('playing');
    expect(game(room).log.some((e) => e.ev === 'clock' && e.kind === 'pause')).toBe(false);
  });
});

describe('저장·복원', () => {
  it('DO 재시작 뒤 복원 → 같은 상태, 같은 입력엔 같은 결과', async () => {
    const { ctx, room, ws } = started(4);
    room.game = withDice(game(room), 1, 1); // 이 판 상태를 저장소에 싣기 위해 한 번 처리
    await advance(room, ctx, 60_000);
    const copy = newRoom(ctx.copy());
    expect(JSON.stringify(copy.game)).toBe(JSON.stringify(room.game));
    expect(JSON.stringify(copy.rec)).toBe(JSON.stringify(room.rec));
    expect(JSON.stringify(copy.stateMsg(0))).toBe(JSON.stringify(room.stateMsg(0)));
    // 같은 소켓(attachment)으로 같은 입력
    const seat = game(room).turn.seat;
    const step = game(room).turn.step;
    const a = step === 'roll' ? { type: 'roll' } : { type: 'pass' };
    say(room, ws[seat], { t: 'act', a });
    say(copy, ws[seat], { t: 'act', a });
    expect(JSON.stringify(copy.game)).toBe(JSON.stringify(room.game));
  });

  it('봇 정답률·봇 rng 도 저장된다: 복원한 방과 원래 방이 같은 시각에 봇끼리 같은 판을 둔다', async () => {
    const { ctx, room } = started(1); // 자리 1~3 봇
    await advance(room, ctx, 60_000);
    const copy = newRoom(ctx.copy());
    expect(copy.rec!.botAccuracy).toEqual(room.rec!.botAccuracy);
    expect(copy.rec!.botRng).toBe(room.rec!.botRng);
    const target = Date.now() + 5 * 60_000;
    const copyCtx = (copy as unknown as { ctx: FakeCtx }).ctx;
    await advanceTo(room, ctx, target);
    vi.setSystemTime(target - 5 * 60_000);
    await advanceTo(copy, copyCtx, target);
    expect(game(room).log.length).toBeGreaterThan(50);
    expect(JSON.stringify(copy.game)).toBe(JSON.stringify(room.game));
    expect(copy.rec!.botRng).toBe(room.rec!.botRng);
  });

  it('옛 꼴 대기실 저장본(게임 없음, 필드 없음)은 migrate 로 채우고 그대로 시작할 수 있다', () => {
    const { ctx } = setup();
    const old = stored(ctx) as unknown as Record<string, unknown>;
    for (const k of ['v', 'stepAt', 'botAccuracy', 'botRng', 'shown', 'shownKey', 'shownWait', 'missionOrder', 'cutscene', 'cutsceneScan', 'notice']) delete old[k];
    for (const st of old.seats as Record<string, unknown>[]) { delete st.badPins; delete st.lockedUntil; delete st.tryAt; }
    ctx.data.set('room', JSON.stringify(old));
    const copy = newRoom(ctx.copy());
    const r = copy.rec!;
    expect(r.v).toBe(REC_V);
    expect(r).toMatchObject({ stepAt: r.lastActiveAt, shown: [], shownKey: '', shownWait: false, missionOrder: null, cutscene: null, notice: null });
    for (const st of r.seats) expect(st).toMatchObject({ badPins: 0, lockedUntil: 0, tryAt: 0 });
    const copyCtx = (copy as unknown as { ctx: FakeCtx }).ctx;
    const ws = join(copy, copyCtx, 2);
    say(copy, ws[0], { t: 'start' });
    expect(game(copy).tiles).toHaveLength(30);
  });

  it('옛 시계(차시, REC_V 4) 저장본의 게임도 이어 하지 않는다: 대기실 + "새 판" 안내, 대기실 저장본 설정은 놀이 시간 40분으로', async () => {
    const { ctx, room } = started(2);
    await advance(room, ctx, 60_000);
    const old = stored(ctx) as unknown as Record<string, unknown> & { game: Record<string, unknown> };
    old.v = 4;
    old.settings = { lessons: 2, minutesPerLesson: 35, touristQuiz: false };
    delete old.game.clock;
    old.game.lesson = { index: 0, remainingMs: 1000 };
    ctx.data.set('room', JSON.stringify(old));
    const copy = newRoom(ctx.copy());
    expect(copy.game).toBeNull();
    expect(copy.rec).toMatchObject({ v: REC_V, game: null, notice: 'oldBoard', settings: { totalMinutes: 40, touristQuiz: false } });
    // 대기실(게임 없음) 옛 저장본: 설정을 40분으로 옮기고 짧게 안내(U123 L4)
    const { ctx: c2 } = setup();
    const lobby = stored(c2) as unknown as Record<string, unknown>;
    lobby.v = 4;
    lobby.settings = { lessons: 3, minutesPerLesson: 25, touristQuiz: false };
    c2.data.set('room', JSON.stringify(lobby));
    const r2 = newRoom(c2.copy());
    expect(r2.rec).toMatchObject({ v: REC_V, game: null, notice: 'newTime', settings: { totalMinutes: 40, touristQuiz: false } });
  });

  it('20분 판 저장본(2026-10-28 U3 이전, REC_V 5)은 이어 하지 않는다: 대기실 + "새 판" 안내, 옛 로그 삭제. 대기실 20 설정은 40 으로', async () => {
    const { ctx, room } = started(2);
    await advance(room, ctx, 60_000);
    expect(logKeys(ctx).length).toBeGreaterThan(0);
    const old = stored(ctx) as unknown as Record<string, unknown> & { game: { settings: Record<string, unknown> } };
    old.v = 5;
    old.settings = { totalMinutes: 20, touristQuiz: false };
    old.game.settings.totalMinutes = 20;
    ctx.data.set('room', JSON.stringify(old));
    const pins = room.rec!.seats.map((x) => x.pin);
    const copy = newRoom(ctx.copy());
    const copyCtx = (copy as unknown as { ctx: FakeCtx }).ctx;
    expect(copy.game).toBeNull();
    expect(copy.rec).toMatchObject({ v: REC_V, game: null, notice: 'oldTime', settings: { totalMinutes: 40, touristQuiz: false } }); // U123 L3: 놀이 시간 안내
    expect(copy.rec!.seats.map((x) => x.pin)).toEqual(pins);
    expect(logKeys(copyCtx)).toEqual([]);
    // 대기실(게임 없음) 20분 저장본: 설정을 40 으로 + 짧은 안내(U123 L4)
    const { ctx: c2 } = setup();
    const lobby = stored(c2) as unknown as Record<string, unknown>;
    lobby.v = 5;
    lobby.settings = { totalMinutes: 20, touristQuiz: false };
    c2.data.set('room', JSON.stringify(lobby));
    const r2 = newRoom(c2.copy());
    expect(r2.rec).toMatchObject({ v: REC_V, game: null, notice: 'newTime', settings: { totalMinutes: 40, touristQuiz: false } });
    const c2b = (r2 as unknown as { ctx: FakeCtx }).ctx;
    const lw = connect(r2, c2b);
    say(r2, lw, { t: 'hello', charId: 0 });
    expect(lw.last('state')!).toMatchObject({ phase: 'lobby', notice: 'newTime' });
    say(r2, lw, { t: 'start' });
    expect(r2.rec!.notice).toBeNull();
    // 지금 꼴(REC_V) 40분 대기실 저장본은 안내 없음
    const { ctx: c4 } = setup();
    expect(newRoom(c4.copy()).rec!.notice).toBeNull();
    // 지금 꼴(REC_V) 40분 판 저장본은 그대로 이어 한다
    const { ctx: c3, room: r3 } = started(2);
    await advance(r3, c3, 60_000);
    expect(newRoom(c3.copy()).game).not.toBeNull();
  });

  it('REC_V 6 판 저장본(players.laps 없음, 2026-10-29 QA6 이전)은 그대로 이어 하고 laps = 0 으로 복원', async () => {
    const { ctx, room } = started(2);
    await advance(room, ctx, 60_000);
    const old = stored(ctx) as unknown as Record<string, unknown> & { game: { players: Record<string, unknown>[] } };
    old.v = 6;
    for (const p of old.game.players) delete p.laps;
    ctx.data.set('room', JSON.stringify(old));
    const copy = newRoom(ctx.copy());
    expect(copy.rec!.v).toBe(REC_V);
    expect(copy.game).not.toBeNull();
    expect(copy.game!.players.map((p) => p.laps)).toEqual([0, 0, 0, 0]);
  });

  it('저장본 claimed 기본값: 사람이 앉은 적 있는 자리만 true, 시작부터 봇 자리는 false — 복원 뒤에도 봇 자리 PIN 거부(QA8)', async () => {
    const { ctx, room } = started(2);
    await advance(room, ctx, 60_000);
    expect(room.rec!.seats.map((s) => s.claimed)).toEqual([true, true, false, false]);
    const old = stored(ctx) as unknown as Record<string, unknown> & { seats: Record<string, unknown>[] };
    old.v = 6;
    for (const s of old.seats) delete s.claimed;
    ctx.data.set('room', JSON.stringify(old));
    const c2 = ctx.copy();
    const copy = newRoom(c2);
    expect(copy.rec!.seats.map((s) => s.claimed)).toEqual([true, true, false, false]);
    const kid = connect(copy, c2);
    say(copy, kid, { t: 'rejoin', seat: 3, pin: copy.rec!.seats[3].pin });
    expect(kid.last('error')?.code).toBe('pin');
    expect(copy.game!.seats[3].isBot).toBe(true);
  });

  it('옛 판(40칸, REC_V 3 이하) 저장본은 이어 하지 않는다: 크래시 없이 대기실 + "새 판" 안내, 자리·PIN 유지, 옛 로그 조각 삭제', async () => {
    const { ctx, room, ws } = started(2); // 자리 2·3 봇
    await advance(room, ctx, 60_000);
    expect(logKeys(ctx).length).toBeGreaterThan(0);
    const old = stored(ctx) as unknown as Record<string, unknown> & { game: Record<string, unknown> };
    old.v = 3;
    old.game.tiles = Array.from({ length: 40 }, () => ({ owner: null, level: 0, festivalTarget: false })); // 옛 40칸 판
    delete old.notice;
    ctx.data.set('room', JSON.stringify(old));
    const pins = room.rec!.seats.map((x) => x.pin);
    const copy = newRoom(ctx.copy());
    const copyCtx = (copy as unknown as { ctx: FakeCtx }).ctx;
    expect(copy.game).toBeNull();
    expect(copy.rec).toMatchObject({ v: REC_V, game: null, notice: 'oldBoard', logLen: 0, logChunks: 0, stepKey: 'lobby', deadlineAt: null });
    expect(copy.rec!.seats.map((x) => x.pin)).toEqual(pins);
    expect(logKeys(copyCtx)).toEqual([]);
    expect(stored(copyCtx)).toMatchObject({ v: REC_V, game: null, notice: 'oldBoard' }); // 바로 새 꼴로 저장
    // 같은 자리 PIN 으로 다시 앉으면 대기실 상태 + 안내
    const back = connect(copy, copyCtx);
    say(copy, back, { t: 'rejoin', seat: 0, pin: pins[0] });
    const st = back.last('state')!;
    expect(st).toMatchObject({ phase: 'lobby', game: null, notice: 'oldBoard', log: [] });
    // 새 판 시작 → 30칸, 안내 지움, 로그는 새로
    say(copy, back, { t: 'start' });
    expect(game(copy).tiles).toHaveLength(30);
    expect(copy.rec!.notice).toBeNull();
    expect(back.last('state')!.notice).toBeNull();
    await advance(copy, copyCtx, 30_000);
    expect(game(copy).log[0]).toEqual({ ev: 'clock', kind: 'start', remainingMs: 40 * 60_000, by: 'host' });
    const again = newRoom(copyCtx.copy()); // 새 판 저장본은 그대로 복원
    expect(JSON.stringify(again.game)).toBe(JSON.stringify(copy.game));
    void ws;
  });

  it('옛 판 저장본은 끝난 판도 버린다: 대기실 + "새 판" 안내, 옛 로그 조각 삭제(PRD §9.1)', async () => {
    const { ctx, room } = started(2);
    await advance(room, ctx, 60_000);
    expect(logKeys(ctx).length).toBeGreaterThan(0);
    const old = stored(ctx) as unknown as Record<string, unknown> & { game: Record<string, unknown> };
    old.v = 3;
    old.game.phase = 'finished';
    const tiles: unknown[] = Array.from({ length: 40 }, () => ({ owner: null, level: 0, festivalTarget: false }));
    tiles[31] = { owner: 0, level: 4, festivalTarget: false }; // 현재 30칸 판에 없는 칸
    old.game.tiles = tiles;
    delete old.notice;
    ctx.data.set('room', JSON.stringify(old));
    const pins = room.rec!.seats.map((x) => x.pin);
    const copy = newRoom(ctx.copy());
    const copyCtx = (copy as unknown as { ctx: FakeCtx }).ctx;
    expect(copy.game).toBeNull();
    expect(copy.rec).toMatchObject({ v: REC_V, game: null, notice: 'oldBoard', logLen: 0, logChunks: 0, stepKey: 'lobby' });
    expect(copy.rec!.seats.map((x) => x.pin)).toEqual(pins);
    expect(logKeys(copyCtx)).toEqual([]);
    expect(stored(copyCtx)).toMatchObject({ v: REC_V, game: null, notice: 'oldBoard' });
    const back = connect(copy, copyCtx);
    say(copy, back, { t: 'rejoin', seat: 0, pin: pins[0] });
    expect(back.last('state')!).toMatchObject({ phase: 'lobby', game: null, notice: 'oldBoard', log: [] });
  });

  it('로그는 append-only 별도 키: 앞 조각은 다시 쓰지 않는다, room 키에는 로그가 없다', async () => {
    const { ctx, room } = started(1);
    await advance(room, ctx, 2 * 60_000);
    const before = new Map(logKeys(ctx).map((k) => [k, ctx.data.get(k)]));
    expect(before.size).toBeGreaterThan(1);
    await advance(room, ctx, 2 * 60_000);
    const after = logKeys(ctx);
    expect(after.length).toBeGreaterThan(before.size);
    for (const [k, v] of before) expect(ctx.data.get(k)).toBe(v);
    expect('log' in stored(ctx).game!).toBe(false);
    const joined = after.flatMap((k) => JSON.parse(ctx.data.get(k) as string));
    expect(joined).toEqual(game(room).log);
    expect(stored(ctx).logLen).toBe(game(room).log.length);
  });

  it('바뀐 것이 없으면 쓰지 않는다: sync·구경 연결', () => {
    const { ctx, room, ws } = started(4);
    let puts = 0;
    const put = ctx.storage.kv.put;
    ctx.storage.kv.put = (k, v) => { puts++; put(k, v); };
    say(room, ws[2], { t: 'sync' });
    connect(room, ctx);
    expect(puts).toBe(0);
    expect(ws[2].last('state')!.logFrom).toBe(0); // sync 응답은 그대로 온다
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    expect(puts).toBeGreaterThan(0);
  });

  it('로그 2MB 상한: 넘칠 입력은 거부(자르지 않음), 저장소·상태 그대로', () => {
    const { ctx, room, ws } = started(4);
    room.rec!.logBytes = LOG_CAP_BYTES - 10;
    const snap = new Map(ctx.data);
    const len = game(room).log.length;
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    expect(ws[0].last('error')?.code).toBe('logFull');
    expect(game(room).log.length).toBe(len);
    expect(ctx.data).toEqual(snap);
    expect(ctx.alarmAt).not.toBeNull(); // 거부돼도 만료 알람은 남는다
    expect(ctx.alarmAt).toBeLessThanOrEqual(room.rec!.expiresAt);
  });
});

describe('14일 만료', () => {
  it('lastActiveAt + 14일 알람 → 저장소 삭제, 활동마다 갱신', async () => {
    const { ctx, room, ws } = started(4);
    say(room, ws[0], { t: 'pause' }); // 정지: 남는 알람은 만료뿐
    const t1 = Date.now();
    expect(ctx.alarmAt).toBe(t1 + EXPIRE_MS);
    await advance(room, ctx, 5 * 86_400_000);
    say(room, ws[1], { t: 'sync' }); // 다시 받기는 활동이 아니다
    expect(ctx.alarmAt).toBe(t1 + EXPIRE_MS);
    say(room, ws[1], { t: 'act', a: { type: 'roll' } }); // 입력은 (무시돼도) 활동
    expect(ctx.alarmAt).toBe(Date.now() + EXPIRE_MS);
    await advanceTo(room, ctx, t1 + EXPIRE_MS + 1); // 처음 기한은 지났지만 갱신돼서 살아 있다
    expect(ctx.data.size).toBeGreaterThan(0);
    await advance(room, ctx, 10 * 86_400_000);
    expect(ctx.data.size).toBe(0);
    expect(ctx.alarmAt).toBeNull();
    expect(ws.every((w) => w.closed)).toBe(true);
    expect(newRoom(ctx).rec).toBeNull();
  });
});
