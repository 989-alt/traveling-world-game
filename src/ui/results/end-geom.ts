// U12 엔딩(DESIGN §19.2) → U13(§19.9.4) 배치 수치. 스테이지 1366×768, 사진 묶음은 그룹 좌표(그룹 상자 (46,44,820,700), −3° 회전).
// 여권 그림 안 틀 위치는 키잉한 WebP(assets/webp/END-passport-*.webp)의 뚫린 칸을 잰 값(%, 트림 상자 기준).
// 생성본마다 비율·틀 자리가 조금씩 달라(펼친 여권 3 은 가로 1.23) 그림마다 따로 둔다.
import { poseOf } from '../../assets/manifest';

// U13 재배치(2026-11-01 사용자 "sample-vs-mock 기준 왼쪽(시안)이 훨씬 나아"): 수치는 §19.9.4 가 아니라 승인 시안 MOCK-end-C2 에서 잰 값(1672 → 1366 환산).
// 시안 사진: 바깥 꼭짓점 ≈ (7,68)·(785,12)·(838,702)·(61,766), −4.4°, 창 724×524(옆·위 테 28), 아래 테 148, 아이 키 ≈ 350~380 · 발 기준선 한 줄 · 간격 ≈ 172.
export const GROUP = { x: 33, y: 34, w: 780, h: 700, rot: -4.4 } as const;
/** 사진 창(틀 안) — END-photo-frame-v2 를 9 조각으로 맞춘 자리 */
export const WINDOW = { x: 28, y: 28, w: 724, h: 524 } as const;
/** 발 기준선 한 줄(1위도 같은 y) — 시안 발 밑 ≈ 창 아래변 46px 위 */
export const FOOT_Y = 506;
/** 슬롯 간격(시안 ≈ 172, 이웃과 조금 겹침 허용) */
export const SLOT_GAP = 172;
/** 사람 키(발~정수리) — 시안 아이 ≈ 350~380 */
export const H = 350;
/** 로봇(CH7) 키 = H × 0.63: 머리가 몸의 절반이라 같은 키면 거인, 머리 폭을 맞추면 장난감 — 아이와 몸 폭·덩치가 비슷해지는 값(0.70 은 머리 1.3배로 아이보다 커 보였다) */
export const ROBOT_K = 0.63;
/** 트로피(P20 트림 위끝)가 창 위변 아래 10px 안에 들어오게 — 넘으면 그 사람만 줄인다(트로피 그림이 커서 1위 아이 P20 은 ≈ 0.9배) */
export const TOP_MIN = WINDOW.y + 10;
/** 로제트(상장형 END-rosette: 주름 원판 + 아래로 늘어진 리본, 숫자 새김): 상자 84(주름 원판 ≈ 58, 원판 중심 = 상자 37.5%),
 *  상자 중심 y 556 → 원판 중심 ≈ 545(창 아래변 552 에 걸침), 리본 끝 ≈ 595 — 시안 실측(원판 545 · 리본 끝 592) */
export const ROSETTE_Y = 556;
export const ROSETTE = 84;
/** 테이프 이름표 140×32(시안 ≈ 125×30 — 이름 7자 "씩씩한 고슴도치" 가 20px 로 들어가는 폭), 중심 y 615(시안, 리본 끝 바로 아래) — '나'도 같은 크기(하트 링 없앰, 2026-11-01 사용자) */
export const TAPE = { w: 140, h: 32, y: 615 } as const;
/** 테이프 기울기(슬롯 왼쪽부터) */
export const TAPE_ROT = [-2, 1.5, -1.5, 2] as const;
/** 랜드마크 0 → 열기구(바닥 중앙 앵커): 사람들 뒤 하늘. 시안 에펠탑 자리(x 440)는 1위 트로피(그림이 커서 폭 ≈ 190)와 겹쳐 3·4위 사이 위로 */
export const BALLOON = { x: 568, base: 250, h: 220 } as const;
/** (U12 옛 판) 메달 없는 포즈 P20/P21 로 내려갈 때: 로봇 보이는 키 배수 */
export const ROBOT_SCALE = 0.8;
/** 사진 속 랜드마크: 시안 에펠탑처럼 가운데 왼쪽, 사람들 뒤로 크게(위끝 ≈ 창 위 40) */
export const LANDMARK = { x: 440, base: 345, h: 305 } as const; // 기단이 아이들 몸통 뒤(시안 에펠탑 위끝 ≈ 창 위 40)
/** 랜드마크 x: 4명이면 1위·3위 사이 뒤, 3명이면 1위·3위 사이, 2명이면 오른쪽 빈 풀밭(트로피에 가리지 않게) */
export const landmarkX = (count: number) => (count >= 4 ? LANDMARK.x : count === 3 ? 470 : 600);

/** 슬롯 순서 = 2위·1위·3위·4위(단상 읽기). 인원이 적으면 같은 간격으로 가운데 정렬. 반환 = 순위 인덱스(0 = 1위)별 발 x */
export function footXs(count: number): number[] {
  const order = [1, 0, 2, 3].filter((r) => r < count);
  const xs: number[] = [];
  order.forEach((r, i) => { xs[r] = WINDOW.x + WINDOW.w / 2 + (i - (order.length - 1) / 2) * SLOT_GAP; });
  return xs;
}

/** U13 메달 포즈 키: 1위 = p20gold, 2·3·4위 = p21silver·bronze·plain, 로봇은 목도리 자리색 .s<자리>. 순위가 없으면(중간 끝) plain */
const MEDAL = ['p20gold', 'p21silver', 'p21bronze', 'p21plain'] as const;
export const medalPoseKey = (charId: number, seat: number, rank: number | null) =>
  `char.${charId}.${rank === null ? 'p21plain' : MEDAL[rank] ?? 'p21plain'}${charId === 7 ? `.s${seat + 1}` : ''}`;

/** 포즈 그림 상자(정사각, 발 앵커 = 아래 가운데). 키 = H(로봇 H × ROBOT_K), 트로피가 창 위로 나가면 그 사람만 줄임.
 *  P20 은 트로피가 트림 위에 들어가 상자가 커진다(body = 발~정수리 ÷ 트림 높이, 매니페스트 poses 실측) */
export function figure(key: string, charId: number, fx: number, fy = FOOT_Y) {
  const pose = poseOf(key);
  const want = H * (charId === 7 ? ROBOT_K : 1);
  const body = Math.min(want, (fy - TOP_MIN) * pose.body);
  const scale = body / want;
  const trim = body / pose.body;
  const side = trim / pose.h;
  return {
    side, body, trim, scale,
    left: fx - side / 2, top: fy - side,
    head: fy - body,
    /** 트로피 가운데(P20 트림 위 12%) */
    trophy: { x: fx, y: fy - trim + 0.12 * trim },
  };
}

/** 회전 뒤 스테이지 좌표(색종이가 사진 윗변에 걸리는 자리) */
export function toStage(gx: number, gy: number) {
  const cx = GROUP.w / 2, cy = GROUP.h / 2, a = (GROUP.rot * Math.PI) / 180;
  const dx = gx - cx, dy = gy - cy;
  return { x: GROUP.x + cx + dx * Math.cos(a) - dy * Math.sin(a), y: GROUP.y + cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

type Box = [number, number, number, number]; // x, y, w, h (%)
/** 펼친 여권(BOOK): x 760 · 폭 592 · 위 112 — 시안 여권(x 768~1352, 위 122)처럼 사진 오른쪽 끝에 걸쳐 크게. 높이 = 그림 비율 */
export const BOOK = { x: 760, w: 592, top: 112 } as const;
/** U13 펼친 여권 v2(가로형, 항목 이름·학습 도장이 그림에 듦): 키잉 WebP 실측(%, 트림 상자). p = 초상 틀, s = 스티커 틀 3,
 *  v = 학습 수치 자리(열 가운데 x 2 = 그림 밑줄 가운데 · 밑줄 y 2 — 수치는 밑줄 위에 쓴다, 도장 고리 아래 끝과 ≈ 2.5% 띠), right = 오른쪽 면 글자 폭 */
export interface OpenV2 { a: number; p: Box; s: [Box, Box, Box]; v: { x: [number, number]; y: [number, number] }; right: [number, number] }
export const OPEN_V2: Record<number, OpenV2> = {
  1: { a: 1.4834, p: [16.29, 10.23, 21.29, 27.49], s: [[54.83, 56.78, 10.00, 17.39], [68.36, 56.78, 9.91, 17.39], [81.72, 56.78, 10.09, 17.39]], v: { x: [16.4, 35.7], y: [64.5, 89.6] }, right: [56, 92] },
  2: { a: 1.3760, p: [16.38, 9.61, 20.69, 27.52], s: [[54.66, 59.55, 10.26, 15.66], [68.45, 59.55, 10.34, 15.66], [82.41, 59.55, 10.60, 15.66]], v: { x: [17.1, 35.7], y: [63.7, 89.2] }, right: [56, 92] },
  3: { a: 1.3842, p: [16.29, 9.19, 20.17, 27.92], s: [[54.57, 59.90, 9.57, 16.11], [68.45, 59.90, 9.40, 16.11], [82.07, 59.90, 9.66, 16.11]], v: { x: [16.2, 34.6], y: [62.5, 87.1] }, right: [56, 92] },
  4: { a: 1.4356, p: [16.98, 9.90, 19.14, 28.09], s: [[55.43, 60.64, 9.14, 14.48], [69.22, 60.64, 9.14, 14.48], [83.02, 60.64, 9.22, 14.48]], v: { x: [16.1, 36.5], y: [63.9, 89.1] }, right: [56, 92] },
};
/** 오른쪽 면 세로 자리(%): 주인 이름 · 나라 도장 격자(독점 줄이 있으면 조금 아래) · 격자 가로(탭에 안 가리게 89% 까지) · 3줄 끝(안 테 위) · 독점 한 줄 */
export const RIGHT = { owner: 7, grid: [12, 54], gridMono: 16.5, gridX: [56, 89], linesEnd: 91.5, mono: 12.5 } as const;
/** 세운 닫힌 여권 3(시안: 오른쪽 아래 부채꼴로 크게, 화면 아래로 조금 나감): 높이 280(폭 = 그림 비율 ≈ 190), 가운데 x · 위 y · 회전(바닥 중앙) */
export const STAND_H = 280;
export const STAND_SLOTS = [{ cx: 945, top: 516, rot: -8 }, { cx: 1100, top: 528, rot: -1 }, { cx: 1243, top: 540, rot: 6 }] as const; // 펼친 여권 아래변(≈ 512~542)에 조금 걸침(시안)
export const STAND: Record<number, { a: number; w: Box }> = {
  1: { a: 0.7132, w: [34.02, 52.57, 35.05, 26.84] },
  2: { a: 0.6838, w: [31.18, 52.57, 39.78, 30.88] },
  3: { a: 0.6618, w: [32.22, 50.37, 38.33, 29.78] },
  4: { a: 0.6912, w: [34.04, 53.68, 35.11, 26.47] },
};
/** 책갈피 탭: '자세히 보기' = 펼친 여권 위변 22px 위에서 내려와 오른쪽 표지 끝에 걸림(도장 격자 오른끝 ≈ 1287 과 교차 0).
 *  '돌아가기' = 둘째 장 와이드 여권(33,64,1300,640) 오른쪽 위에 걸림. 높이 150, 폭 = 150 × 그림 비율 0.29 */
export const TAB = { x: 1300, dy: -22, w: 44, h: 150, back: { x: 1262, y: 42 } } as const;
/** U15 '처음으로' 책갈피(END-tab-home, 탭과 같은 크기·같은 높이): 여권 가운데 접힘(책등)에 걸린다 — 첫 장 = 펼친 여권 책등 x 1056
 *  (왼쪽 초상 틀 끝 ≈ 983 · 오른쪽 이름·도장 격자 시작 1091 사이), 둘째 장 = 와이드 여권 책등 x 683(왼쪽 표 끝 641 · 오른쪽 글 시작 725 사이 홈) */
export const HOME = { x: BOOK.x + BOOK.w / 2 - TAB.w / 2, y: BOOK.top + TAB.dy, back: { x: 33 + 1300 / 2 - TAB.w / 2, y: TAB.back.y } } as const;

/** 도장 안 나라 이름(2~4자 기준). 긴 이름은 흔히 쓰는 줄임으로 */
const SHORT: Record<string, string> = { sa: '사우디', cd: '콩고' };
export const stampName = (country: string, full: string) => SHORT[country] ?? full;
