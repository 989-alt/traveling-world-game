// T05b: 정답 비노출(방송) + 미션 표시 순서(섞기·되돌리기·저장) + 카드 글 전달. 컷씬 뒤 문항 마감은 timers.test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { edit, withDice } from '../../src/engine/__tests__/helpers';
import type { MissionShown, ServerMsg } from '../../src/shared/protocol';
import type { Mission } from '../../src/shared/content-types';
import type { GameState } from '../../src/shared/types';
import { missionOrder, permute, type Room } from '../room';
import { FIXTURE, advance, connect, game, join, newRoom, runUntil, say, setup, type FakeWS } from './fakes';
import { untilDeadline } from './fakes';

afterEach(() => { vi.useRealTimers(); });

type State = Extract<ServerMsg, { t: 'state' }>;
const states = (ws: FakeWS[]) => ws.flatMap((w) => w.of('state')).filter((m) => m.game) as State[];

function started(n = 4) {
  const { ctx, room } = setup();
  const ws = join(room, ctx, n);
  const watcher = connect(room, ctx); // 자리 없는 구경 소켓
  say(room, ws[0], { t: 'start' });
  return { ctx, room, ws, watcher };
}

/** 상태를 바꿔 끼우고 서버가 새 단계로 알아보게 한다 */
function inject(room: Room, ws: FakeWS, f: (d: GameState) => void) {
  room.game = edit(game(room), f);
  say(room, ws, { t: 'sync' });
}

const toMission = (room: Room, ws: FakeWS, id: string) =>
  inject(room, ws, (d) => { d.players[0].pos = 3; d.turn = { ...d.turn, seat: 0, step: 'mission', tile: 3, missionId: id }; });

const shownOf = (w: FakeWS) => w.last('state')!.game!.turn.mission;

describe('문항 단계: 정답·카드 id·카드 글·태그가 어떤 소켓에도 없다', () => {
  it('4석 + 구경 소켓 전 메시지: question 단계엔 cardId·answer·cards·question.mTags 없음, 해설부터 cardId·카드 글, 참/거짓 tf 이벤트는 닫힌 뒤', async () => {
    const { ctx, room, ws, watcher } = started();
    room.game = withDice(game(room), 1, 1); // 0 → 2 타이: 문항 → 해설 → 참/거짓
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    await advance(room, ctx, untilDeadline(room)); // 문화 카드 3초 + 이동 연출(shared/timing)
    expect(game(room).turn.step).toBe('question');
    say(room, ws[0], { t: 'act', a: { type: 'answer', choice: 1, ms: 1000 } });
    await advance(room, ctx, 6_000);
    for (const w of ws) say(room, w, { t: 'shown', stepKey: room.rec!.stepKey });
    await advance(room, ctx, 1_000);
    expect(game(room).turn.step).toBe('tf');
    say(room, ws[1], { t: 'act', a: { type: 'tfAnswer', value: true } });
    await advance(room, ctx, 6_000);

    const all = [...ws, watcher];
    const ss = states(all);
    const at = (st: string) => ss.filter((m) => m.game!.turn.step === st);
    expect(at('question').length).toBeGreaterThanOrEqual(all.length);
    for (const m of at('question')) {
      const q = m.game!.turn.question!;
      expect('cardId' in q).toBe(false);
      expect('answer' in q).toBe(false);
      expect(m.cards).toEqual([]);
    }
    const realCard = game(room).log.find((e) => e.ev === 'explanation')!;
    const card = FIXTURE.cards.find((c) => realCard.ev === 'explanation' && c.id === realCard.cardId)!;
    for (const st of ['explanation', 'tf']) {
      expect(at(st).length).toBeGreaterThan(0);
      for (const m of at(st)) {
        expect(m.game!.turn.question!.cardId).toBe(card.id);
        expect(m.cards).toEqual([{ id: card.id, country: card.country, level: card.level, answer: card.answer, reasons: card.reasons, image: card.image, ...(card.image2 ? { image2: card.image2 } : {}) }]);
      }
    }
    // 방송 로그: 문항 mTags 는 비움(참/거짓 형식이면 정답을 알려 주므로), tf 이벤트는 tf_answer 와 함께 닫힐 때
    for (const m of ss) for (const e of m.log) if (e.ev === 'question') expect(e.mTags).toEqual([]);
    for (const m of at('tf')) expect(m.log.some((e) => e.ev === 'tf' || e.ev === 'tf_answer')).toBe(false);
    expect(game(room).log.filter((e) => e.ev === 'question').length).toBe(1); // 서버 로그는 그대로(태그 유지)
    // 고른 선지 태그는 답한 뒤 로그로 간다(결과 화면용)
    expect(game(room).log.find((e) => e.ev === 'answer')).toHaveProperty('chosenMTags');
    // 그 밖의 단계엔 카드 글 없음
    for (const m of ss.filter((x) => !['explanation', 'tf'].includes(x.game!.turn.step))) expect(m.cards).toEqual([]);
  });

  it('정지 때 카드 글: 함께 본 카드 + 랜드마크 나라 1~3단계(결과 마그넷)', async () => {
    const { ctx, room, ws } = started(2);
    inject(room, ws[0], (d) => {
      d.revealedCards = ['th-1'];
      d.log.push({ ev: 'build', seat: 0, tile: 4, level: 4, cost: 1 }); // 네팔(4) 랜드마크
    });
    say(room, ws[0], { t: 'pause' });
    await runUntil(room, ctx, () => game(room).phase !== 'playing');
    expect(game(room).phase).toBe('paused');
    const m = ws[1].last('state')!;
    expect(m.cards.map((c) => c.id).sort()).toEqual(['np-1', 'np-2', 'np-3', 'th-1']);
    expect(JSON.stringify(m.cards)).not.toMatch(/mTags|topics/);
  });
});

describe('미션 표시 순서', () => {
  const connectM = FIXTURE.missions.find((m) => m.type === 'connect')!;
  const orderM = FIXTURE.missions.find((m) => m.type === 'order')!;

  it('순열: 시드 결정적, 항등 아님, 좌·우가 같은 순열이 아님(짝이 나란히 서지 않음)', () => {
    for (let seed = 1; seed < 300; seed++) {
      const p = permute(seed, 4);
      expect([...p].sort()).toEqual([0, 1, 2, 3]);
      expect(p).not.toEqual([0, 1, 2, 3]);
      expect(permute(seed, 4)).toEqual(p);
      const o = missionOrder(seed, connectM, 7);
      expect(o.left).not.toEqual(o.right);
      expect(missionOrder(seed, connectM, 7)).toEqual(o);
      expect(missionOrder(seed, orderM, 7).steps).not.toEqual([0, 1, 2]);
    }
    // 같은 미션도 출제 시점(salt)이 다르면 대개 다른 순서
    const differ = Array.from({ length: 50 }, (_, s) => JSON.stringify(missionOrder(9, connectM, s))).filter((x, i, a) => a.indexOf(x) === i);
    expect(differ.length).toBeGreaterThan(5);
  });

  it('모든 소켓이 같은 표시 목록, 원래 목록의 순열, 표시 번호로 답하면 서버가 되돌려 엔진이 채점(정답 성공·오답 실패)', () => {
    for (const correct of [true, false]) {
      const { room, ws, watcher } = started();
      toMission(room, ws[0], connectM.id);
      const sh = shownOf(ws[0])!; // 상태를 바꿔 끼운 기기(sync)에만 갔다. 나머지는 답한 뒤 방송으로 확인
      expect([...sh.left].sort()).toEqual(connectM.pairs!.map((p) => p.left).sort());
      expect([...sh.right].sort()).toEqual(connectM.pairs!.map((p) => p.right).sort());
      // 줄마다 짝이 나란히 서 있지 않다(전부 맞는 줄은 없음)
      expect(sh.left.every((l, i) => connectM.pairs!.find((p) => p.left === l)!.right === sh.right[i])).toBe(false);
      const rightOf = (l: string) => sh.right.indexOf(connectM.pairs!.find((p) => p.left === l)!.right);
      let pairs = sh.left.map((l, i) => [i, rightOf(l)] as [number, number]);
      if (!correct) pairs = pairs.map(([l, r]) => [l, (r + 1) % pairs.length]);
      say(room, ws[0], { t: 'act', a: { type: 'missionAnswer', pairs, ms: 5000 } });
      expect(game(room).log.find((e) => e.ev === 'mission')).toMatchObject({ missionId: connectM.id, success: correct });
      // 관전 참/거짓 단계: 4석 + 구경 소켓 모두 같은 목록(관전 화면 유지)
      expect(game(room).turn.step).toBe('tf');
      for (const w of [...ws, watcher]) expect(shownOf(w)).toEqual(sh);
    }
  });

  it('순서 미션: 표시 번호 → 원래 단계. 정답 순서는 처음 보여 준 순서와 다르다', () => {
    const { room, ws } = started();
    toMission(room, ws[0], orderM.id);
    const sh = shownOf(ws[0])!;
    expect(sh.steps).not.toEqual(orderM.steps);
    expect([...sh.steps].sort()).toEqual([...orderM.steps!].sort());
    const steps = orderM.steps!.map((x) => sh.steps.indexOf(x));
    say(room, ws[0], { t: 'act', a: { type: 'missionAnswer', steps, ms: 4000 } });
    expect(game(room).log.find((e) => e.ev === 'mission')).toMatchObject({ success: true });
  });

  it('범위 밖 표시 번호는 무시(엔진에 안 감), 사진 미션엔 표시 목록 없음', () => {
    const { room, ws } = started();
    toMission(room, ws[0], connectM.id);
    say(room, ws[0], { t: 'act', a: { type: 'missionAnswer', pairs: [[0, 9]], ms: 1 } });
    expect(game(room).turn.step).toBe('mission');
    const photo = FIXTURE.missions.find((m) => m.type === 'photo')!;
    const b = started();
    toMission(b.room, b.ws[0], photo.id);
    expect(shownOf(b.ws[0])).toBeNull();
    expect(b.room.rec!.missionOrder).toBeNull();
  });

  it('저장되므로 복원(DO 재시작)·재접속 뒤에도 같은 순서, 같은 답이면 같은 판정', () => {
    const { ctx, room, ws } = started(2);
    toMission(room, ws[0], connectM.id);
    const sh = shownOf(ws[0])!;
    expect(JSON.parse(ctx.data.get('room') as string).missionOrder).toEqual(room.rec!.missionOrder);
    // 재시작: 저장소만 남은 새 인스턴스
    const ctx2 = ctx.copy();
    const room2 = newRoom(ctx2);
    const s2 = room2.stateMsg(0) as State;
    expect(s2.game!.turn.mission).toEqual(sh);
    // 재접속(같은 방, 새 소켓 + PIN): 전체 다시 받기에도 같은 목록
    const w = connect(room, ctx);
    say(room, w, { t: 'rejoin', seat: 1, pin: room.rec!.seats[1].pin });
    expect(w.last('state')!.game!.turn.mission).toEqual(sh);
    // 복원한 방에서 표시 번호로 답해도 원래 방과 같은 판정
    const rightOf = (l: string) => sh.right.indexOf(connectM.pairs!.find((p) => p.left === l)!.right);
    const pairs = sh.left.map((l, i) => [i, rightOf(l)] as [number, number]);
    const sock = connect(room2, ctx2);
    say(room2, sock, { t: 'rejoin', seat: 0, pin: room2.rec!.seats[0].pin });
    say(room2, sock, { t: 'act', a: { type: 'missionAnswer', pairs, ms: 5000 } });
    expect(game(room2).log.find((e) => e.ev === 'mission')).toMatchObject({ success: true });
  });

  it('미션 이벤트 mTags 는 방송 로그에서 비운다(관전 참/거짓 정답 단서), 서버 로그는 그대로', () => {
    const { room, ws, watcher } = started();
    toMission(room, ws[0], connectM.id);
    say(room, ws[0], { t: 'act', a: { type: 'missionAnswer', pairs: [], ms: 1 } });
    expect(game(room).turn.step).toBe('tf');
    const sent = states([...ws, watcher]).flatMap((m) => m.log).filter((e) => e.ev === 'mission');
    expect(sent.length).toBeGreaterThanOrEqual(5);
    for (const e of sent) expect(e).toMatchObject({ mTags: [] });
    expect(game(room).log.find((e) => e.ev === 'mission')).toMatchObject({ mTags: connectM.mTags });
    // 전체 다시 받기(sync)도 같다
    say(room, ws[1], { t: 'sync' });
    for (const e of ws[1].last('state')!.log) if (e.ev === 'mission') expect(e.mTags).toEqual([]);
  });

  it('옛 저장본(missionOrder 없음)으로 미션 단계를 복원하면 서버가 순서를 새로 만들어 저장하고 답을 받는다', () => {
    const { ctx, room, ws } = started(2);
    toMission(room, ws[0], connectM.id);
    const raw = JSON.parse(ctx.data.get('room') as string);
    delete raw.missionOrder;
    delete raw.cutscene;
    delete raw.cutsceneScan;
    const ctx2 = ctx.copy();
    ctx2.data.set('room', JSON.stringify(raw));
    const room2 = newRoom(ctx2);
    const sock = connect(room2, ctx2);
    say(room2, sock, { t: 'rejoin', seat: 0, pin: room2.rec!.seats[0].pin });
    const sh = sock.last('state')!.game!.turn.mission!;
    expect(sh).not.toBeNull();
    expect(JSON.parse(ctx2.data.get('room') as string).missionOrder.id).toBe(connectM.id);
    const pairs = sh.left.map((l, i) => [i, sh.right.indexOf(connectM.pairs!.find((p) => p.left === l)!.right)] as [number, number]);
    say(room2, sock, { t: 'act', a: { type: 'missionAnswer', pairs, ms: 5000 } });
    expect(game(room2).log.find((e) => e.ev === 'mission')).toMatchObject({ success: true });
  });

  it('기후 구역 블록 미션: 칸 구역 색(zones)은 서버가 표시 순서대로 보낸다', () => {
    const zoneM: Mission = {
      id: 'm-zone', type: 'block', title: '', prompt: '', explain: '', image: 'mi_climate_zones.png', analytic: false,
      pairs: [{ left: '열대 기후', right: '적도 부근' }, { left: '건조 기후', right: '비가 적은 저·중위도' }, { left: '한대 기후', right: '극지방 부근' }],
      spectatorTf: { text: '', answer: true, mTags: [] }, topics: [], mTags: [],
    };
    const { room, ws } = started();
    room.content = { ...FIXTURE, missions: [...FIXTURE.missions, zoneM] };
    toMission(room, ws[0], zoneM.id);
    const sh = shownOf(ws[0]) as MissionShown;
    const zone: Record<string, string> = { '적도 부근': 'tropical', '비가 적은 저·중위도': 'dry', '극지방 부근': 'polar' };
    expect(sh.zones).toEqual(sh.right.map((r) => zone[r]));
    expect(sh.at).toBeUndefined();
  });

  it('지도 자리 블록 미션: 칸 위치(at)는 서버가 표시 순서대로 보낸다', () => {
    const spot: Mission = {
      id: 'm-spot', type: 'block', title: '', prompt: '', explain: '', image: 'mi_continents.png', analytic: false,
      pairs: [{ left: '아시아', right: '㉠ 자리' }, { left: '아프리카', right: '㉡ 자리' }, { left: '남극 대륙', right: '㉢ 자리' }],
      spectatorTf: { text: '', answer: true, mTags: [] }, topics: [], mTags: [],
    };
    const { room, ws } = started();
    room.content = { ...FIXTURE, missions: [...FIXTURE.missions, spot] };
    toMission(room, ws[0], spot.id);
    const sh = shownOf(ws[0]) as MissionShown;
    const at: Record<string, [number, number]> = { '㉠ 자리': [95, 45], '㉡ 자리': [20, 5], '㉢ 자리': [20, -80] };
    expect(sh.at).toEqual(sh.right.map((r) => at[r]));
    // 지도 없는 미션엔 at 없음
    const b = started();
    toMission(b.room, b.ws[0], connectM.id);
    expect(shownOf(b.ws[0])!.at).toBeUndefined();
  });
});

describe('미션 실패 해설(PRD §3.5, QA r3): 정답 키·explain 은 판정 뒤 실패한 도착자 자리에만', () => {
  const connectM = FIXTURE.missions.find((m) => m.type === 'connect')!;
  const orderM = FIXTURE.missions.find((m) => m.type === 'order')!;
  const photoM = FIXTURE.missions.find((m) => m.type === 'photo')!;
  const raw = (w: FakeWS) => w.sent.map((m) => JSON.stringify(m)).join('\n');
  const revealOf = (w: FakeWS) => w.last('state')!.game!.turn.reveal ?? null;
  /** 미션 단계 동안 받은 상태 메시지(전부) */
  const during = (w: FakeWS, step: string) => states([w]).filter((m) => m.game!.turn.step === step);

  it('연결 실패: 도착자만 tf 에서 정답 쌍(표시 번호) + explain, 관전 3명·구경 소켓은 없음. 풀이 중엔 누구에게도 없음', async () => {
    const { ctx, room, ws, watcher } = started();
    toMission(room, ws[0], connectM.id);
    for (const w of ws.slice(1)) say(room, w, { t: 'sync' }); // 풀이 중 전체 다시 받기에도 없음
    const sh = shownOf(ws[0])!;
    const wrong = sh.left.map((_, i) => [i, (sh.right.indexOf(connectM.pairs!.find((p) => p.left === sh.left[i])!.right) + 1) % sh.left.length] as [number, number]);
    say(room, ws[0], { t: 'act', a: { type: 'missionAnswer', pairs: wrong, ms: 3000 } });
    expect(game(room).turn.step).toBe('tf');
    expect(game(room).turn.missionSuccess).toBe(false);
    // 도착자: 표시 번호 기준 정답 쌍. 왼쪽 i 의 원래 짝 오른쪽이 서 있는 자리
    const rv = revealOf(ws[0])!;
    expect(rv.explain).toBe(connectM.explain);
    expect(rv.pairs).toEqual(sh.left.map((l, i) => [i, sh.right.indexOf(connectM.pairs!.find((p) => p.left === l)!.right)]));
    // 관전 3명 + 구경 소켓: tf 상태는 받지만 해설은 없음, explain 글자도 어디에도 없음
    for (const w of [...ws.slice(1), watcher]) {
      expect(during(w, 'tf').length).toBeGreaterThan(0);
      for (const m of during(w, 'tf')) expect(m.game!.turn.reveal ?? null).toBeNull();
      expect(raw(w)).not.toContain(connectM.explain);
    }
    // 풀이 중(mission) 메시지엔 어느 소켓에도 해설·explain 없음
    for (const w of [...ws, watcher]) {
      if (w !== watcher) expect(during(w, 'mission').length).toBeGreaterThan(0); // 구경 소켓은 sync 를 안 보냈다
      for (const m of during(w, 'mission')) {
        expect(m.game!.turn.reveal ?? null).toBeNull();
        expect(JSON.stringify(m)).not.toContain(connectM.explain);
      }
    }
    // 관전자가 tf 중에 다시 받아도 없음, 도착자가 다시 받으면 있음
    say(room, ws[2], { t: 'sync' });
    expect(revealOf(ws[2])).toBeNull();
    say(room, ws[0], { t: 'sync' });
    expect(revealOf(ws[0])).toEqual(rv);
    // 관전 3명이 다 답해도 실패 해설 창(tf 6초)은 마감까지 열려 있다(QA4-reveal). 닫히면(다음 턴) 도착자에게도 없음
    for (const w of ws.slice(1)) say(room, w, { t: 'act', a: { type: 'tfAnswer', value: true } });
    expect(game(room).turn.step).toBe('tf');
    expect(revealOf(ws[0])).toEqual(rv);
    await advance(room, ctx, untilDeadline(room));
    expect(game(room).turn.step).not.toBe('tf');
    expect(revealOf(ws[0])).toBeNull();
  });

  it('성공이면 아무 자리에도 해설 없음(보상 선택으로 이어짐)', () => {
    const { room, ws, watcher } = started();
    toMission(room, ws[0], connectM.id);
    const sh = shownOf(ws[0])!;
    const pairs = sh.left.map((l, i) => [i, sh.right.indexOf(connectM.pairs!.find((p) => p.left === l)!.right)] as [number, number]);
    say(room, ws[0], { t: 'act', a: { type: 'missionAnswer', pairs, ms: 3000 } });
    expect(game(room).turn.missionSuccess).toBe(true);
    for (const w of [...ws, watcher]) {
      for (const m of states([w])) expect(m.game!.turn.reveal ?? null).toBeNull();
      expect(raw(w)).not.toContain(connectM.explain);
    }
  });

  it('시간 초과 실패도 도착자에게 해설. 순서: 정답 순서대로 표시 번호, 사진: 정답 options 번호', async () => {
    const { ctx, room, ws, watcher } = started();
    toMission(room, ws[0], orderM.id);
    const sh = shownOf(ws[0])!;
    await advance(room, ctx, untilDeadline(room) + 10);
    expect(game(room).log.find((e) => e.ev === 'mission')).toMatchObject({ missionId: orderM.id, success: false });
    expect(game(room).turn.step).toBe('tf');
    const rv = revealOf(ws[0])!;
    expect(rv.steps!.map((d) => sh.steps[d])).toEqual(orderM.steps);
    expect(rv.explain).toBe(orderM.explain);
    for (const w of [...ws.slice(1), watcher]) { expect(revealOf(w)).toBeNull(); expect(raw(w)).not.toContain(orderM.explain); }

    const b = started();
    toMission(b.room, b.ws[0], photoM.id);
    const wrongPick = photoM.options!.findIndex((o) => !o.correct);
    say(b.room, b.ws[0], { t: 'act', a: { type: 'missionAnswer', selected: [wrongPick], ms: 2000 } });
    const pr = revealOf(b.ws[0])!;
    expect(pr.correct).toEqual(photoM.options!.flatMap((o, i) => (o.correct ? [i] : [])));
    for (const w of [...b.ws.slice(1), b.watcher]) { expect(revealOf(w)).toBeNull(); expect(raw(w)).not.toContain(photoM.explain); }
  });

  it('실제 전송(send·broadcast)은 늘 받는 자리를 넘긴다(생략 = 서버 안 전체 보기는 시험·도구 전용)', async () => {
    const path = '../room.ts?raw'; // 이름을 변수로(worker tsconfig 엔 ?raw 타입이 없다)
    const src = ((await import(/* @vite-ignore */ path)) as { default: string }).default;
    const calls = [...src.matchAll(/this\.stateMsg\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map((x) => x[1]);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) expect(c.split(',').length, c).toBe(2); // (logFrom, viewer)
  });
});
