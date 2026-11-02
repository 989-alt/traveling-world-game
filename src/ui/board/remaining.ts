// 남은 놀이 시간(U1 · U16 §21.1): 판 시계 간판(Board TimerSign)과 큰 카드 동안 사슬 시계 칩(GameMenu)이 같은 값을 쓴다.
// 서버 값이 기준이고, 다음 상태가 오기 전엔 받은 시각(clockAt)부터 1초씩 줄여 보인다.
import { useEffect, useState } from 'preact/hooks';
import { LAST_MINUTES_MS } from '../../shared/economy';

export interface ClockGame { phase: string; clock: { remainingMs: number } }
export interface Remaining { ms: number; mm: number; ss: number; last: boolean; text: string; label: string }

export function remainingOf(ms: number): Remaining {
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  const mm = Math.floor(sec / 60), ss = sec % 60;
  const last = ms <= LAST_MINUTES_MS;
  return { ms, mm, ss, last, text: `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, label: `남은 시간 ${mm}분 ${ss}초${last ? ', 통행료 1.5배' : ''}` };
}

export function useRemaining(game: ClockGame, clockAt?: number): Remaining {
  const running = game.phase === 'playing' && clockAt !== undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [running, clockAt]);
  return remainingOf(Math.max(0, game.clock.remainingMs - (running ? Math.max(0, now - clockAt!) : 0)));
}
