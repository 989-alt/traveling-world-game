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
