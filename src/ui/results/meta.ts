// 여행지 메타(기후·마그넷·지도 핀). 콘텐츠에 이 필드가 아직 없어서 여기서 채운다.
// 마그넷 글(해설 카드 정답 줄)은 번들에 없다: 서버가 정지·끝 때 보내는 카드(state.cards)로 metaWith 가 채운다.
import { countryNameOf } from '../../shared/board';
import type { PublicCard } from '../../shared/protocol';
import type { MetaMap } from '../../engine/report';
import { spotPct } from '../missions/map-spots';

/** [경도, 위도]. 지도 파일이 위경도 그대로(등장방형)라 % 로 바꿔 쓴다 */
const LL: Record<string, [number, number]> = {
  ph: [121, 16], th: [101, 15], sa: [45, 24], np: [84, 28], cn: [104, 35], kr: [128, 36], it: [12.5, 42], fr: [2, 46.5], ch: [8, 46.8],
  no: [9, 61], ru: [60, 58], cd: [24, -2], tz: [35, -6], et: [39, 9], eg: [30, 27], mx: [-102, 23], us: [-98, 39],
  ca: [-106, 56], gl: [-42, 72], ec: [-78, -1.5], br: [-52, -10], cl: [-71, -33], ar: [-64, -35], aq: [0, -80],
};
// 해설 카드 문구에 나온 기후만 적는다. 문구에 없는 나라(네팔·스위스·칠레·남극)는 비워 둔다.
const CLIMATE: Record<string, string> = {
  ph: '열대', th: '열대', cd: '열대', tz: '열대', br: '열대',
  sa: '건조', eg: '건조',
  cn: '온대', kr: '온대', it: '온대', fr: '온대', us: '온대', ar: '온대',
  no: '냉대', ru: '냉대', ca: '냉대',
  gl: '한대',
  et: '고산', mx: '고산', ec: '고산',
};

export const countryName = countryNameOf;

/** 기후·핀만(마그넷 없음) */
export const META: MetaMap = Object.fromEntries(Object.entries(LL).map(([c, [lon, lat]]) => [c, {
  climate: CLIMATE[c] ? `${CLIMATE[c]} 기후` : undefined,
  pin: spotPct(lon, lat),
}]));

/** 서버가 보낸 카드로 마그넷을 채운 메타. 마그넷 칸: 1단계 해설 = 지형, 2단계 = 경관, 3단계 = 생활. 카드가 하나도 없는 나라는 마그넷 없음 */
export function metaWith(cards: PublicCard[]): MetaMap {
  const L = new Map(cards.map((c) => [`${c.country}-${c.level}`, c.answer]));
  return Object.fromEntries(Object.entries(META).map(([c, m]) => {
    const has = [1, 2, 3].some((lv) => L.has(`${c}-${lv}`));
    return [c, has ? { ...m, magnet: { terrain: L.get(`${c}-1`) ?? '', scenery: L.get(`${c}-2`) ?? '', life: L.get(`${c}-3`) ?? '' } } : m];
  }));
}
