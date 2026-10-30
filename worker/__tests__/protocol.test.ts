import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACT_SPEC, MAX_MESSAGE_CHARS, MSG_SPEC, parseClient, parseSettings } from '../../src/shared/protocol';
import type { ClientAct, ClientMsg } from '../../src/shared/protocol';
import { edit, withDice } from '../../src/engine/__tests__/helpers';
import { TRAVEL_TILE } from '../../src/shared/board';
import { FIXTURE, FakeWS, advance, asWS, connect, join, runUntil, say, setup, game } from './fakes';
import { untilDeadline } from './fakes';

afterEach(() => { vi.useRealTimers(); });

// 모든 행동·메시지 종류의 올바른 예 (스키마 전수)
const ACTS: Record<ClientAct['type'], ClientAct> = {
  roll: { type: 'roll', gauge: 0.7 },
  escape: { type: 'escape', method: 'coin' },
  travel: { type: 'travel', tile: 12 },
  ack: { type: 'ack' },
  answer: { type: 'answer', choice: 3, ms: 4100 },
  useHint: { type: 'useHint' },
  tfAnswer: { type: 'tfAnswer', value: false },
  payToll: { type: 'payToll', item: 'tollHalf' },
  buy: { type: 'buy' },
  build: { type: 'build' },
  takeover: { type: 'takeover' },
  pass: { type: 'pass' },
  shield: { type: 'shield', use: true },
  missionAnswer: { type: 'missionAnswer', pairs: [[0, 1], [1, 0]], steps: [2, 0, 1], selected: [1], ms: 30000 },
  chooseReward: { type: 'chooseReward', index: 2 },
  pickTile: { type: 'pickTile', tile: 1 },
  pickFestival: { type: 'pickFestival', tile: null },
};
const MSGS: ClientMsg[] = [
  { t: 'hello', charId: 5 },
  { t: 'rejoin', seat: 2, pin: '0429' },
  { t: 'start' }, { t: 'pause' }, { t: 'resume' }, { t: 'sync' }, { t: 'shown', stepKey: '1|explanation|42' },
  { t: 'pickPreview', tile: 14 },
  ...Object.values(ACTS).map((a) => ({ t: 'act', a }) as ClientMsg),
];
const ok = (m: unknown) => parseClient(JSON.stringify(m));

describe('클라이언트 → 서버 스키마', () => {
  it('예시가 모든 종류를 덮고, 전부 통과한다', () => {
    expect(Object.keys(ACTS).sort()).toEqual(Object.keys(ACT_SPEC).sort());
    expect(new Set(MSGS.map((m) => m.t))).toEqual(new Set(Object.keys(MSG_SPEC)));
    for (const m of MSGS) expect(ok(m), JSON.stringify(m)).toEqual(m);
    expect(ok({ t: 'act', a: { type: 'roll' } })).not.toBeNull(); // gauge 생략 가능
    expect(ok({ t: 'act', a: { type: 'answer', choice: true, ms: 0 } })).not.toBeNull(); // 참/거짓 형식
  });

  it('자유 문자열 필드 0: 어느 필드에 글을 넣어도 거부', () => {
    const texts = ['hello', '안녕 나는 철수', '', 'ABCDEF ', '04291', 'a'.repeat(30)];
    for (const m of MSGS) for (const k of Object.keys(m)) {
      if (m.t === 'act') for (const ak of Object.keys(m.a)) for (const x of texts) expect(ok({ ...m, a: { ...m.a, [ak]: x } }), `${m.a.type}.${ak}=${x}`).toBeNull();
      else if (k !== 't') for (const x of texts) expect(ok({ ...m, [k]: x }), `${m.t}.${k}=${x}`).toBeNull();
    }
    // 알 수 없는 키(닉네임·대화 같은 자유 필드를 끼워 넣기)
    for (const m of MSGS) {
      expect(ok({ ...m, name: '철수' })).toBeNull();
      if (m.t === 'act') expect(ok({ ...m, a: { ...m.a, note: 'x' } })).toBeNull();
    }
  });

  it('범위: 선지 0~3, 자리 0~3, PIN 4자리 숫자, 칸 0~29 (30칸)', () => {
    for (const choice of [-1, 4, 1.5, '1', null]) expect(ok({ t: 'act', a: { type: 'answer', choice, ms: 1 } })).toBeNull();
    for (const seat of [-1, 4, '1']) expect(ok({ t: 'rejoin', seat, pin: '1234' })).toBeNull();
    for (const pin of ['123', '12345', '12a4', 1234, ' 1234']) expect(ok({ t: 'rejoin', seat: 0, pin })).toBeNull();
    for (const tile of [-1, 30, 40, 2.5]) expect(ok({ t: 'act', a: { type: 'travel', tile } })).toBeNull();
    for (const tile of [0, 29]) expect(ok({ t: 'act', a: { type: 'travel', tile } })).not.toBeNull();
    expect(ok({ t: 'act', a: { type: 'missionAnswer', pairs: [[0]], ms: 1 } })).toBeNull();
    expect(ok({ t: 'act', a: { type: 'missionAnswer', pairs: [[0, 1, 2]], ms: 1 } })).toBeNull();
    expect(ok({ t: 'act', a: { type: 'roll', gauge: 2 } })).toBeNull();
    expect(ok({ t: 'act', a: { type: 'answer', choice: 1, ms: Infinity } })).toBeNull();
    for (const stepKey of ['1|question|4', '4|explanation|4', '1|explanation|', '1|explanation|12345678', 12, null]) expect(ok({ t: 'shown', stepKey })).toBeNull();
    expect(parseClient('x'.repeat(MAX_MESSAGE_CHARS + 1))).toBeNull();
    expect(parseClient('{not json')).toBeNull();
    expect(parseClient(new ArrayBuffer(4))).toBeNull();
    for (const totalMinutes of [40, 60, 80]) expect(parseSettings({ totalMinutes, touristQuiz: false })).not.toBeNull();
    for (const totalMinutes of [0, 20, 30, 35, 70, 100, '40', null]) expect(parseSettings({ totalMinutes, touristQuiz: false })).toBeNull();
    expect(parseSettings({ lessons: 2, minutesPerLesson: 30, touristQuiz: false })).toBeNull(); // 옛 차시 설정은 거부
    expect(parseSettings({ totalMinutes: 40, touristQuiz: false, title: '우리반' })).toBeNull();
  });

  it('퍼징 100건 전부 거부', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const junk = () => [
      () => 'x' + Math.floor(rnd() * 1e6).toString(36) + '가',
      () => rnd() * 1e9 - 5e8,
      () => ({ [`k${Math.floor(rnd() * 99)}`]: 'v' }),
      () => [rnd(), 'q'],
    ][Math.floor(rnd() * 4)]();
    const cases: string[] = [];
    for (let i = 0; i < 100; i++) {
      const base = structuredClone(MSGS[i % MSGS.length]) as Record<string, any>;
      const kind = i % 4;
      if (kind === 0) base[`extra${i}`] = junk(); // 모르는 키
      else if (kind === 1) {
        const target = base.t === 'act' ? base.a : base;
        const keys = Object.keys(target).filter((k) => k !== 't');
        target[keys[Math.floor(rnd() * keys.length)]] = junk(); // 필드에 엉뚱한 값
      } else if (kind === 2) base.t = 'x' + i; // 없는 종류
      if (kind === 3) cases.push(JSON.stringify(junk()) + (i % 2 ? '' : '}'));
      else cases.push(JSON.stringify(base));
    }
    expect(cases).toHaveLength(100);
    const accepted = cases.filter((c) => parseClient(c) !== null);
    expect(accepted).toEqual([]);
  });
});

describe('서버 → 클라이언트', () => {
  it('방송에 pin·rngState·rngSeed 0건, 남의 PIN 은 어느 기기에도 안 간다', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 2);
    const watcher = connect(room, ctx); // 자리 없는 구경 소켓
    say(room, ws[0], { t: 'start' });
    await advance(room, ctx, 5 * 60_000);
    say(room, ws[0], { t: 'pause' });
    await runUntil(room, ctx, () => game(room).phase !== 'playing');
    expect(ws[0].of('pins').length).toBeGreaterThan(0);

    const pins = room.rec!.seats.map((s) => s.pin);
    const all = [...ws, watcher];
    for (const w of all) {
      for (const m of w.of('state')) {
        const j = JSON.stringify(m);
        expect(j).not.toMatch(/"pin"|rngState|rngSeed/);
      }
    }
    // 자리마다 자기 PIN 만(방장도, PRD §8-11 QA8). 시작부터 봇인 자리 2·3 PIN 은 아무 데도 안 간다
    const seen = (w: FakeWS) => new Set(w.sent.flatMap((m) =>
      m.t === 'welcome' ? [m.seat] : m.t === 'pins' ? m.pins.map((p) => p.seat) : []));
    expect([...seen(ws[1])]).toEqual([1]);
    expect([...seen(ws[0])]).toEqual([0]);
    expect(seen(watcher).size).toBe(0);
    for (const m of ws[1].sent) for (const p of m.t === 'pins' ? m.pins : []) expect(p.pin).toBe(pins[1]);
  });

  it('정답 가리기: question 단계엔 정답 없음, 해설부터 있음. tf 단계엔 정답·남의 선택 없이 답한 자리만', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 4);
    const watcher = connect(room, ctx);
    say(room, ws[0], { t: 'start' });
    room.game = withDice(game(room), 1, 1); // 0 → 2 타이: 문항 → 해설 → 참/거짓
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    await advance(room, ctx, untilDeadline(room)); // 문화 카드 3초 + 이동 연출(shared/timing) // 문화 카드 3초
    expect(game(room).turn.step).toBe('question');
    say(room, ws[0], { t: 'act', a: { type: 'answer', choice: 0, ms: 1000 } });
    expect(game(room).turn.step).toBe('explanation');
    await advance(room, ctx, 6_000);
    for (const w of ws) say(room, w, { t: 'shown', stepKey: room.rec!.stepKey }); // 4기기 모두 카드를 다 봄
    await advance(room, ctx, 1_000);
    expect(game(room).turn.step).toBe('tf');
    say(room, ws[1], { t: 'act', a: { type: 'tfAnswer', value: true } });
    say(room, ws[2], { t: 'act', a: { type: 'tfAnswer', value: false } });
    await advance(room, ctx, 6_000);

    const states = [...ws, watcher].flatMap((w) => w.of('state')).filter((m) => m.game);
    const byStep = (st: string) => states.filter((m) => m.game!.turn.step === st);
    expect(byStep('question').length).toBeGreaterThan(0);
    for (const m of byStep('question')) {
      expect(m.game!.turn.question).not.toBeNull();
      expect('answer' in m.game!.turn.question!).toBe(false);
      expect('cardId' in m.game!.turn.question!).toBe(false); // 카드 id 도 해설부터(T05b)
    }
    expect(byStep('explanation').length).toBeGreaterThan(0);
    const realAnswer = FIXTURE.questions.find((q) => q.id === byStep('explanation')[0].game!.turn.question!.qid)!.answer;
    for (const m of byStep('explanation')) expect(m.game!.turn.question!.answer).toBe(realAnswer); // 해설부터 공개
    for (const m of byStep('explanation')) expect(m.game!.turn.question!.cardId).toBe(FIXTURE.questions.find((q) => q.id === m.game!.turn.question!.qid)!.cardId);
    const tfStates = byStep('tf');
    expect(tfStates.length).toBeGreaterThan(0);
    for (const m of tfStates) {
      expect(Object.keys(m.game!.turn.tf!)).toEqual(['stmtId']);
      expect(JSON.stringify(m.game!.turn)).not.toMatch(/"value"|"answers"/);
      expect(m.log.some((e) => e.ev === 'tf_answer')).toBe(false); // 닫히기 전엔 선택이 로그로도 안 샌다
    }
  });

  it('QA5-skew: 모든 state 메시지(증분·전체)에 보낸 순간의 서버 시각 now, 단계 시작 stepAt 과 따로', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 2);
    say(room, ws[0], { t: 'start' });
    room.game = withDice(game(room), 1, 1);
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    await advance(room, ctx, untilDeadline(room));
    expect(game(room).turn.step).toBe('question');
    await advance(room, ctx, 7_000); // 문항 중 7초 지남
    const late = connect(room, ctx); // 새로고침·재접속: 전체 다시 받기
    say(room, late, { t: 'sync' });
    const full = late.of('state').find((m) => m.logFrom === 0)!;
    expect(full.logFrom).toBe(0);
    expect(full.now).toBe(Date.now());
    expect(full.now - full.stepAt).toBeGreaterThanOrEqual(7_000); // stepAt 은 '지금'이 아니다
    expect(full.deadlineAt! - full.now).toBe(untilDeadline(room));
    const all = [...ws, late].flatMap((w) => w.of('state'));
    expect(all.some((m) => m.logFrom > 0)).toBe(true);
    for (const m of all) {
      expect(typeof m.now).toBe('number');
      expect(m.now).toBeGreaterThanOrEqual(m.stepAt);
    }
  });

  it('정지 때 방장도 자기 자리 PIN 하나만 받는다(시작부터 봇·끊겨서 봇이 된 자리 PIN 은 안 보낸다, PRD §8-11 QA8)', async () => {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 2); // 자리 2·3 은 처음부터 봇
    say(room, ws[0], { t: 'start' });
    room.webSocketClose(asWS(ws[1]));
    ws[1].close();
    await advance(room, ctx, 30_000);
    expect(game(room).seats[1].isBot).toBe(true);
    say(room, ws[0], { t: 'pause' });
    await runUntil(room, ctx, () => game(room).phase !== 'playing');
    expect(ws[0].last('pins')!.pins).toEqual([{ seat: 0, pin: room.rec!.seats[0].pin }]);
    const sentPins = ctx.sockets.flatMap((w) => w.of('pins')).flatMap((m) => m.pins.map((p) => p.seat));
    expect(sentPins).not.toContain(2);
    expect(sentPins).not.toContain(3);
  });

  it('저장 객체에 자유 문자열 0: 저장된 모든 문자열은 코드·PIN·id·열거형 꼴', async () => {
    const { ctx, room } = setup();
    const [host] = join(room, ctx, 1);
    say(room, host, { t: 'start' });
    await advance(room, ctx, 10 * 60_000);
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    for (const [, raw] of ctx.data) walk(JSON.parse(raw as string));
    expect(strings.length).toBeGreaterThan(100);
    const bad = [...new Set(strings)].filter((s) => !/^[A-Za-z0-9_.|-]{0,40}$/.test(s));
    expect(bad).toEqual([]);
  });

  it('학생 메시지는 문자열이 아니면 버린다(바이너리)', () => {
    const { ctx, room } = setup();
    const ws = connect(room, ctx);
    room.webSocketMessage(asWS(ws), new ArrayBuffer(8));
    expect(ws.last('error')?.code).toBe('bad');
  });
});

describe('U10 고르기 미리보기 pickPreview (PRD §3.6.1)', () => {
  /** 사람 4명, 자리 0 이 세계여행 고르기 단계 */
  function atTravel() {
    const { ctx, room } = setup();
    const ws = join(room, ctx, 4);
    say(room, ws[0], { t: 'start' });
    room.game = edit(game(room), (d) => { d.turn.step = 'travel'; d.players[0].pos = TRAVEL_TILE; d.players[0].travelPending = true; });
    say(room, ws[0], { t: 'sync' });
    return { ctx, room, ws };
  }
  const previewOf = (w: FakeWS) => w.last('state')!.game!.turn.preview ?? null;

  it('스키마: 칸 0~29 또는 null 만, 그 밖은 bad', () => {
    for (const tile of [0, 29, null]) expect(ok({ t: 'pickPreview', tile })).not.toBeNull();
    for (const tile of [-1, 30, 2.5, '5', undefined]) expect(ok({ t: 'pickPreview', tile })).toBeNull();
    expect(ok({ t: 'pickPreview', tile: 3, seat: 1 })).toBeNull();
  });

  it('선택 옮김은 관전자 화면에 중계되고, 마감에 그 칸으로 확정된다', async () => {
    const { ctx, room, ws } = atTravel();
    const n = ws[2].of('state').length;
    say(room, ws[0], { t: 'pickPreview', tile: 5 });
    expect(ws[2].of('state').length).toBe(n + 1); // 같은 처리에서 바로 방송(500ms 안)
    expect(previewOf(ws[2])).toBe(5);
    say(room, ws[0], { t: 'pickPreview', tile: 14 });
    expect(ws.map(previewOf)).toEqual([14, 14, 14, 14]);
    expect(game(room).log.some((e) => e.ev === 'move')).toBe(false); // 확정 아님
    await advance(room, ctx, untilDeadline(room));
    expect(game(room).log.filter((e) => e.ev === 'move').at(-1)).toMatchObject({ seat: 0, from: TRAVEL_TILE, to: 14, via: 'travel' });
  });

  it('고를 수 없는 칸(세계여행 칸 25)·남의 차례·고르기 아닌 단계는 거부: 상태 변화 0, 방송 0', () => {
    const { ctx, room, ws } = atTravel();
    const before = JSON.stringify(game(room));
    const others = ws[2].of('state').length;
    say(room, ws[0], { t: 'pickPreview', tile: TRAVEL_TILE });
    say(room, ws[1], { t: 'pickPreview', tile: 5 }); // 고르는 사람이 아님
    expect(JSON.stringify(game(room))).toBe(before);
    expect(ws[2].of('state').length).toBe(others);
    // 내 땅으로: 내 땅이 아닌 칸(옅은 칸)
    room.game = edit(game(room), (d) => { d.turn.step = 'pickTile'; d.tiles[2].owner = 0; });
    const b2 = JSON.stringify(game(room));
    say(room, ws[0], { t: 'pickPreview', tile: 3 });
    expect(JSON.stringify(game(room))).toBe(b2);
    say(room, ws[0], { t: 'pickPreview', tile: 2 });
    expect(game(room).turn.preview).toBe(2);
    // 고르기 아닌 단계(주사위)
    room.game = edit(game(room), (d) => { d.turn.step = 'roll'; delete d.turn.preview; });
    const b3 = JSON.stringify(game(room));
    say(room, ws[0], { t: 'pickPreview', tile: 5 });
    expect(JSON.stringify(game(room))).toBe(b3);
    // 구경 소켓(자리 없음)
    const watcher = connect(room, ctx);
    say(room, watcher, { t: 'pickPreview', tile: 5 });
    expect(watcher.last('error')?.code).toBe('notSeated');
    expect(JSON.stringify(game(room))).toBe(b3);
  });
});
