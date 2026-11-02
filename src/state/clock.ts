// 화면 시계(U14, DESIGN §20.1 정지): 멈춘 판은 타이머 링·해설 막대·고르기 간판이 멈춘 순간 값으로 고정돼야 한다.
// 서버 마감(deadlineAt)은 멈춘 동안 그대로이고 재개 때 Δ 만큼 밀려 온다 → 화면은 멈춘 동안 '지금'을 멈춘 시각에 묶어 두면 된다.
// 화면 타이머(missions/Timer useNow)만 이 값을 읽는다. 답 ms·연결·서버 시계 차이 계산은 Date.now() 그대로.
let frozenAt: number | null = null;

/** 화면 타이머가 쓰는 지금(멈춘 동안은 멈춘 시각) */
export const screenNow = () => frozenAt ?? Date.now();

/** at = 이 기기 시계로 본 멈춘 시각(null = 풀기) */
export function freezeScreenClock(at: number | null) {
  frozenAt = at;
}
