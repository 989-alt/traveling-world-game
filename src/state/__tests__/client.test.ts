import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SocketLike } from '../../net/socket';
import { PIN_TRY_MS } from '../../shared/protocol';
import { GameClient } from '../client';
import { loadSeat, saveSeat } from '../seat-store';

class FakeSock implements SocketLike {
  readyState = 1;
  sent: unknown[] = [];
  onopen: SocketLike['onopen'] = null;
  onclose: SocketLike['onclose'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;
  send(d: string) { this.sent.push(JSON.parse(d)); }
  close() { this.readyState = 3; }
  msg(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
}

function rig() {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
  saveSeat({ roomCode: 'ABCDEF', seatNo: 2, seatPin: '0420' });
  const socks: FakeSock[] = [];
  const c = new GameClient(() => { const s = new FakeSock(); socks.push(s); return s; }, () => 'ws://x');
  expect(c.resumeSaved()).toBe(true);
  socks[0].onopen?.({});
  expect(socks[0].sent[0]).toEqual({ t: 'rejoin', seat: 2, pin: '0420' });
  return { c, sock: socks[0] };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('GameClient 저장된 자리', () => {
  it("'locked'(PIN 확인 안 한 거부)엔 저장된 자리를 남기고 PIN_TRY_MS 뒤 같은 PIN 을 다시 보낸다", () => {
    vi.useFakeTimers();
    const { c, sock } = rig();
    sock.msg({ t: 'error', code: 'locked' });
    expect(c.state.error).toBe('locked');
    expect(loadSeat()).toEqual({ roomCode: 'ABCDEF', seatNo: 2, seatPin: '0420' });
    vi.advanceTimersByTime(PIN_TRY_MS - 1);
    expect(sock.sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sock.sent).toEqual([{ t: 'rejoin', seat: 2, pin: '0420' }, { t: 'rejoin', seat: 2, pin: '0420' }]);
    sock.msg({ t: 'error', code: 'locked' }); // 또 잠김 → 또 한 번
    vi.advanceTimersByTime(PIN_TRY_MS);
    expect(sock.sent).toHaveLength(3);
    sock.msg({ t: 'error', code: 'locked' });
    c.close(); // 닫으면 다시 보내지 않는다
    vi.advanceTimersByTime(PIN_TRY_MS);
    expect(sock.sent).toHaveLength(3);
  });
  it("'pin'(틀린 PIN)엔 저장된 자리를 지운다", () => {
    const { c, sock } = rig();
    sock.msg({ t: 'error', code: 'pin' });
    expect(c.state.error).toBe('pin');
    expect(loadSeat()).toBeNull();
  });
});

describe('GameClient 끝내기·나가기 (U14, PRD §9.4)', () => {
  const st = (phase: string) => ({ t: 'state', code: 'ABCDEF', phase, settings: { totalMinutes: 40, touristQuiz: false }, hostSeat: 0, seats: [], game: null, deadlineAt: null, stepAt: 0, now: 0, cards: [], notice: null, cutscene: null, logFrom: 0, log: [] });

  it('ended 를 받으면(방장 아닌 기기) 저장 자리 삭제 → 첫 화면 + 안내 띠, 다시 잇지 않는다', () => {
    vi.useFakeTimers();
    const { c, sock } = rig();
    sock.msg(st('playing'));
    expect(c.state.room).not.toBeNull();
    sock.msg({ t: 'ended', by: 'host' });
    expect(c.state.code).toBeNull();
    expect(c.state.room).toBeNull();
    expect(c.state.bye).toBe('ended');
    expect(loadSeat()).toBeNull();
    sock.onclose?.({ code: 4001 }); // 뒤이은 닫힘은 이미 버린 소켓
    vi.advanceTimersByTime(20_000);
    expect(c.state.code).toBeNull();
    c.dismissBye();
    expect(c.state.bye).toBeNull();
  });

  it('메시지 없이 4001 로 닫혀도 같은 길. 방장이 끝내기를 보낸 기기는 띠 없음', () => {
    const a = rig();
    a.sock.onclose?.({ code: 4001 });
    expect(a.c.state.code).toBeNull();
    expect(a.c.state.bye).toBe('ended');
    expect(loadSeat()).toBeNull();
    const b = rig();
    expect(b.c.endGame()).toBe(true);
    expect(b.sock.sent.at(-1)).toEqual({ t: 'end' });
    b.sock.msg({ t: 'ended', by: 'host' });
    expect(b.c.state.code).toBeNull();
    expect(b.c.state.bye).toBeNull();
  });

  it('나가기: leave 를 보내고 바로 첫 화면·저장 자리 삭제. 그 소켓의 늦은 상태·4002 닫힘은 무시', () => {
    vi.useFakeTimers();
    const { c, sock } = rig();
    sock.msg(st('playing'));
    c.leaveGame();
    expect(sock.sent.at(-1)).toEqual({ t: 'leave' });
    expect(c.state.code).toBeNull();
    expect(c.state.bye).toBeNull();
    expect(loadSeat()).toBeNull();
    sock.msg(st('playing')); // 서버가 닫기 전 방송
    expect(c.state.room).toBeNull();
    vi.advanceTimersByTime(3_000);
    expect(sock.readyState).toBe(3); // 3초 안에 서버가 안 닫으면 이쪽에서
    sock.onclose?.({ code: 4002 });
    expect(c.state.code).toBeNull();
  });

  it('멈춤 PIN 은 판이 다시 돌면 버린다(멈춤 모달 ↔ 이어 하기 화면 가름)', () => {
    const { c, sock } = rig();
    sock.msg(st('playing'));
    sock.msg({ t: 'pins', pins: [{ seat: 2, pin: '0420' }] });
    sock.msg(st('paused'));
    expect(c.state.pins).toEqual([{ seat: 2, pin: '0420' }]);
    sock.msg(st('playing'));
    expect(c.state.pins).toBeNull();
  });
});
