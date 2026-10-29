// 금테 원형 타이머(DESIGN §4.2): 파란 호가 줄어든다(SVG stroke-dashoffset). 5초부터 경고색.
// watch: 스톱워치 모양(R2 D2, v3 03·05) — 위 크라운(고리 + 꼭지) + 양옆 단추를 SVG 로 덧붙인다(장식, 크기·자리는 그대로)
import { useEffect, useState } from 'preact/hooks';
import { timeLeft } from './logic';
import '../../styles/missions.css'; // .tm 모양(문항 두루마리·행동 패널도 이 타이머를 쓴다)

export function useNow(everyMs = 200) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const R = 30;
const C = 2 * Math.PI * R;

export function Timer({ deadlineAt, totalMs, watch }: { deadlineAt: number; totalMs: number; watch?: boolean }) {
  const left = timeLeft(deadlineAt, useNow());
  const sec = Math.ceil(left / 1000);
  return (
    <div class={`tm${sec <= 5 ? ' is-warn' : ''}${watch ? ' tm--watch' : ''}`} role="timer" aria-label={`남은 시간 ${sec}초`} data-sec={sec}>
      {watch && <WatchCrown />}
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle class="tm-track" cx="36" cy="36" r={R} />
        <circle class="tm-arc" cx="36" cy="36" r={R} stroke-dasharray={C} stroke-dashoffset={C * (1 - Math.min(1, left / totalMs))} transform="rotate(-90 36 36)" />
      </svg>
      <span class="tm-num">{sec}</span>
    </div>
  );
}

/** 스톱워치 크라운·옆 단추(타이머 상자 위로 솟는 장식). 금 = gold 토큰, 테두리 = 진한 금 */
function WatchCrown() {
  return (
    <svg class="tm-crown" viewBox="0 0 120 44" aria-hidden="true">
      <g class="tm-btn" transform="rotate(-38 22 36)"><rect x="12" y="30" width="20" height="12" rx="4" /><rect class="tm-hi" x="15" y="32" width="14" height="3" rx="1.5" /></g>
      <g class="tm-btn" transform="rotate(38 98 36)"><rect x="88" y="30" width="20" height="12" rx="4" /><rect class="tm-hi" x="91" y="32" width="14" height="3" rx="1.5" /></g>
      <circle class="tm-loop" cx="60" cy="11" r="8" /><circle class="tm-loop tm-loop--in" cx="60" cy="11" r="8" />
      <rect class="tm-stem" x="53" y="16" width="14" height="14" rx="3" />
      <rect class="tm-stem" x="47" y="27" width="26" height="12" rx="5" />
      <rect class="tm-hi" x="51" y="29" width="18" height="3" rx="1.5" />
    </svg>
  );
}
