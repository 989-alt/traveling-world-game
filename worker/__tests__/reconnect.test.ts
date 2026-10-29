import { afterEach, describe, expect, it, vi } from 'vitest';
import { withDice } from '../../src/engine/__tests__/helpers';
import { OFFLINE_BOT_MS, Room } from '../room';
import { advance, asWS, connect, count, game, join, runUntil, say, setup, newRoom } from './fakes';

afterEach(() => { vi.useRealTimers(); });

function started(n = 4) {
  const { ctx, room } = setup();
  const ws = join(room, ctx, n);
  say(room, ws[0], { t: 'start' });
  return { ctx, room, ws };
}
const drop = (room: Room, ws: { close(): void }) => { room.webSocketClose(asWS(ws as never)); ws.close(); };

describe('재접속', () => {
  it('{code, seat, pin} 으로 새 소켓에서 자동 복귀: welcome + 전체 로그', async () => {
    const { ctx, room, ws } = started();
    say(room, ws[0], { t: 'act', a: { type: 'roll' } });
    const pin = ws[1].last('welcome')!.pin;
    drop(room, ws[1]);
    expect(room.rec!.seats[1].connected).toBe(false);
    expect(game(room).seats[1].connected).toBe(false);

    const back = connect(room, ctx); // 같은 기기 localStorage 든 다른 기기 PIN 입력이든 같은 메시지
    say(room, back, { t: 'rejoin', seat: 1, pin });
    expect(back.last('welcome')).toEqual({ t: 'welcome', seat: 1, pin });
    const st = back.last('state')!;
    expect(st.logFrom).toBe(0);
    expect(st.log).toHaveLength(game(room).log.length);
    expect(game(room).seats[1].connected).toBe(true);
    expect(game(room).seats[1].isBot).toBe(false);
  });

  it('끊긴 자리는 30초 뒤 봇, 그 전에는 사람 자리 그대로', async () => {
    const { ctx, room, ws } = started();
    drop(room, ws[2]);
    await advance(room, ctx, OFFLINE_BOT_MS - 1);
    expect(game(room).seats[2].isBot).toBe(false);
    await advance(room, ctx, 1);
    expect(game(room).seats[2].isBot).toBe(true);
    // 봇이 된 자리는 자기 차례에 스스로 굴린다(사람 0·1·3 은 굴리지 않으면 15초 timeout)
    await runUntil(room, ctx, () => game(room).log.some((e) => e.ev === 'dice' && e.seat === 2));
  });

  it('봇이 대신하던 자리가 자기 턴 중에 돌아오면, 그 턴은 봇이 끝내고 다음 턴부터 사람', async () => {
    const { ctx, room, ws } = started();
    const pin = ws[0].last('welcome')!.pin;
    drop(room, ws[0]); // 자리 0 = 지금 차례
    room.rec!.deadlineAt = Date.now() + 3_600_000; // 30초 동안 주사위 timeout(15초)이 차례를 넘기지 않게
    await advance(room, ctx, OFFLINE_BOT_MS);
    expect(game(room).seats[0].isBot).toBe(true);
    room.game = withDice(game(room), 2, 3); // 더블 아님
    const back = connect(room, ctx);
    say(room, back, { t: 'rejoin', seat: 0, pin });
    expect(game(room).turn.seat).toBe(0);
    expect(game(room).seats[0].isBot).toBe(true); // 이 턴은 아직 봇
    await runUntil(room, ctx, () => game(room).turn.seat !== 0);
    expect(game(room).seats[0].isBot).toBe(false);
    expect(room.rec!.seats[0].returning).toBe(false);
  });

  it('다른 기기로 같은 자리에 들어오면 앞 연결을 닫고, 그 닫힘은 끊김으로 치지 않는다', () => {
    const { ctx, room, ws } = started();
    const pin = ws[3].last('welcome')!.pin;
    const other = connect(room, ctx);
    say(room, other, { t: 'rejoin', seat: 3, pin });
    expect(ws[3].closed).toBe(true);
    room.webSocketClose(asWS(ws[3]));
    expect(room.rec!.seats[3].connected).toBe(true);
    expect(room.rec!.seats[3].offSince).toBeNull();
  });
});

describe('WebSocket Hibernation', () => {
  it('자리 매핑은 소켓 attachment 에 있다: DO 가 메모리를 잃고 깨어나도 같은 소켓이 같은 자리', () => {
    const { ctx, room, ws } = started();
    expect((ws[0] as unknown as { deserializeAttachment(): { seat: number } }).deserializeAttachment().seat).toBe(0);
    const woke = newRoom(ctx); // 같은 저장소·같은 소켓, 새 인스턴스
    woke.game = withDice(woke.game!, 2, 3);
    say(woke, ws[0], { t: 'act', a: { type: 'roll' } });
    expect(count(woke, 'dice')).toBe(1);
    expect(woke.game!.log.find((e) => e.ev === 'dice')).toMatchObject({ seat: 0 });
    say(woke, ws[1], { t: 'act', a: { type: 'roll' } }); // 자리 1 은 여전히 자리 1 → 남의 턴이라 무시
    expect(count(woke, 'dice')).toBe(1);
  });
});
