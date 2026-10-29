import { describe, expect, it } from 'vitest';
import { apply, createGame } from '../../engine/engine';
import { botAction, botSeats, seededRand } from '../../engine/bot';
import { full } from '../../engine/__tests__/helpers';
import { SALARY } from '../../shared/economy';
import type { LogEvent, Seat } from '../../shared/types';
import { coinChanges, digitReels, plan, POP_GAP_MS, popText, REEL_TURNS, reelStrip } from './coin-logic';

const face = (r: ReturnType<typeof digitReels>) => r.map((x) => (x.spin ? `[${x.strip[x.up ? 0 : x.strip.length - 1]}>${x.strip[x.up ? x.strip.length - 1 : 0]}]` : x.strip[0])).join('');
const owners = (o: Partial<Record<number, Seat>> = {}) => Array.from({ length: 30 }, (_, i) => o[i] ?? null);

describe('롤링 숫자: 바뀐 자리만 릴', () => {
  it('같은 자리수: 바뀐 자리만 돈다', () => {
    const r = digitReels(5600, 6080);
    expect(face(r)).toBe('[5>6],[6>0][0>8]0');
    expect(r.filter((x) => x.spin).map((x) => x.order)).toEqual([0, 1, 2]);
    expect(r.every((x) => x.up)).toBe(true);
  });
  it('통행료 −370: 두 자리만, 아래로', () => {
    const r = digitReels(5600, 5230);
    expect(face(r)).toBe('5,[6>2][0>3]0');
    expect(r.filter((x) => x.spin).every((x) => !x.up)).toBe(true);
  });
  it('자리수가 늘면(999 → 1,479) 새 쉼표는 나타나고 새 앞자리는 빈칸에서 돈다', () => {
    const r = digitReels(999, 1479);
    expect(r).toHaveLength(5);
    expect(r[0].spin && r[0].strip[0] === '' && r[0].strip.at(-1) === '1').toBe(true);
    expect(r[1]).toMatchObject({ spin: false, enter: true, strip: [','] });
    expect(r[4]).toMatchObject({ spin: false, strip: ['9'] });
    expect(r.filter((x) => x.spin)).toHaveLength(3);
  });
  it('자리수가 줄면(1,000 → 630) 앞자리·쉼표는 사라진다', () => {
    const r = digitReels(1000, 630);
    expect(r).toHaveLength(5);
    expect(r[0]).toMatchObject({ spin: true, exit: true });
    expect(r[0].strip[0]).toBe(''); // 아래로 굴러 빈칸에 선다(띠 맨 위가 목표)
    expect(r[1]).toMatchObject({ spin: false, exit: true, strip: [','] });
    expect(r.filter((x) => !x.exit).map((x) => x.strip[0])).toEqual(['6', '3', '0']); // 내려가는 띠는 맨 위가 목표 글자
  });
  it('띠는 REEL_TURNS 바퀴 + 남은 칸, 끝에 목표', () => {
    const s = reelStrip('3', '1', true);
    expect(s[0]).toBe('3');
    expect(s.at(-1)).toBe('1');
    expect(s).toHaveLength(REEL_TURNS * 10 + 8 + 1);
    // 이웃 칸은 1씩 오른다
    for (let i = 1; i < s.length; i++) expect((Number(s[i - 1]) + 1) % 10).toBe(Number(s[i]));
    const d = reelStrip('3', '1', false);
    expect(d[0]).toBe('1');
    expect(d.at(-1)).toBe('3');
    expect(d).toHaveLength(REEL_TURNS * 10 + 2 + 1);
  });
  it('같은 값이면 아무 릴도 안 돈다', () => {
    expect(digitReels(4820, 4820).some((x) => x.spin)).toBe(false);
  });
});

describe('증감·이유: 로그에서', () => {
  it('월급: 주사위로 출발을 지남', () => {
    const fresh: LogEvent[] = [{ ev: 'dice', seat: 0, d1: 3, d2: 4 }, { ev: 'move', seat: 0, from: 26, to: 3, via: 'dice' }];
    const c = coinChanges(fresh, owners(), [5000, 5000, 5000, 5000], [5480, 5000, 5000, 5000]);
    expect(c).toEqual([{ flow: { kind: 'gain', seat: 0 }, deltas: [{ seat: 0, amount: 480, reason: '월급' }] }]);
    expect(popText(c[0].deltas[0])).toBe('월급 +480');
  });
  it('통행료: 낸 쪽 −, 받은 쪽 +, 흐름은 자리 → 자리', () => {
    const fresh: LogEvent[] = [{ ev: 'toll', payer: 3, owner: 2, tile: 5, base: 370, multiplier: 1, discounted: false, paid: 370 }];
    const c = coinChanges(fresh, owners({ 5: 2 }), [5000, 5000, 3390, 5600], [5000, 5000, 3760, 5230]);
    expect(c).toHaveLength(1);
    expect(c[0].flow).toEqual({ kind: 'transfer', from: 3, to: 2 });
    expect(c[0].deltas.map(popText)).toEqual(['통행료 −370', '통행료 +370']);
  });
  it('한 묶음에 월급 + 땅 사기: 순서대로', () => {
    const fresh: LogEvent[] = [
      { ev: 'dice', seat: 1, d1: 6, d2: 5 }, { ev: 'move', seat: 1, from: 25, to: 6, via: 'dice' },
      { ev: 'buy', seat: 1, tile: 6, price: 740, discounted: false },
    ];
    const c = coinChanges(fresh, owners(), [0, 5000, 0, 0], [0, 4740, 0, 0]);
    expect(c.map((x) => popText(x.deltas[0]))).toEqual(['월급 +480', '땅 사기 −740']);
    expect(c[1].flow).toEqual({ kind: 'pay', seat: 1 });
  });
  it('인수: 묶음 전 주인에게', () => {
    const fresh: LogEvent[] = [{ ev: 'takeover', seat: 0, tile: 12, correct: true, shielded: false, cost: 1200 }];
    const c = coinChanges(fresh, owners({ 12: 2 }), [3000, 0, 1000, 0], [1800, 0, 2200, 0]);
    expect(c[0].flow).toEqual({ kind: 'transfer', from: 0, to: 2 });
    expect(c[0].deltas.map(popText)).toEqual(['인수 −1,200', '인수 +1,200']);
  });
  it('방패로 막은 인수·무료 통행은 변화 없음', () => {
    const fresh: LogEvent[] = [
      { ev: 'takeover', seat: 0, tile: 12, correct: true, shielded: true, cost: 0 },
      { ev: 'toll', payer: 0, owner: 2, tile: 12, base: 300, multiplier: 1, discounted: false, paid: 0 },
    ];
    expect(coinChanges(fresh, owners({ 12: 2 }), [1, 1, 1, 1], [1, 1, 1, 1])).toEqual([]);
  });
  it('보너스·기금·미션 보상·탈출비·건설·관전 정답', () => {
    const fresh: LogEvent[] = [
      { ev: 'event', seat: 0, kind: 'korea', payload: { correct: true, bonus: 300 } },
      { ev: 'event', seat: 1, kind: 'festival', payload: { fund: 900 } },
      { ev: 'event', seat: 2, kind: 'fund', payload: { received: 400 } },
      { ev: 'event', seat: 3, kind: 'island', payload: { escape: 'coin' } },
      { ev: 'build', seat: 0, tile: 3, level: 2, cost: 600 },
      { ev: 'tf_answer', seat: 1, stmtId: 'x', value: true, correct: true, isBot: false },
      { ev: 'tf_answer', seat: 2, stmtId: 'x', value: false, correct: false, isBot: false },
    ];
    const c = coinChanges(fresh, owners(), [1000, 1000, 1000, 1000], [700, 1950, 1400, 500]);
    expect(c.map((x) => popText(x.deltas[0]))).toEqual(['정답 보너스 +300', '기금 +900', '미션 보상 +400', '탈출비 −500', '건설 −600', '관전 정답 +50']);
  });
  it('세 번째 더블로 무인도: 월급 아님', () => {
    const fresh: LogEvent[] = [{ ev: 'dice', seat: 0, d1: 2, d2: 2 }, { ev: 'move', seat: 0, from: 28, to: 10, via: 'dice' }, { ev: 'event', seat: 0, kind: 'island', payload: {} }];
    expect(coinChanges(fresh, owners(), [1, 0, 0, 0], [1, 0, 0, 0])).toEqual([]);
  });
  it('미션 보상 무인도(via mission → 10)는 월급 아님, 출발로(→ 0)는 월급', () => {
    expect(coinChanges([{ ev: 'move', seat: 0, from: 20, to: 10, via: 'mission' }], owners(), [0, 0, 0, 0], [0, 0, 0, 0])).toEqual([]);
    expect(coinChanges([{ ev: 'move', seat: 0, from: 20, to: 0, via: 'mission' }], owners(), [0, 0, 0, 0], [SALARY, 0, 0, 0])[0].deltas[0].reason).toBe('월급');
  });
  it('강제 매각: 로그 합과 실제 차이를 맞춰 매각 줄을 앞에', () => {
    const fresh: LogEvent[] = [
      { ev: 'sold', seat: 3, tile: 16, levelBefore: 1 },
      { ev: 'toll', payer: 3, owner: 0, tile: 22, base: 2000, multiplier: 1, discounted: false, paid: 2000 },
    ];
    const c = coinChanges(fresh, owners({ 22: 0 }), [5000, 0, 0, 300], [7000, 0, 0, 100]);
    expect(c.map((x) => x.deltas.map(popText))).toEqual([['매각 +1,800'], ['통행료 −2,000', '통행료 +2,000']]);
  });
  it('로그 없는 차이도 숫자는 상태가 기준(코인 줄)', () => {
    const c = coinChanges([], owners(), [100, 0, 0, 0], [40, 0, 0, 0]);
    expect(c.map((x) => popText(x.deltas[0]))).toEqual(['코인 −60']);
  });
  it('엔진 실제 진행: 모든 묶음에서 로그 합 = 실제 코인 차이(잔여 "코인" 줄 없음)', () => {
    let residual = 0, checked = 0;
    const seen = new Set<string>();
    for (const seed of [3, 11, 29]) {
      let g = createGame({ seed, bots: [true, true, true, true] });
      const r = seededRand(seed);
      for (let i = 0; i < 4000 && g.phase !== 'finished'; i++) {
        if (g.phase === 'paused') { g = apply(g, { type: 'resume' }, full); continue; }
        const before = g.players.map((p) => p.coin), own = g.tiles.map((t) => t.owner), len = g.log.length;
        const seat = botSeats(g)[0];
        const a = seat === undefined ? null : botAction(g, seat, full, r, 0.65);
        let next = a ? apply(g, a, full) : g;
        if (next === g) next = apply(g, { type: 'timeout' }, full);
        if (next === g) throw new Error(`진행 불가 ${g.turn.step}`);
        g = next;
        const c = coinChanges(g.log.slice(len), own, before, g.players.map((p) => p.coin), g.players.map((p) => p.bankrupt));
        if (c.length) checked++;
        c.forEach((x) => x.deltas.forEach((d) => seen.add(d.reason)));
        residual += c.filter((x) => x.deltas.some((d) => d.reason === '코인')).length;
      }
    }
    expect([...seen]).toEqual(expect.arrayContaining(['월급', '통행료', '땅 사기', '건설']));
    expect(checked).toBeGreaterThan(0);
    expect(residual).toBe(0);
  });
});

describe('시간표', () => {
  it('변화마다 POP_GAP_MS 간격, 받는 쪽은 코인이 닿을 때', () => {
    const c = coinChanges([
      { ev: 'dice', seat: 3, d1: 3, d2: 4 }, { ev: 'move', seat: 3, from: 26, to: 3, via: 'dice' },
      { ev: 'toll', payer: 3, owner: 2, tile: 3, base: 370, multiplier: 1, discounted: false, paid: 370 },
    ], owners({ 3: 2 }), [0, 0, 1000, 1000], [0, 0, 1370, 1110]);
    const p = plan(c, 1000);
    expect(p.flows.map((f) => f.at)).toEqual([1000, 1000 + POP_GAP_MS]);
    const seat3 = p.pops.filter((x) => x.seat === 3);
    expect(seat3.map((x) => x.text)).toEqual(['월급 +480', '통행료 −370']);
    expect(p.pops.find((x) => x.seat === 2)!.at).toBeGreaterThan(1000 + POP_GAP_MS);
    expect(p.rollAt.get(2)).toBe(p.pops.find((x) => x.seat === 2)!.at);
    expect(p.end).toBeGreaterThan(p.rollAt.get(2)!);
  });
});
