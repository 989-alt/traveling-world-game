// 지도 위 자리 표시. 지도 파일에는 글자가 없어서, 어느 이름이 어디인지는 여기서만 정한다(위경도 → 지도 % 좌표).
export const spotPct = (lon: number, lat: number) => ({ x: ((lon + 180) / 360) * 100, y: ((90 - lat) / 180) * 100 });

/** 블록 이름 → 지도에서 그 이름이 가리키는 곳. 서버·시험 하네스만 쓴다(번들에 실리면 m-09·m-10 짝이 드러남) */
export const SPOT_OF: Record<string, [number, number]> = {
  아시아: [95, 45], 아프리카: [20, 5], 유럽: [15, 52], 북아메리카: [-100, 45], 남아메리카: [-60, -12], 오세아니아: [135, -25], '남극 대륙': [20, -80],
  태평양: [-150, 5], 대서양: [-30, 15], 인도양: [80, -25], 북극해: [0, 78], 남극해: [0, -64],
};

export type MapMode = 'spots' | 'zones' | 'plain';
/** 활동 그림 이름 → 지도 모양. 이 목록에 없으면 지도를 쓰지 않는다 */
export const MAP_OF_IMAGE: Record<string, MapMode> = {
  'mi_continents.png': 'spots',
  'mi_oceans.png': 'spots',
  'mi_climate_zones.png': 'zones',
  'mi_true_size.png': 'plain',
};

/** 기후 칸 이름 → 지도 구역 색(missions.css .z-*). 서버·시험 하네스만 쓴다: 화면은 서버가 보낸 zones 로 칠한다.
 *  블록 이름(열대 기후 등) 키는 두지 않는다 — 같은 값으로 이어져 m-11 짝이 드러나므로 */
export const ZONE_OF_LABEL: Record<string, string> = {
  '적도 부근': 'tropical',
  '비가 적은 저·중위도': 'dry',
  '북반구 중·고위도': 'cold',
  '극지방 부근': 'polar',
};
