// 기후 그래프 데이터: 월평균 기온(℃)·월 강수량(mm), 1월→12월. 1991~2020 평년값.
export interface City {
  name: string;
  temp: number[];
  precip: number[];
}

export const CITIES = {
  kualalumpur: { name: '쿠알라룸푸르', temp: [27.3, 27.8, 28.1, 28.1, 28.5, 28.4, 28, 28, 27.7, 27.5, 27.1, 27.1], precip: [226.7, 192.8, 270.4, 301.5, 229.9, 145.8, 165.2, 174.3, 220.3, 283.8, 355.8, 280.6] },
  mwanza: { name: '므완자', temp: [22.8, 23.3, 23.2, 23.1, 23.2, 22.7, 22.2, 22.6, 23.4, 23.4, 22.9, 22.8], precip: [113.7, 82, 154.5, 173, 70.3, 25.7, 5, 23.7, 42.3, 120.6, 158.3, 146] },
  cairo: { name: '카이로', temp: [14.4, 15.6, 18.3, 21.8, 25.6, 28.2, 29.1, 29.2, 27.6, 24.6, 20, 15.9], precip: [4.8, 3.8, 6.3, 1.3, 0.2, 0, 0, 0, 0, 0.7, 4.3, 3.4] },
  london: { name: '런던', temp: [5.6, 5.8, 7.9, 10.5, 13.7, 16.8, 19, 18.7, 15.9, 12.3, 8.4, 5.9], precip: [58.8, 45, 38.8, 42.3, 45.9, 47.3, 45.8, 52.8, 49.6, 65.1, 66.6, 57.1] },
  rome: { name: '로마', temp: [7.9, 8.6, 11.2, 14.2, 18.7, 23.1, 26, 26.1, 21.9, 17.4, 12.4, 8.7], precip: [65.6, 62.8, 58.6, 68.6, 56.9, 30.1, 19.8, 30.2, 64.9, 88.1, 108.2, 98.3] },
  seoul: { name: '서울', temp: [-2, 0.7, 6.1, 12.6, 18.2, 22.7, 25.3, 26.1, 21.7, 15, 7.5, 0.2], precip: [16.8, 28.2, 36.9, 72.9, 103.6, 129.5, 414.4, 348.2, 141.5, 52.2, 51.1, 22.6] },
  oslo: { name: '오슬로', temp: [-2.3, -1.9, 1.3, 6.2, 11.4, 15.3, 17.6, 16.5, 12.1, 6.5, 2.1, -1.4], precip: [57.9, 44.6, 41.4, 48.3, 60.1, 79.7, 86.7, 102.7, 82.2, 93.4, 84.6, 53.6] },
  nuuk: { name: '누크', temp: [-7.5, -8.6, -7.7, -3, 1.2, 5, 7.4, 7, 4, 0.2, -3.3, -5.5], precip: [67.1, 51.1, 58.9, 53.3, 57.4, 61.7, 69.3, 90.8, 104.6, 80.5, 79, 74.5] },
  quito: { name: '키토', temp: [13.9, 13.9, 14.1, 14.1, 14.2, 14.2, 14.3, 14.5, 14.5, 14.2, 13.8, 13.9], precip: [81.3, 109.1, 142.4, 168.2, 120.5, 41.3, 22, 31.5, 69.4, 112.1, 108.5, 93.6] },
} satisfies Record<string, City>;

export type CityKey = keyof typeof CITIES;

/** missions.json 의 그래프 미션 image(mg_*.png) → 그릴 도시들. 그림 파일은 안 쓰고 데이터로 그린다 */
export const GRAPH_OF_IMAGE: Record<string, CityKey[]> = {
  'mg_kualalumpur.png': ['kualalumpur'],
  'mg_kl_mwanza.png': ['kualalumpur', 'mwanza'],
  'mg_london_rome_seoul.png': ['london', 'rome', 'seoul'],
  'mg_cairo.png': ['cairo'],
  'mg_oslo.png': ['oslo'],
  'mg_nuuk_oslo.png': ['nuuk', 'oslo'],
  'mg_quito_kl.png': ['quito', 'kualalumpur'],
  'mg_seoul.png': ['seoul'],
};

/** 카드 그림 중 기후 그래프는 그림 파일 대신 데이터로 그린다(해설 카드·문항 자료) */
export const GRAPH_OF_CARD: Record<string, CityKey[]> = {
  'ec_kl_graph.png': ['kualalumpur'], 'ec_quito_graph.png': ['quito'], 'eg_cairo_graph.png': ['cairo'],
  'gl_nuuk_graph.png': ['nuuk'], 'gl_oslo_graph.png': ['oslo'], 'it_rome_graph.png': ['rome'],
  'kr_graph_london_rome.png': ['london', 'rome'], 'kr_graph_seoul.png': ['seoul'], 'no_oslo_graph.png': ['oslo'],
  'tz_graph_kl.png': ['kualalumpur'], 'tz_graph_mwanza.png': ['mwanza'], 'tz_mwanza_graph.png': ['mwanza'],
};
