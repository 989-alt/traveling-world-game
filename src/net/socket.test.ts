import { describe, expect, it } from 'vitest';
import { backoff, RoomSocket, type SocketLike } from './socket';

class FakeSock implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: SocketLike['onopen'] = null;
  onclose: SocketLike['onclose'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;
  send(d: string) { this.sent.push(d); }
  close(code?: number) { this.readyState = 3; this.onclose?.({ code }); }
  open() { this.readyState = 1; this.onopen?.({}); }
}

function rig(greet: () => unknown = () => null) {
  const socks: FakeSock[] = [];
  const timers: { f: () => void; ms: number }[] = [];
  const status: string[] = [];
  const msgs: unknown[] = [];
  const rs = new RoomSocket({
    url: 'ws://x', greet: greet as never, onMsg: (m) => msgs.push(m), onStatus: (s) => status.push(s),
    make: () => { const s = new FakeSock(); socks.push(s); return s; },
    timers: { set: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clear: () => {} },
  });
  return { rs, socks, timers, status, msgs };
}

describe('backoff', () => {
  it('첫 재시도는 2초 안, 두 배씩, 상한 10초', () => {
    expect(backoff(0)).toBeLessThanOrEqual(2000);
    expect([0, 1, 2, 3, 4, 5, 6].map(backoff)).toEqual([500, 1000, 2000, 4000, 8000, 10000, 10000]);
  });
});

describe('RoomSocket', () => {
  it('열리면 자리 되찾기 메시지를 먼저 보낸다', () => {
    const r = rig(() => ({ t: 'rejoin', seat: 1, pin: '1234' }));
    r.socks[0].open();
    expect(JSON.parse(r.socks[0].sent[0])).toEqual({ t: 'rejoin', seat: 1, pin: '1234' });
    expect(r.status.at(-1)).toBe('open');
  });

  it('끊기면 백오프로 다시 열고, 열리면 시도 횟수를 0 으로', () => {
    const r = rig();
    r.socks[0].open();
    r.socks[0].close();
    expect(r.status.at(-1)).toBe('retrying');
    expect(r.timers[0].ms).toBe(500);
    r.timers[0].f(); // 재시도 1: 새 소켓
    expect(r.socks).toHaveLength(2);
    r.socks[1].close(); // 열리기 전에 또 실패
    expect(r.timers[1].ms).toBe(1000);
    r.timers[1].f();
    r.socks[2].open();
    r.socks[2].close();
    expect(r.timers[2].ms).toBe(500);
  });

  it('4000(다른 기기가 자리를 가져감)으로 닫히면 다시 잇지 않는다', () => {
    const r = rig();
    r.socks[0].open();
    r.socks[0].close(4000);
    expect(r.status.at(-1)).toBe('replaced');
    expect(r.timers).toHaveLength(0);
  });

  it('close() 뒤에는 다시 잇지 않는다', () => {
    const r = rig();
    r.socks[0].open();
    r.rs.close();
    expect(r.timers).toHaveLength(0);
  });

  it('처리 중 오류는 console.error 로 남기고 다시 던진다(삼키지 않음)', () => {
    const socks: FakeSock[] = [];
    const errs: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errs.push(a); };
    try {
      new RoomSocket({ url: 'ws://x', greet: () => null, onStatus: () => {}, onMsg: () => { throw new Error('boom'); },
        make: () => { const s = new FakeSock(); socks.push(s); return s; }, timers: { set: () => 0, clear: () => {} } });
      socks[0].open();
      expect(() => socks[0].onmessage?.({ data: '{"t":"x"}' })).toThrow('boom');
      expect(errs).toHaveLength(1);
    } finally { console.error = orig; }
  });

  it('열리지 않은 소켓으로는 보내지 않는다, 깨진 메시지는 버린다', () => {
    const r = rig();
    expect(r.rs.send({ t: 'sync' })).toBe(false);
    r.socks[0].open();
    r.socks[0].onmessage?.({ data: '{깨짐' });
    r.socks[0].onmessage?.({ data: '{"t":"error","code":"bad"}' });
    expect(r.msgs).toEqual([{ t: 'error', code: 'bad' }]);
  });
});
