// 엔진 상태·입력·로그 (PRD §9.1, §9.2). 상태는 JSON 그대로 저장·복원된다.
import type {
  CultureCard, CountryId, CultureCountryId, ExplanationCard, Level, Mission, MissionType, MTag,
  Question, TfStatement, TopicId,
} from './content-types';
import type { Continent } from './board';

export type Seat = 0 | 1 | 2 | 3;
export type ItemKind = 'tollFree' | 'tollHalf' | 'escape' | 'shield' | 'hint';
export type InstantReward = 'travelTile' | 'island' | 'doubleRoll' | 'toStart' | 'toMyLand' | 'takeFund';
export type Reward = InstantReward | ItemKind;

export interface Content {
  cards: ExplanationCard[];
  questions: Question[];
  tf: TfStatement[];
  culture: CultureCard[];
  missions: Mission[];
}

/** 2026-10-28 U1: 놀이 시간 하나(분). 옛 lessons·minutesPerLesson 은 없어졌다(PRD §3.7). U3: 20 삭제 */
export type TotalMinutes = 40 | 60 | 80;
export const TOTAL_MINUTES: readonly TotalMinutes[] = [40, 60, 80];

export interface Settings {
  totalMinutes: TotalMinutes;
  touristQuiz: boolean;
}

export type Step =
  | 'roll' | 'travel' | 'culture' | 'question' | 'explanation' | 'tf' | 'toll' | 'action'
  | 'takeover' | 'shield' | 'mission' | 'reward' | 'pickTile' | 'festival';

export interface TileState { owner: Seat | null; level: 0 | 1 | 2 | 3 | 4; festivalTarget: boolean }

export interface PlayerState {
  coin: number;
  pos: number;
  items: ItemKind[];
  islandTurns: number;
  bankrupt: boolean;
  doubles: number;
  travelPending: boolean;
  /** 월급 수령 횟수(출발 통과·도착). 바퀴 하한(PRD §3.3·§9.1, 2026-10-29 QA6). 옛 저장본은 0 으로 복원 */
  laps: number;
}

export interface PendingQuestion {
  qid: string;
  cardId: string;
  country: CountryId;
  level: Level;
  format: 'choice' | 'tf';
  answer: number | boolean;
  variant: 'full' | 'short';
  hintRemoved: number[];
  /** 그 나라 문항을 다 쓴 뒤 다시 내는 문항('복습' 표시) */
  review: boolean;
}

export interface PendingTf {
  stmtId: string;
  answer: boolean;
  answers: { seat: Seat; value: boolean }[]; // 답한 자리만. 없으면 무응답(null)
  /** 그 나라 문장을 다 쓴 뒤 가장 오래전 문장을 다시 냄 */
  review?: boolean;
}

export interface MissionAnswer {
  pairs?: { left: string; right: string }[];
  steps?: string[];
  selected?: number[];
}

export interface TurnState {
  seat: Seat;
  step: Step;
  tile: number | null;
  /** 이번 도착 문항 결과. null = 문항 없음/아직 */
  correct: boolean | null;
  /** 정답 할인 유효 — 이 도착에서만. 턴이 끝나면 false */
  discount: boolean;
  rolledDouble: boolean;
  extraRoll: boolean;
  question: PendingQuestion | null;
  tf: PendingTf | null;
  missionId: string | null;
  missionSuccess: boolean;
  rewardOptions: Reward[];
  takeoverCost: number;
}

export interface GameState {
  settings: Settings;
  seats: { isBot: boolean; connected: boolean }[];
  phase: 'playing' | 'paused' | 'finished';
  /** 남은 놀이 시간. playing 일 때만 준다(서버 tick). pauseBy = 멈춤 요청이 와서 이 턴이 끝나면 멈춘다 */
  clock: { remainingMs: number; pauseBy: 'host' | 'auto' | null };
  tiles: TileState[];
  players: PlayerState[];
  turn: TurnState;
  revealedCards: string[];
  usedQuestionIds: string[];
  usedTfIds: string[];
  usedMissionIds: string[];
  seenCountries: string[];
  fund: number;
  climateEvent: { continent: Continent; turnsLeft: number; bySeat: Seat } | null;
  /** 성립한 대륙 독점(영구 — 광장 지도·이정표 자리색, 결과 화면). 성립 순서대로 */
  monopolies: { continent: Continent; seat: Seat }[];
  winner: { seat: Seat; kind: 'bankruptcy' | 'monopoly' | 'assets' } | null;
  rngSeed: number;
  rngState: number;
  log: LogEvent[];
}

export type Action =
  | { type: 'roll'; seat: Seat; gauge?: number }
  | { type: 'escape'; seat: Seat; method: 'coin' | 'item' }
  | { type: 'travel'; seat: Seat; tile: number }
  | { type: 'ack'; seat: Seat }
   | { type: 'answer'; seat: Seat; choice: number | boolean; ms: number }
  | { type: 'useHint'; seat: Seat }
  | { type: 'tfAnswer'; seat: Seat; value: boolean }
  | { type: 'payToll'; seat: Seat; item: 'tollFree' | 'tollHalf' | null }
   | { type: 'buy'; seat: Seat }
   | { type: 'build'; seat: Seat }
   | { type: 'takeover'; seat: Seat }
  | { type: 'pass'; seat: Seat }
  | { type: 'shield'; seat: Seat; use: boolean }
  | { type: 'missionAnswer'; seat: Seat; answer: MissionAnswer; ms: number }
  | { type: 'chooseReward'; seat: Seat; index: number }
  | { type: 'pickTile'; seat: Seat; tile: number }
  | { type: 'pickFestival'; seat: Seat; tile: number | null }
  // 서버(신뢰)만 보내는 입력
  /** shown: 해설 단계를 닫을 때만 쓴다 — 마감 전에 해설 카드를 다 봤다고 알려 온 자리(기기 신호, T05c) */
  | { type: 'timeout'; shown?: Seat[] }
  | { type: 'tick'; ms: number }
  | { type: 'resume' }
  /** 멈춤: 턴 시작 단계면 바로, 아니면 지금 턴을 마친 뒤 paused(PRD §3.7). auto = 사람 자리 전원 60초 끊김 */
  | { type: 'pause'; by: 'host' | 'auto' }
  | { type: 'setConnected'; seat: Seat; connected: boolean };

/** fund = 미션 보상 "기금 받기" 수령(기금 칸은 없어졌다). climate = 남극 도착 뒤 기후 위기 발생. korea = 출발·한국 탐험 결과.
 *  monopoly = 대륙 독점 성립(payload.continent) — 2026-10-26 판 재설계 */
export type EventKind = 'island' | 'travel' | 'festival' | 'fund' | 'climate' | 'antarctic' | 'korea' | 'tourist' | 'monopoly';

// PRD §9.2 표와 1:1. ev 는 이벤트 이름(mission 의 type 필드와 겹치지 않게).
export type LogEvent =
  | { ev: 'dice'; seat: Seat; d1: number; d2: number }
  | { ev: 'move'; seat: Seat; from: number; to: number; via: 'dice' | 'travel' | 'mission' }
  | { ev: 'culture_card'; seat: Seat; country: CultureCountryId; firstVisit: boolean; badgeShown: boolean }
  | { ev: 'question'; seat: Seat; qid: string; country: CountryId; level: Level; kind: 'initial' | 'review'; topics: TopicId[]; mTags: MTag[]; review: boolean }
  /** chosenMTags: 고른 선지의 오개념 태그(정답 [], 무응답 null) — §9.2 확장. 엔진은 늘 채운다(선택 필드는 옛 로그·시험 픽스처용) */
  | { ev: 'answer'; seat: Seat; qid: string; choice: number | boolean | null; correct: boolean; ms: number; isBot: boolean; chosenMTags?: MTag[] | null }
  /** 해설 단계가 끝날 때 남긴다. shownTo[i] = 봇 자리이거나, 그 기기가 카드를 표시 시간만큼 그리고 shown 을 보냄 */
  | { ev: 'explanation'; qid: string; cardId: string; variant: 'full' | 'short'; shownTo: boolean[]; shownMs: number }
  /** review: 관전 문장을 다 쓴 뒤 다시 낸 문장(§9.2 확장, 첫 정답률에서 뺀다). 엔진은 늘 채운다(선택 필드는 옛 로그용) */
  | { ev: 'tf'; cardId: string; stmtId: string; mTag: MTag | null; topics: TopicId[]; review?: boolean }
  | { ev: 'tf_answer'; seat: Seat; stmtId: string; value: boolean | null; correct: boolean; isBot: boolean }
  | { ev: 'buy'; seat: Seat; tile: number; price: number; discounted: boolean }
  | { ev: 'build'; seat: Seat; tile: number; level: number; cost: number }
  /** 강제 지불 매각으로 건물을 잃었거나 땅을 판 칸(§9.2 확장). levelBefore = 팔기 전 단계(4 = 랜드마크) */
  | { ev: 'sold'; seat: Seat; tile: number; levelBefore: number }
  | { ev: 'toll'; payer: Seat; owner: Seat; tile: number; base: number; multiplier: number; discounted: boolean; paid: number }
  | { ev: 'takeover'; seat: Seat; tile: number; correct: boolean; shielded: boolean; cost: number }
  | { ev: 'mission'; seat: Seat; missionId: string; type: MissionType; topics: TopicId[]; mTags: MTag[]; analytic: boolean; success: boolean; ms: number }
  | { ev: 'stamp'; seat: Seat; country: CountryId; level: Level }
  | { ev: 'event'; seat: Seat; kind: EventKind; payload: Record<string, unknown> }
  /** 놀이 시계(2026-10-28 U1, 옛 lesson 대체). by: host = 방장(시작·멈춤·이어 하기), auto = 서버(전원 끊김 멈춤·파산/독점으로 끝), timeout = 시간이 다 됨 */
  | { ev: 'clock'; kind: 'start' | 'pause' | 'resume' | 'end'; remainingMs: number; by: 'host' | 'auto' | 'timeout' }
  | { ev: 'result'; finalRanks: Seat[]; assets: number[] };
