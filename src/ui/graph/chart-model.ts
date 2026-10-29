// 기후 그래프 좌표 계산(순수 함수). 막대 = 강수량(mm), 선 = 기온(℃), 가로축 1~12월.
// 눈금은 도시와 관계없이 하나로 고정한다(도시끼리 나란히 놓고 키를 비교할 수 있게).
import type { City } from './climate-data';

export const TEMP_AXIS = { min: -20, max: 30, step: 10 } as const;
export const PRECIP_AXIS = { min: 0, max: 500, step: 100 } as const; // 눈금 5칸이 기온 눈금과 같은 줄
export const LEGEND = { bar: '강수량(mm)', line: '기온(℃)' } as const;

export const W = 320;
export const H = 220;
const M = { l: 40, r: 40, t: 14, b: 26 };
/** 칸 폭에 맞춰 그릴 때(viewBox = 화면 px, 글자 13px 그대로): 눈금 글자 폭만큼만 둔다 */
const M_FIT = { l: 28, r: 30, t: 14, b: 26 };
/** 가로축 월 글자(13px "10")가 겹치지 않는 한 달 폭. 이보다 좁으면 홀수 달만 쓴다 */
export const MIN_MONTH_PX = 17;
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface ChartModel {
  title: string;
  plot: { x: number; y: number; w: number; h: number };
  bars: { x: number; y: number; w: number; h: number }[];
  line: string;
  dots: { x: number; y: number }[];
  xLabels: { x: number; text: string }[];
  /** 수치 없는 모양 비교 모드에서는 빈 배열 */
  leftTicks: { y: number; text: string }[];
  rightTicks: { y: number; text: string }[];
}

/** size 를 주면 그 크기(화면 px)를 viewBox 로 쓴다 — 확대·축소 없이 글자가 CSS 크기 그대로 보인다 */
export function chartModel(city: City, showValues: boolean, size?: { w: number; h: number }): ChartModel {
  const m = size ? M_FIT : M;
  const cw = size?.w ?? W, ch = size?.h ?? H;
  const plot = { x: m.l, y: m.t, w: cw - m.l - m.r, h: ch - m.t - m.b };
  const yOf = (v: number, a: { min: number; max: number }) => r1(plot.y + plot.h * (1 - (v - a.min) / (a.max - a.min)));
  const slot = plot.w / 12;
  const bw = r1(slot * 0.6);
  const xs = city.temp.map((_, i) => r1(plot.x + slot * (i + 0.5)));
  const base = plot.y + plot.h;
  const bars = city.precip.map((mm, i) => {
    const y = yOf(Math.min(mm, PRECIP_AXIS.max), PRECIP_AXIS);
    return { x: r1(xs[i] - bw / 2), y, w: bw, h: r1(base - y) };
  });
  const dots = city.temp.map((t, i) => ({ x: xs[i], y: yOf(t, TEMP_AXIS) }));
  const ticks = (a: { min: number; max: number; step: number }, axis: typeof a) => {
    const out: { y: number; text: string }[] = [];
    for (let v = a.min; v <= a.max; v += a.step) out.push({ y: yOf(v, axis), text: String(v) });
    return out;
  };
  return {
    title: city.name,
    plot,
    bars,
    line: dots.map((d, i) => `${i ? 'L' : 'M'}${d.x} ${d.y}`).join(''),
    dots,
    xLabels: xs.flatMap((x, i) => (slot >= MIN_MONTH_PX || i % 2 === 0 ? [{ x, text: String(i + 1) }] : [])),
    leftTicks: showValues ? ticks(TEMP_AXIS, TEMP_AXIS) : [],
    rightTicks: showValues ? ticks(PRECIP_AXIS, PRECIP_AXIS) : [],
  };
}
