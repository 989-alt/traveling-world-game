// 클라이언트 ↔ 서버 메시지 (PRD §9, S10). 학생이 쓰는 글은 어디에도 없다:
// 클라이언트→서버는 열거형·숫자·불리언과 정규식으로 묶인 코드·PIN 뿐이다.
import { BOARD_SIZE } from './board';
import type { ExplanationCard } from './content-types';
import { TOTAL_MINUTES } from './types';
import type { GameState, LogEvent, PendingQuestion, Seat, Settings, TurnState } from './types';

export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0·O·1·I 제외
export const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
export const PIN_RE = /^[0-9]{4}$/;
/** 잠긴 자리의 PIN 비교 간격(서버, 모든 소켓 합산). 'locked' 를 받은 기기는 이만큼 뒤 다시 보낸다 */
export const PIN_TRY_MS = 3_000;
/** 게임 중 단계 키 `자리|단계|로그 길이`. 서버 RoomRec.stepKey·기기 stepKeyOf·shown 이 같은 꼴을 쓴다 */
export const stepKey = (seat: Seat, step: TurnState['step'], logLen: number) => `${seat}|${step}|${logLen}`;
/** 해설 단계 stepKey(위 stepKey 꼴의 explanation) */
export const SHOWN_KEY_RE = /^[0-3]\|explanation\|[0-9]{1,7}$/;
/** 별명 = [형용사 번호, 동물 번호]. 서버가 뽑고, 낱말 목록은 화면 쪽에 있다 */
export const NICK_ADJ_COUNT = 16;
export const NICK_ANIMAL_COUNT = 16;
export const MAX_MESSAGE_CHARS = 2048;
/** 고를 수 있는 캐릭터 수(charId 0..CHAR_COUNT-1) */
export const CHAR_COUNT = 6;

/** 랜드마크 컷씬 타임라인(Cutscene.tsx)과 끝난 뒤 배너를 읽을 시간 */
export const CUT_MS = 4000;
export const HOLD_MS = 800;
/** 컷씬 전체 길이. 컷씬 뒤 첫 문항 마감에 더한다 */
export const CUTSCENE_MS = CUT_MS + HOLD_MS;
/** 컷씬 시작 뒤 이만큼 동안 상태에 cutscene 을 싣는다: 컷씬 4초 + 배너 2초(DESIGN §12.3 재접속 복구) */
export const CUT_RESUME_MS = CUT_MS + 2000;

/** 미션 답은 글자가 아니라 번호로 보낸다. 연결·블록·순서는 서버가 내려 준 표시 목록(PublicTurn.mission)의 번호,
 *  사진·그래프는 선지 번호. 서버가 원래 내용으로 바꿔 엔진에 넘긴다 */
export type ClientAct =
  | { type: 'roll'; gauge?: number }
  | { type: 'escape'; method: 'coin' | 'item' }
  | { type: 'travel'; tile: number }
  | { type: 'ack' }
  | { type: 'answer'; choice: number | boolean; ms: number }
  | { type: 'useHint' }
  | { type: 'tfAnswer'; value: boolean }
  | { type: 'payToll'; item: 'tollFree' | 'tollHalf' | null }
  | { type: 'buy' }
  | { type: 'build' }
  | { type: 'takeover' }
  | { type: 'pass' }
  | { type: 'shield'; use: boolean }
  | { type: 'missionAnswer'; pairs?: [number, number][]; steps?: number[]; selected?: number[]; ms: number }
  | { type: 'chooseReward'; index: number }
  | { type: 'pickTile'; tile: number }
  | { type: 'pickFestival'; tile: number | null };

export type ClientMsg =
  | { t: 'hello'; charId: number }
  | { t: 'rejoin'; seat: Seat; pin: string }
  | { t: 'start' }
  /** 방장: 멈춤(수업 종). 지금 턴을 마친 뒤 시계 정지 → 멈춤 화면(PRD §3.7) */
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'sync' }
  /** 이 기기가 해설 카드를 표시 시간(§3.1)만큼 그렸다. 자동 전송(버튼 없음). stepKey = 그 해설 단계 */
  | { t: 'shown'; stepKey: string }
  | { t: 'act'; a: ClientAct };

export type ErrorCode = 'bad' | 'full' | 'started' | 'pin' | 'locked' | 'notHost' | 'notSeated' | 'logFull';

export interface PublicSeat {
  taken: boolean;
  isBot: boolean;
  connected: boolean;
  nick: [number, number];
  charId: number;
}

/** 연결·블록·순서 미션의 표시 목록. 서버가 미션마다 시드로 섞는다(좌·우·단계 각각 독립) — 클라이언트 사본엔 짝·정답 순서가 없다.
 *  at: 지도 자리 미션이면 right[i] 칸을 놓을 지도 위치 [경도, 위도]. zones: 기후 구역 미션이면 right[i] 칸의 구역 색 */
export interface MissionShown { left: string[]; right: string[]; steps: string[]; at?: [number, number][]; zones?: string[] }

/** 미션 실패 해설(PRD §3.5, QA r3). 서버가 판정 뒤(참/거짓 단계) 실패한 도착자 자리에만 보낸다. 번호는 표시 번호(MissionShown) 기준.
 *  pairs: 연결 [왼쪽, 오른쪽] · 블록 [블록(left), 칸(right)]. steps: 순서 미션 정답 순서대로 표시 번호. correct: 사진·그래프 정답 options 번호 */
export interface MissionReveal { pairs?: [number, number][]; steps?: number[]; correct?: number[]; explain: string }

/** 해설 카드 화면용: 오개념 태그·지도 내용 번호를 뺀 것. 서버가 해설 단계에만 보낸다(번들에 카드 글 없음) */
export type PublicCard = Omit<ExplanationCard, 'mTags' | 'topics'>;

/** 방송용 턴: 문항 정답·카드 id 는 question 단계 동안 없다(해설부터 있음). 참/거짓은 문장 id 만(정답·남의 선택 없음) */
export type PublicTurn = Omit<TurnState, 'question' | 'tf'> & {
  question: Omit<PendingQuestion, 'answer' | 'cardId'> & { answer?: PendingQuestion['answer']; cardId?: string } | null;
  tf: { stmtId: string } | null;
  mission: MissionShown | null;
  /** 실패 해설: 참/거짓 단계에 실패한 도착자 자리에게만. 그 밖의 자리·단계엔 없음(null) */
  reveal?: MissionReveal | null;
};

/** 방송용 게임 상태: 시드·rng 상태(앞으로 나올 주사위)와 로그는 뺀다. 로그는 log 로 이어 보낸다 */
export type PublicGame = Omit<GameState, 'rngSeed' | 'rngState' | 'log' | 'turn'> & { turn: PublicTurn };

export type ServerMsg =
  | { t: 'welcome'; seat: Seat; pin: string } // 그 자리 하나에게만
  | { t: 'pins'; pins: { seat: Seat; pin: string }[] } // 일시 정지 때 자리마다 따로
  | { t: 'error'; code: ErrorCode }
  | {
      t: 'state';
      code: string;
      phase: 'lobby' | GameState['phase'];
      settings: Settings;
      hostSeat: Seat;
      seats: PublicSeat[];
      game: PublicGame | null;
      deadlineAt: number | null;
      /** 지금 단계가 시작된 서버 시각. 현재 시각이 아니다(재접속 때 이것을 '지금'으로 보면 남은 시간이 부풀어 보인다) */
      stepAt: number;
      /** 이 메시지를 만든 순간의 서버 시각. 기기는 매 메시지(전체·증분)마다 시계 차이 = now − Date.now() 로 다시 잰다 */
      now: number;
      /** 카드 글: 해설·참/거짓 단계엔 그 카드, 정지·끝엔 함께 본 카드 + 랜드마크 나라 1~3단계(결과 마그넷). 그 밖엔 [] */
      cards: PublicCard[];
      /** 대기실 안내(새 판이 시작되면 null). oldBoard = 옛 판(40칸) 저장본을 버림, oldTime = 20분 판 저장본을 버림,
       *  newTime = 대기실의 옛 놀이 시간 설정을 40분으로 바꿈 */
      notice: 'oldBoard' | 'oldTime' | 'newTime' | null;
      /** 진행 중인 랜드마크 컷씬(시작 뒤 CUT_RESUME_MS 동안). t0 = 서버 시작 시각. 기기는 전체 다시 받기 때만 쓴다 */
      cutscene: { tile: number; builder: Seat; t0: number } | null;
      /** log 의 첫 이벤트가 전체 로그에서 몇 번째인지 */
      logFrom: number;
      log: LogEvent[];
    };

// ── 검증 ─────────────────────────────────────────────────
type F = (v: unknown) => boolean;
const int = (lo: number, hi: number): F => (v) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const num = (lo: number, hi: number): F => (v) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const bool: F = (v) => typeof v === 'boolean';
const oneOf = (...xs: unknown[]): F => (v) => xs.includes(v);
const match = (re: RegExp): F => (v) => typeof v === 'string' && re.test(v);
const opt = (f: F): F => (v) => v === undefined || f(v);
const list = (f: F, max: number): F => (v) => Array.isArray(v) && v.length <= max && v.every(f);
const either = (...fs: F[]): F => (v) => fs.some((f) => f(v));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** 정해진 키만, 각 키는 검사 통과. 모르는 키가 하나라도 있으면 거부 */
const shape = (spec: Record<string, F>): F => (v) =>
  isObj(v) && Object.keys(v).every((k) => k in spec) && Object.entries(spec).every(([k, f]) => f(v[k]));

const IDX = int(0, 11);
const MS = num(0, 600_000);
/** 칸 번호 0..29 (30칸 고리, 2026-10-26) */
const TILE = int(0, BOARD_SIZE - 1);

export const ACT_SPEC: Record<ClientAct['type'], Record<string, F>> = {
  roll: { gauge: opt(num(0, 1)) },
  escape: { method: oneOf('coin', 'item') },
  travel: { tile: TILE },
  ack: {},
  answer: { choice: either(int(0, 3), bool), ms: MS },
  useHint: {},
  tfAnswer: { value: bool },
  payToll: { item: oneOf('tollFree', 'tollHalf', null) },
  buy: {},
  build: {},
  takeover: {},
  pass: {},
  shield: { use: bool },
  missionAnswer: { pairs: opt(list((v) => Array.isArray(v) && v.length === 2 && v.every(IDX), 12)), steps: opt(list(IDX, 12)), selected: opt(list(IDX, 12)), ms: MS },
  chooseReward: { index: int(0, 2) },
  pickTile: { tile: TILE },
  pickFestival: { tile: either(TILE, oneOf(null)) },
};

const act: F = (v) => isObj(v) && typeof v.type === 'string' && Object.hasOwn(ACT_SPEC, v.type) &&
  shape({ ...ACT_SPEC[v.type as ClientAct['type']], type: () => true })(v);

export const MSG_SPEC: Record<ClientMsg['t'], Record<string, F>> = {
  hello: { charId: int(0, CHAR_COUNT - 1) },
  rejoin: { seat: int(0, 3), pin: match(PIN_RE) },
  start: {},
  pause: {},
  resume: {},
  sync: {},
  shown: { stepKey: match(SHOWN_KEY_RE) },
  act: { a: act },
};

export function parseClient(raw: unknown): ClientMsg | null {
  if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_CHARS) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isObj(v) || typeof v.t !== 'string' || !Object.hasOwn(MSG_SPEC, v.t)) return null;
  return shape({ ...MSG_SPEC[v.t as ClientMsg['t']], t: () => true })(v) ? (v as ClientMsg) : null;
}

export function parseSettings(v: unknown): Settings | null {
  const ok = shape({ totalMinutes: oneOf(...TOTAL_MINUTES), touristQuiz: bool })(v);
  return ok ? (v as Settings) : null;
}
