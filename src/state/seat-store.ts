// 기기에 남기는 것은 {roomCode, seatNo, seatPin} 하나뿐(PRD §9). 저장이 막힌 브라우저에서도 게임은 돈다.
import { CODE_RE, PIN_RE } from '../shared/protocol';
import type { Seat } from '../shared/types';

export interface SavedSeat { roomCode: string; seatNo: Seat; seatPin: string }
const KEY = 'tw.seat';

export function loadSeat(store: Pick<Storage, 'getItem'> | null = safeStore()): SavedSeat | null {
  try {
    const v = JSON.parse(store?.getItem(KEY) ?? 'null') as SavedSeat | null;
    return v && CODE_RE.test(v.roomCode) && [0, 1, 2, 3].includes(v.seatNo) && PIN_RE.test(v.seatPin) ? v : null;
  } catch { return null; }
}

export function saveSeat(v: SavedSeat | null, store: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStore()) {
  try { if (v) store?.setItem(KEY, JSON.stringify(v)); else store?.removeItem(KEY); } catch { /* 저장 불가: 이번 접속만 */ }
}

function safeStore(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
