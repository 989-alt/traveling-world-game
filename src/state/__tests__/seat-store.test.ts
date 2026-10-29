import { describe, expect, it } from 'vitest';
import { loadSeat, saveSeat } from '../seat-store';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('seat-store', () => {
  it('저장·복원·삭제, 모양이 틀리면 null', () => {
    const st = mem();
    saveSeat({ roomCode: 'ABCDEF', seatNo: 2, seatPin: '0420' }, st);
    expect(loadSeat(st)).toEqual({ roomCode: 'ABCDEF', seatNo: 2, seatPin: '0420' });
    st.setItem('tw.seat', '{"roomCode":"abc","seatNo":9,"seatPin":"x"}');
    expect(loadSeat(st)).toBeNull();
    saveSeat(null, st);
    expect(loadSeat(st)).toBeNull();
  });
  it('저장소가 던져도 게임은 돈다', () => {
    const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(loadSeat(bad)).toBeNull();
    expect(() => saveSeat({ roomCode: 'ABCDEF', seatNo: 0, seatPin: '1111' }, bad)).not.toThrow();
  });
});
