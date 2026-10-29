// 30칸 고리 보드 (PRD §4.1, 2026-10-26 판 재설계). 옛 40칸 표 폐기.
// 번호는 왼쪽 아래 모서리(출발·한국)에서 시계 방향: 아랫줄 0~10, 오른쪽 열 11~15, 윗줄 16~25, 왼쪽 열 26~29.
import type { CultureCountryId } from './content-types';

export type Continent = 'asia' | 'europe' | 'africa' | 'namerica' | 'samerica';
export type TileKind =
  | 'start' | 'country' | 'tourist' | 'mission' | 'island' | 'festival' | 'travel' | 'antarctic';

export interface Tile {
  index: number;
  kind: TileKind;
  name: string;
  country?: CultureCountryId;
  continent?: Continent | 'oceania';
  price?: number;
  /** 관광지 고정 통행료 */
  tollFixed?: number;
}

const c = (name: string, country: CultureCountryId, continent: Continent, price: number) =>
  ({ kind: 'country', name, country, continent, price }) as const;
const k = (kind: TileKind, name: string) => ({ kind, name }) as const;

const DEFS: Omit<Tile, 'index'>[] = [
  { kind: 'start', name: '출발·한국', country: 'kr' }, // 0 탐험형: 소유·건설·통행료 없이 문화 카드 → 문항 → 해설 → 참/거짓 (§3.6)
  c('필리핀', 'ph', 'asia', 200),
  c('타이', 'th', 'asia', 230),
  c('중국', 'cn', 'asia', 270),
  c('네팔', 'np', 'asia', 300),
  c('사우디아라비아', 'sa', 'asia', 340), // 5
  k('mission', '미션'),
  { kind: 'tourist', name: '호주', country: 'au', continent: 'oceania', price: 500, tollFixed: 300 },
  k('antarctic', '남극'),
  k('festival', '세계 축제'),
  k('island', '무인도'), // 10
  c('이탈리아', 'it', 'europe', 370),
  c('프랑스', 'fr', 'europe', 410),
  c('스위스', 'ch', 'europe', 440),
  c('노르웨이', 'no', 'europe', 480),
  c('러시아', 'ru', 'europe', 510), // 15
  c('이집트', 'eg', 'africa', 550),
  c('에티오피아', 'et', 'africa', 580),
  c('탄자니아', 'tz', 'africa', 620),
  c('콩고민주공화국', 'cd', 'africa', 650),
  k('mission', '미션'), // 20
  c('그린란드', 'gl', 'namerica', 690),
  c('캐나다', 'ca', 'namerica', 720),
  c('미국', 'us', 'namerica', 760),
  c('멕시코', 'mx', 'namerica', 790),
  k('travel', '세계여행'), // 25
  c('에콰도르', 'ec', 'samerica', 830),
  c('브라질', 'br', 'samerica', 860),
  c('아르헨티나', 'ar', 'samerica', 900),
  c('칠레', 'cl', 'samerica', 930),
];

export const BOARD: readonly Tile[] = DEFS.map((t, index) => ({ ...t, index }));
export const BOARD_SIZE = BOARD.length;

/** 나라 이름으로 보일 때: 출발 칸은 「출발·한국」이 아니라 「한국」(문항·해설 머리, 도장, 기후 묶음) */
export const countryLabel = (t: Tile) => (t.kind === 'start' ? '한국' : t.name);
/** 나라 코드 → 나라 이름(남극 포함) */
export const countryNameOf = (c: string) => {
  if (c === 'aq') return '남극';
  const t = BOARD.find((b) => b.country === c);
  return t ? countryLabel(t) : c;
};
export const START_TILE = 0;
export const MISSION_TILES = [6, 20];
export const TOURIST_TILES = [7];
export const ANTARCTIC_TILE = 8;
export const FESTIVAL_TILE = 9;
export const ISLAND_TILE = 10;
export const TRAVEL_TILE = 25;
export const CONTINENTS: readonly Continent[] = ['asia', 'europe', 'africa', 'namerica', 'samerica'];

/** 대륙 독점 대상 칸(여행지만 — 한국·호주 제외) */
export const continentTiles = (cont: Continent) =>
  BOARD.filter((t) => t.kind === 'country' && t.continent === cont).map((t) => t.index);

/** 4칸 대륙(아프리카·북아메리카·남아메리카)은 독점에 건물 1개 이상이 더 필요하다 — PRD §3.7 ㉒(S2 시뮬: 칸 수 차이로 독점 ×4.1 쏠림, 2026-10-27) */
export const MONOPOLY_BUILDING_TILES = 4;
export const monopolyNeedsBuilding = (cont: Continent) => continentTiles(cont).length === MONOPOLY_BUILDING_TILES;
