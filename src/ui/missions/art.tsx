// 미션 항목 그림(R4-TF2 수정 1, v3 04·05): 글자뿐인 연결·블록 항목도 그림 카드로 보이게 한다.
// 항목 이름 → 이미 있는 그림(문화 카드·해설 카드·미션 사진·이벤트) → 없으면 큰 아이콘 + 색 판.
// 이름은 화면에 이미 보이는 글자라 비밀이 아니다. 짝(정답)은 여기 없다 — 짝끼리 같은 그림을 쓰지 않는다.
import { useState } from 'preact/hooks';
import { assetUrl, hasAsset } from '../../assets/manifest';
import { BOARD } from '../../shared/board';

const culture = (name: string) => { const t = BOARD.find((b) => b.name === name); return t ? `culture.${t.index}` : undefined; };

/** 이름 → 매니페스트 키(사람이 고른 것).
 * 짝 규칙(R4-final-fix): 왼쪽(조건·장소)은 결과를 그리지 않은 그림이나 아이콘, 오른쪽은 그 결과 그림.
 * 한 짝의 양쪽이 같은 나라·같은 장면 그림을 쓰지 않는다(art.test 가 나라 접두·파일 장면까지 본다).
 * U1(2026-10-28): 짝 때문에 옛 그림을 못 쓰던 38항목은 전용 그림 카드 mc.*(짝이 그린 것을 뺀 장면, reports/U1-mission-art-map.md).
 * 이제 그림 카드 자리(연결 양쪽·블록 왼쪽 조각)에 아이콘으로 떨어지는 항목은 없다 — 아이콘은 그림을 못 불러올 때만. */
const KEY: Record<string, string | undefined> = {
  '아름다운 경관': 'mission.mp_roraima', 관광업: 'card.ar-4', '넓고 평평한 고원': 'card.et-4', 목축업: 'card.sa-4.b',
  광업: 'card.cl-2', '경사진 땅': 'mission.mp_everest', '계단식 농사': 'card.ph-2',
  '넓게 펼쳐진 갯벌': 'mission.mp_korea_mudflat', 염전: 'card.fr-2', '배가 드나들기 좋은 해안': 'mission.mp_sognefjord', 항구: 'card.fr-4.b',
  '경관이 아름다운 해안': 'mission.mp_benagil', 관광지: 'card.ph-3',
  '적도 부근': culture('에콰도르'), 극지방: 'event.antarctic', '기온이 높아요': 'event.climate.heat', '기온이 낮아요': 'event.climate.blizzard',
  열대: culture('브라질'), 건조: 'mission.mp_sahara', 한대: 'card.aq-s1',
  '열대 기후': culture('브라질'), '건조 기후': 'mission.mp_sahara', '온대 기후': culture('이탈리아'), '냉대 기후': 'card.ru-2', '한대 기후': 'card.aq-s1',
  '바닥을 띄운 고상 가옥': 'mission.mp_stilt_house', '창이 작은 흙벽돌 집': 'mission.mp_mud_house', 통나무집: 'mission.mp_log_house',
  '사우디아라비아의 긴 옷': 'card.sa-2', '캐나다의 털옷': 'mission.mp_fur_coat',
  '센강 변에서 햇볕 쬐기': 'card.fr-3',
  '통발 어업': 'card.cd-3', '대규모 농사': 'card.us-4', '수력 발전': 'card.no-3', '수상 시장': 'card.th-2',
  오스트레일리아: culture('호주'),
  // U1 전용 그림 카드
  '풍부한 지하자원': 'mc.ore',
  저위도: 'mc.low-lat', 고위도: 'mc.high-lat',
  '햇볕이 수직에 가까워요': 'mc.sun-high', '햇볕이 비스듬해요': 'mc.sun-low',
  냉대: 'mc.taiga', 얼음집: 'mc.igloo',
  '페루의 망토와 모자': 'mc.poncho', '햇볕과 모래바람을 막아요': 'mc.sandstorm',
  '낮밤 기온 차에 맞춰요': 'mc.day-night', '긴 겨울 추위를 막아 줘요': 'mc.deep-winter',
  핀란드: 'mc.finland', 에스파냐: 'mc.spain', '프랑스 파리': 'mc.paris',
  '빙판 위 운전면허 시험': 'mc.ice-driving', '한낮의 낮잠 시에스타': 'mc.siesta',
  '콩고강의 급류': 'mc.rapids', '일리노이강의 평야': 'mc.plain-river',
  '노르웨이의 하천': 'mc.steep-river', 짜오프라야강: 'mc.chaophraya',
  아시아: 'mc.asia', 아프리카: 'mc.africa', 남아메리카: 'mc.samerica',
  북아메리카: 'mc.namerica', '남극 대륙': 'mc.antarctica',
  태평양: 'mc.pacific', 대서양: 'mc.atlantic', 인도양: 'mc.indian', 북극해: 'mc.arctic',
  '지도 속 그린란드': 'mc.map-greenland', '실제 그린란드': 'mc.globe-greenland', '실제 러시아': 'mc.globe-russia',
  키토: 'mc.quito', 쿠스코: 'mc.cusco', 아디스아바바: 'mc.addis', 멕시코시티: 'mc.mexico-city',
  뉴질랜드: 'mc.newzealand', 니우에: 'mc.niue',
};

/** 그림을 못 불러올 때 아이콘(이름에 든 낱말로) — 로드 실패 대체 전용 */
const ICON: [RegExp, string][] = [
  // 짝 왼쪽 아이콘(R4-final-fix): 결과를 암시하지 않는 지형·기후만
  [/지하자원/, '💎'], [/^냉대$/, '❄️'], [/파리/, '🗼'], [/급류/, '💦'], [/평야/, '🏞️'], [/하천/, '⛰️'], [/짜오프라야/, '🌴'],
  [/모래바람/, '🌪️'], [/겨울 추위/, '🥶'],
  // 대륙·대양: 지도에 그린 랜드마크와 겹치지 않는 동물·물건으로(그림만 보고 짝이 드러나지 않게)
  [/^아시아$/, '🐼'], [/^아프리카$/, '🦁'], [/^유럽$/, '🏰'], [/^북아메리카$/, '🦅'], [/^남아메리카$/, '🦙'], [/남극/, '🐧'], [/오세아니아/, '🦘'], // 남아메리카 🦜 는 브라질 문화 카드(앵무새)와 겹쳐 🦙
  [/태평양/, '🐋'], [/대서양/, '🐬'], [/인도양/, '🐠'], [/북극해/, '🧊'], [/양$|해$/, '🌊'], [/햇볕이 수직/, '☀️'], [/햇볕이 비스듬/, '🌅'], [/저위도/, '🌴'], [/고위도/, '🏔️'],
  [/낮밤|기온 차/, '🌗'], [/페루|망토/, '🦙'], [/빙판|운전/, '🚗'], [/핀란드/, '❄️'], [/에스파냐/, '💃'], [/낮잠|시에스타/, '😴'],
  [/얼음집/, '🧊'], [/키토|쿠스코|아디스아바바|시티|도시/, '🏙️'], [/뉴질랜드/, '🥝'], [/섬/, '🏝️'], [/^실제 /, '🌍'], [/지도/, '🗺️'], [/크게|작아요|분의/, '📏'], // 면적 비교(m-13): 왼쪽(지도·실제)과 오른쪽(크기 말)이 다른 아이콘
  [/쓰레기|오염/, '🗑️'], [/관광|등산객/, '🎒'], [/일자리|수입|소득/, '💰'], [/농사|곡식/, '🌾'], [/빙하|피오르/, '🏔️'],
  [/강|흙|모래/, '🏞️'], [/나무|풀/, '🌳'], [/불|태워|재/, '🔥'], [/기온|℃/, '🌡️'], [/기후/, '🌦️'], [/나라/, '🏳️'],
];

export interface Art { key?: string; icon: string; tone: number }

export function artOf(label: string): Art {
  const k = KEY[label] ?? culture(label);
  const icon = ICON.find(([re]) => re.test(label))?.[1] ?? '🧭';
  let h = 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { key: k && hasAsset(k) ? k : undefined, icon, tone: h % 6 };
}

/** 항목 그림: 그림이 있으면 그림, 없거나 못 불러오면 색 판 위 큰 아이콘 */
export function LabelArt({ label, class: cls }: { label: string; class?: string }) {
  const a = artOf(label);
  const [bad, setBad] = useState(false);
  const url = a.key ? assetUrl(a.key) : null;
  if (url && !bad) return <span class={`la la--img ${cls ?? ''}`}><img src={url} alt="" decoding="async" draggable={false} onError={() => setBad(true)} /></span>;
  return <span class={`la la--icon ${cls ?? ''}`} data-tone={a.tone} aria-hidden="true"><i>{a.icon}</i></span>;
}
