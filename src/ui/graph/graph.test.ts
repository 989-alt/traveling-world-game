import { describe, expect, it } from 'vitest';
import missions from '../../data/missions.json';
import { CITIES, GRAPH_OF_IMAGE } from './climate-data';
import { chartModel, LEGEND } from './chart-model';

describe('기후 그래프 데이터', () => {
  it('9개 도시, 12개월 값, 기온·강수량이 말이 되는 범위', () => {
    const keys = Object.keys(CITIES);
    expect(keys).toHaveLength(9);
    for (const c of Object.values(CITIES)) {
      expect(c.temp).toHaveLength(12);
      expect(c.precip).toHaveLength(12);
      expect(c.temp.every((t) => t > -20 && t < 30)).toBe(true);
      expect(c.precip.every((p) => p >= 0 && p <= 500)).toBe(true);
    }
  });
  it('그래프 미션 8개가 전부 도시로 이어진다', () => {
    const g = (missions as { id: string; type: string; image?: string }[]).filter((m) => m.type === 'graph');
    expect(g).toHaveLength(8);
    for (const m of g) expect(GRAPH_OF_IMAGE[m.image!], m.id).toBeTruthy();
  });
});

describe('chartModel', () => {
  it('범례 문구 고정', () => expect(LEGEND).toEqual({ bar: '강수량(mm)', line: '기온(℃)' }));
  it('서울 스냅샷(막대=강수량, 선=기온, 1~12월)', () => {
    const m = chartModel(CITIES.seoul, true);
    expect(m.xLabels.map((x) => x.text)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    expect(m).toMatchSnapshot();
  });
  it('모양 비교 모드는 눈금 숫자가 없고 모양(좌표)은 같다', () => {
    const v = chartModel(CITIES.oslo, true);
    const s = chartModel(CITIES.oslo, false);
    expect(s.leftTicks).toEqual([]);
    expect(s.rightTicks).toEqual([]);
    expect({ ...s, leftTicks: v.leftTicks, rightTicks: v.rightTicks }).toEqual(v);
  });
  it('눈금이 고정이라 건조한 카이로 막대는 낮고 서울 7월 막대는 높다', () => {
    const cairo = chartModel(CITIES.cairo, true).bars.map((b) => b.h);
    const seoul = chartModel(CITIES.seoul, true).bars.map((b) => b.h);
    expect(Math.max(...cairo)).toBeLessThan(5);
    expect(seoul[6]).toBeGreaterThan(Math.max(...cairo) * 20);
  });
  it('기온선: 더 더운 달이 더 위(y 작음)', () => {
    const m = chartModel(CITIES.seoul, true);
    expect(m.dots[7].y).toBeLessThan(m.dots[0].y);
  });
});
