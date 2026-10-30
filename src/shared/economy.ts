// 경제 수치 (PRD §4.4 초깃값). T10 시뮬이 조정한다 — 이름 붙은 상수로만 둔다.

export const START_COIN = 5000;
/** 2026-10-26 판 재설계: 옛 600 × 30/40 (S2 조정) */
export const SALARY = 480;
/** 정답 할인율 d. 허용 {0.4, 0.5, 0.6} */
export const DISCOUNT = 0.5;
/** 건설비 = 땅값 × BUILD_RATE[지을 단계] (누적 아님). index 0 은 안 씀 */
export const BUILD_RATE = [0, 1, 1.5, 2, 3];
/** 통행료 기준 = 땅값 × TOLL_RATE[건물 단계] */
export const TOLL_RATE = [0.3, 0.8, 1.6, 2.8, 6];
/** 인수비 = (땅값 + 세운 건물 건설비 합) × TAKEOVER_RATE */
export const TAKEOVER_RATE = 1.5;
/** 인수할 수 있는 건물 단계 상한(PRD §3.2, 2026-10-29 U5): 빈 깃발·집·시장(0~2)까지. 호텔(3)·랜드마크(4)는 인수 불가, 봇도 같다 */
export const TAKEOVER_MAX_LEVEL = 2;
export const FESTIVAL_MULT = 2;
export const LAST_MINUTES_MULT = 1.5;
/** 막판 = 마지막 5분, 모든 길이 같음(PRD §3.7. 2026-10-28 U3: 20분 판 3분 삭제) */
export const LAST_MINUTES_MS = 5 * 60_000;
export const CLIMATE_MULT = 0.5;
export const CLIMATE_TURNS = 2;
export const TOLL_HALF_ITEM = 0.5;
export const TF_REWARD = 50;
export const ISLAND_ESCAPE_COST = 500;
export const ISLAND_TURNS = 3;
export const ITEM_LIMIT = 2;
/** PRD 에 값 없음(§3.6 "보너스 코인"). T10 이 정한다 */
export const ANTARCTIC_BONUS = 300;
/** 출발·한국 탐험 정답 보너스(PRD §4.4, 남극과 같은 값에서 시작, S2 조정). 아이템 없음 */
export const KOREA_BONUS = 300;
/** 파산 직전 강제 매각가 = 자산 가치 × SELL_RATE. PRD 에 값 없음 */
export const SELL_RATE = 1;
/** 주사위 게이지: 반대쪽이 나오면 이 확률(×세기)로 한 번 다시 굴린다. 0.6 이면 합 7 이상 확률 변화 ≤ 14.6%p */
export const GAUGE_REROLL = 0.6;

/** 단계 제한 시간 (PRD §4.3). 엔진은 시간을 재지 않는다 — 서버가 이 값으로 timeout 을 보낸다 */
export const STEP_MS = {
  roll: 15_000,
  travel: 15_000,
  /** 문화 카드 첫 방문 5초 고정, 다시 온 나라 3초(누르면 넘김) — PRD §4.3 U10 */
  culture: 5_000,
  cultureRevisit: 3_000,
  question: 20_000,
  explanationFull: 7_000,
  explanationShort: 4_000,
  tf: 6_000,
  /** 참/거짓 결과 2초(= shared/timing TF_RESULT_MS). 전원 답해도·6초 마감 뒤에도 이만큼 보인 뒤 닫힌다 */
  tfResult: 2_000,
  toll: 10_000,
  action: 10_000,
  takeover: 10_000,
  shield: 5_000,
  mission: 45_000,
  reward: 10_000,
  /** 보드에서 칸 고르기(§3.6.1): 세계여행·내 땅으로·세계 축제 모두 15초 */
  pickTile: 15_000,
  festival: 15_000,
};

/** 봇 정답률 추출 범위 [하한, 상한) — 놀이 시간별(PRD §4.5, 2026-10-28 U2). sim·worker 공용 단일 출처.
 *  폭 0.10 고정, 중심만 조정 창 안에서 옮긴다(40: 0.58~0.72 · 60: 0.52~0.68 · 80: 0.48~0.65). S12 결과로 정한다. U3: 20 키 삭제 */
export const BOT_ACCURACY: Record<40 | 60 | 80, readonly [number, number]> = {
  40: [0.6, 0.7],
  60: [0.55, 0.65],
  80: [0.5, 0.6],
};
