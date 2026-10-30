import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vitest 는 .css?raw 를 빈 문자열로 준다 → 진짜 tokens.css 를 읽어 넣는다(@types/node 없음: 이름을 변수로 넘겨 any).
vi.mock('../../styles/tokens.css?raw', async () => {
  const fsName = 'node:fs';
  const fs = await import(/* @vite-ignore */ fsName);
  return { default: fs.readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8') };
});

import { BOARD } from '../../shared/board';
import type { ClientAct } from '../../shared/protocol';
import { hasAsset } from '../../assets/manifest';
import { BODY_BOTTOM_AT_BRIDGE, boxesHit, BRIDGES, CHAR, CORNER_FEET, CORNER_H, CORNER_HS, CORNER_PADS, cornerBoxes, HUD, hudBoxes, ISLAND_TOP, TILE_BOX, insetOf, PLAZA, PLAZA_ART, plateBox, plateSide, RING_TOP, SIGNPOSTS, STAGE, TILES, V_OVERLAP_MAX, type Box } from './geometry';
import { maxH, place, violations } from './layout';
import manifest from '../../../assets/manifest.json';
import { camShift, camTransform, worldCover, ZOOM } from './camera';
import { gaugeAt } from './DiceCup';
import { CROWD_CAP, crowdFrames, cuesFor, IDLE_MOTIONS, isTokenMotion, MOTIONS, poseKey } from '../characters/motions';
import { MotionScheduler } from '../characters/scheduler';

describe('칸 기하 R4·R5d·U5 (DESIGN §16.1·§16.2·§16.8·§16.9.1)', () => {
  it('11×6 둘레 30칸, 셀 중심 (62.09 + 124.18c, 109 + 110r), 칸 그림 상자 124 정사각, 원근 없음(배율 1), 고리 674 가 세로 가운데(하늘 띠 47)', () => {
    expect(TILES).toHaveLength(30);
    expect(CHAR).toEqual({ w: 32, h: 44 });
    expect(RING_TOP).toBe(47);
    const c = (i: number) => [Math.round(TILES[i].center.x), Math.round(TILES[i].center.y)];
    expect(c(0)).toEqual([62, 659]);
    expect(c(5)).toEqual([683, 659]);
    expect(c(10)).toEqual([1304, 659]);
    expect(c(12)).toEqual([1304, 439]);
    expect(c(15)).toEqual([1304, 109]);
    expect(c(19)).toEqual([807, 109]);
    expect(c(25)).toEqual([62, 109]);
    expect(c(28)).toEqual([62, 439]);
    for (const g of TILES) {
      expect(g.img.w).toBe(124);
      expect(g.img.h).toBe(124);
      expect(g.img.x).toBeCloseTo(g.center.x - 62, 6);
      expect(g.img.y).toBeCloseTo(g.center.y - 62, 6);
      expect(g.scale).toBe(1);
      expect(g.z).toBe(10 + 2 * g.row); // 아래 행이 앞
    }
    expect(Math.min(...TILES.map((g) => g.img.y))).toBe(47);
    expect(Math.max(...TILES.map((g) => g.img.y + g.img.h))).toBe(721);
  });
  it('시계 배치(PRD §4.1): 0 왼쪽 아래, 1~9 아랫줄 왼→오른, 11~14 오른쪽 열 아래→위, 16~24 윗줄 오른→왼, 26~29 왼쪽 열 위→아래', () => {
    for (let i = 1; i <= 10; i++) expect(TILES[i].center.x).toBeGreaterThan(TILES[i - 1].center.x);
    for (let i = 11; i <= 15; i++) expect(TILES[i].center.y).toBeLessThan(TILES[i - 1].center.y);
    for (let i = 16; i <= 25; i++) expect(TILES[i].center.x).toBeLessThan(TILES[i - 1].center.x);
    for (let i = 26; i <= 29; i++) expect(TILES[i].center.y).toBeGreaterThan(TILES[i - 1].center.y);
  });
  it('땅덩이 bbox(상자 4~96% × 0~97%) 교차: 같은 열 세로 이웃만 ≤ 10(위 칸 절벽 끝이 아래 칸 경관 뒤), 그 밖 0 — 가로 틈 ≈ 10', () => {
    for (let i = 0; i < 30; i++) for (let j = i + 1; j < 30; j++) {
      const a = TILES[i], b = TILES[j];
      const vNeighbor = a.col === b.col && Math.abs(a.row - b.row) === 1;
      if (!vNeighbor) { expect(boxesHit(a.land, b.land), `칸 ${i}·${j}`).toBe(false); continue; }
      const [up, down] = a.row < b.row ? [a, b] : [b, a];
      const over = up.land.y + up.land.h - down.land.y;
      expect(over, `세로 이웃 ${i}·${j}`).toBeGreaterThan(0);
      expect(over, `세로 이웃 ${i}·${j}`).toBeLessThanOrEqual(V_OVERLAP_MAX);
      expect(down.z, '아래 칸이 앞').toBeGreaterThan(up.z);
    }
    const gapX = TILES[1].land.x - (TILES[0].land.x + TILES[0].land.w);
    expect(gapX).toBeGreaterThan(9.5);
    expect(gapX).toBeLessThan(10.5);
    // 좌우 열 윗면 ↔ 아래 칸 윗면 세로 거리: 옛 61 → 43 (−30%, 사용자 피드백 8)
    const topBand = (TILES[11].img.y + ISLAND_TOP[0][1] * TILE_BOX) - (TILES[12].img.y + ISLAND_TOP[4][1] * TILE_BOX);
    expect(topBand).toBeCloseTo(110 - (0.62 - 0.08) * 124, 6);
    expect(topBand / (128 - (0.62 - 0.08) * 128)).toBeLessThan(0.75); // 58.9 → 43.0 (−27%, DESIGN 표의 61 → 43 은 윗면 67 기준 어림)
  });
  it('이름표 가림 0: 칸 그림 속 이름표 상자가 앞에 그려지는 칸 땅덩이·귀퉁이 캐릭터·HUD·이정표와 안 겹친다', () => {
    const fronts = (g: (typeof TILES)[number]): { id: string; box: Box }[] => [
      ...TILES.filter((o) => o.z > g.z).map((o) => ({ id: `칸${o.index}`, box: o.land })),
      ...cornerBoxes(), ...hudBoxes(),
      ...(['rules', 'save', 'timer'] as const).map((k) => ({ id: `${k}-rope`, box: { x: HUD[k].x - HUD[k].w / 2, y: HUD[k].y - HUD[k].h / 2 - HUD.rope, w: HUD[k].w, h: HUD.rope } })),
    ];
    const bad: string[] = [];
    for (const g of TILES) for (const f of fronts(g)) if (boxesHit(plateBox(g), f.box)) bad.push(`칸${g.index} 이름표·${f.id}`);
    expect(bad).toEqual([]);
  });
  it('30칸이 스테이지 안', () => {
    for (const g of TILES) {
      expect(g.img.x).toBeGreaterThanOrEqual(-1);
      expect(g.img.x + g.img.w).toBeLessThanOrEqual(STAGE.w + 3);
      expect(g.land.x).toBeGreaterThanOrEqual(0);
      expect(g.land.x + g.land.w).toBeLessThanOrEqual(STAGE.w);
      expect(g.img.y).toBeGreaterThanOrEqual(0);
      expect(g.img.y + g.img.h).toBeLessThanOrEqual(STAGE.h);
    }
  });
  it('30칸 전부 공터 중심(발 앵커)이 윗면 안쪽(가장자리에서 윗면 폭 10% 이상) — 셀 (cx, cy − 11.2), U5 실측 상자 41%', () => {
    for (const g of TILES) {
      expect(insetOf(g.top, g.anchor), `칸 ${g.index}`).toBeGreaterThan(0.1 * g.topW);
      expect(g.anchor.x).toBeCloseTo(g.center.x, 6);
      expect(g.center.y - g.anchor.y).toBeCloseTo(62 - 0.41 * 124, 6);
    }
  });
  it('이웃 칸 윗면이 겹치지 않는다(칸 틈에 설 자리가 없다)', () => {
    for (let i = 0; i < 30; i++) expect(insetOf(TILES[(i + 1) % 30].top, TILES[i].anchor)).toBeLessThan(0);
  });
  it('이름표 쪽: 30칸 전부 가운데(2026-10-27 좌우 열 가운데판 TILE-<n>e), 매니페스트도 e 그림', () => {
    expect(TILES.filter((g) => g.plate !== 'center').map((g) => g.index)).toEqual([]);
    for (const i of [11, 12, 13, 14, 26, 27, 28, 29]) expect((manifest.entries as Record<string, unknown>)[`tile.${i}`]).toBe(`webp/TILE-${i}e.webp`);
    expect(plateSide(0, 5)).toBe('center');
  });
});

describe('광장·이정표·다리·HUD 자리 (DESIGN §16.4·§16.9.2)', () => {
  it('광장 1080×390(U5) 이 고리 안쪽을 채우고 어떤 칸 땅덩이와도 안 겹친다(해자 ≥ 18), 중심 (683,384) 불변, 그림 상자 1120×402 = 1944×698 ÷ 1.7357', () => {
    expect(PLAZA).toEqual({ x: 143, y: 189, w: 1080, h: 390 });
    expect([PLAZA.x + PLAZA.w / 2, PLAZA.y + PLAZA.h / 2]).toEqual([683, 384]);
    expect(PLAZA_ART).toEqual({ x: 123, y: 183, w: 1120, h: 402 });
    expect(PLAZA_ART.w / PLAZA_ART.h).toBeCloseTo(1944 / 698, 2);
    for (const g of TILES) expect(boxesHit(PLAZA, g.land), `칸 ${g.index}`).toBe(false);
    for (const g of TILES) expect(boxesHit(PLAZA_ART, g.land), `광장 그림·칸 ${g.index}`).toBe(false);
    expect(PLAZA.x - (TILES[28].land.x + TILES[28].land.w)).toBeGreaterThanOrEqual(18);
    expect(PLAZA.y - (TILES[20].land.y + TILES[20].land.h)).toBeGreaterThanOrEqual(18);
    expect(TILES[5].land.y - (PLAZA.y + PLAZA.h)).toBeGreaterThanOrEqual(18);
  });
  it('귀퉁이 전신 캐릭터 4(U5 §16.9.2): 키 96, 발이 그림 속 돌 단 안, 몸 상자가 칸 땅덩이·HUD·이정표·서로와 교차 0, 패널은 바로 옆(틈 ≤ 6)', () => {
    expect(CORNER_H).toBe(96);
    expect(Math.max(...CORNER_HS)).toBe(CORNER_H);
    const bodies = cornerBoxes();
    expect(bodies).toHaveLength(4);
    CORNER_FEET.forEach((f, i) => {
      const p = CORNER_PADS[i];
      expect(Math.abs(f.x - p.c.x), `자리 ${i + 1} 발 x`).toBeLessThanOrEqual(p.w * 0.25);
      expect(Math.abs(f.y - p.c.y), `자리 ${i + 1} 발 y`).toBeLessThanOrEqual(p.h / 2);
      expect(bodies[i].box.w).toBeLessThanOrEqual(72);
      // 판 그림(광장) 안에 서 있다
      expect(boxesHit(bodies[i].box, PLAZA_ART)).toBe(true);
    });
    const bad: string[] = [];
    for (const b of bodies) {
      for (const o of hudBoxes()) if (boxesHit(b.box, o.box)) bad.push(`${b.id}·${o.id}`);
      for (const o of bodies) if (o !== b && boxesHit(b.box, o.box)) bad.push(`${b.id}·${o.id}`);
      for (const g of TILES) {
        if (boxesHit(b.box, plateBox(g))) bad.push(`${b.id}·칸${g.index} 이름표`);
        if (!boxesHit(b.box, g.land)) continue;
        // 위 귀퉁이 캐릭터 머리는 윗줄 칸 절벽 끝(땅덩이 bbox 아래 12% — 그림은 뾰족해 알파 16~32%) 앞까지만. 윗면·이름표와는 0, 캐릭터가 앞(z)
        const into = g.land.y + g.land.h - b.box.y;
        if (g.row !== 0 || into > 0.12 * TILE_BOX) bad.push(`${b.id}·칸${g.index} 땅덩이 ${into.toFixed(1)}px`);
      }
    }
    expect(bad).toEqual([]);
    hudBoxes().filter((h) => h.id.startsWith('panel')).forEach((pnl, i) => {
      const b = bodies[i].box, gap = Math.max(pnl.box.x - (b.x + b.w), b.x - (pnl.box.x + pnl.box.w));
      expect(gap, `패널 ${i + 1} ↔ 귀퉁이 캐릭터`).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(6);
      expect(pnl.box.w).toBe(200);
      expect(pnl.box.h).toBe(48);
    });
  });
  it('이정표 5: 판 96×28, 판 중심 = 발 − 40, 칸 땅덩이와 교차 0', () => {
    expect(SIGNPOSTS.map((s) => s.continent)).toEqual(['asia', 'europe', 'africa', 'namerica', 'samerica']);
    for (const s of SIGNPOSTS) {
      expect(s.board.w).toBeCloseTo(96, 0);
      expect(s.board.h).toBeCloseTo(27, 0);
      expect(s.foot.y - (s.board.y + s.board.h / 2)).toBeCloseTo(40, 0);
      for (const g of TILES) expect(boxesHit(s.board, g.land), `${s.continent}·칸 ${g.index}`).toBe(false);
      // 칸 그림 상자(투명 여백 포함 128)와도 안 겹친다 — 손 검산 여유 1~9px 를 시험으로 고정(§16.4)
      for (const g of TILES) expect(boxesHit(s.board, g.img), `${s.continent} 판·칸 ${g.index} 상자`).toBe(false);
      for (const c of cornerBoxes()) expect(boxesHit(s.img, c.box), `${s.continent} 이정표 그림·${c.id}`).toBe(false);
    }
  });
  it('HUD(패널 4·주사위·타이머)·이정표 판 상자는 서로 교차 0', () => {
    const b = hudBoxes();
    expect(b).toHaveLength(4 + 1 + 1 + 2 + 5);
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) expect(boxesHit(b[i].box, b[j].box), `${b[i].id}·${b[j].id}`).toBe(false);
  });
  it('다리 30: 이웃 칸 쌍마다 하나, 틈을 건너 양쪽 땅덩이에 6px 이상 걸친다', () => {
    expect(BRIDGES).toHaveLength(30);
    for (const br of BRIDGES) {
      expect(br.to).toBe((br.from + 1) % 30);
      const a = TILES[br.from].land, b = TILES[br.to].land, x = br.box;
      if (br.dir === 'h') {
        expect(a.x + a.w - x.x, `다리 ${br.from}`).toBeGreaterThanOrEqual(6);
        expect(x.x + x.w - b.x, `다리 ${br.from}`).toBeGreaterThanOrEqual(6);
      } else {
        // 땅덩이 bbox(상자 0~97%)는 다리 자리(상자 16%·84%)의 실제 절벽 끝(82%)보다 길어 허공에 뜬 다리도 통과시켰다(U5 피드백 7).
        // 실제 몸체로 잰다: 위 끝은 윗칸 절벽 끝보다 6px 이상 위, 아래 끝은 아랫칸 윗면 뒤 변보다 6px 이상 아래
        const [up, down] = TILES[br.from].row < TILES[br.to].row ? [TILES[br.from], TILES[br.to]] : [TILES[br.to], TILES[br.from]];
        expect(up.img.y + BODY_BOTTOM_AT_BRIDGE * TILE_BOX - x.y, `다리 ${br.from} 위 걸침`).toBeGreaterThanOrEqual(6);
        expect(x.y + x.h - (down.img.y + ISLAND_TOP[0][1] * TILE_BOX), `다리 ${br.from} 아래 걸침`).toBeGreaterThanOrEqual(6);
      }
    }
    expect(BRIDGES.filter((b) => b.dir === 'v').map((b) => b.from)).toEqual([10, 11, 12, 13, 14, 25, 26, 27, 28, 29]);
    // 층(z): 다리는 위 행 칸 바로 위 · 아래 행 칸 아래(세로 이웃이 겹치는 U5 판에서 아래 칸 경관 뒤로 숨는다)
    for (const br of BRIDGES) {
      const rows = [TILES[br.from].row, TILES[br.to].row];
      expect(br.z, `다리 ${br.from}`).toBe(10 + 2 * Math.min(...rows) + 1);
      if (br.dir === 'h') expect(br.box.w).toBe(26); // 가로 틈 10 + 양쪽 8
    }
  });
});

describe('캐릭터·건물 배치 (PRD §12.1)', () => {
  const buildable = (i: number) => hasAsset(`building.${i}.1`);
  it('30칸 × 1~4명 × 건물 유무 전수: 규칙 위반 0, 키 ≤ 44', () => {
    for (const g of TILES) for (let n = 1; n <= 4; n++) for (const b of buildable(g.index) ? [false, true] : [false]) {
      const p = place(g, n, b);
      expect(violations(g, p.feet, p.h, p.building), `칸 ${g.index} ${n}명 건물 ${b}`).toEqual([]);
      expect(p.h).toBeLessThanOrEqual(maxH(g));
    }
  });
  it('앞줄 같은 칸 4명도 36px 이상', () => {
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) expect(place(TILES[i], 4, false).h, `칸 ${i}`).toBeGreaterThanOrEqual(36);
  });
  it('혼자면 키 상한(토큰 44 × 칸 배율) 그대로, 중앙점에 선다', () => {
    for (const g of TILES) {
      const p = place(g, 1, buildable(g.index));
      expect(p.h).toBeGreaterThan(maxH(g) - 0.5);
      expect(Math.hypot(p.feet[0].x - g.anchor.x, p.feet[0].y - g.anchor.y)).toBeLessThanOrEqual(0.05 * g.topW);
    }
  });
  it('규칙 검사기가 위반을 잡는다(자기 검증)', () => {
    const g = TILES[5];
    expect(violations(g, [{ x: g.anchor.x + 0.42 * g.topW, y: g.anchor.y }], 44, null).join()).toMatch(/가장자리/);
    expect(violations(g, [g.anchor, { x: g.anchor.x + 3, y: g.anchor.y }], 44, null).join()).toMatch(/얼굴/);
  });
});

describe('모션 표', () => {
  it('트윈은 transform 만 쓴다(opacity 는 포즈 크로스페이드)', () => {
    for (const [id, m] of Object.entries(MOTIONS))
      for (const f of m.frames ?? []) expect(Object.keys(f).filter((k) => k !== 'offset' && k !== 'transform'), id).toEqual([]);
  });
  it('붐비는 칸: B·C 트윈의 위아래 움직임 ≤ 키의 3%, 기울기 ≤ 1°', () => {
    const dy = CROWD_CAP * CHAR.h;
    for (const [id, m] of Object.entries(MOTIONS)) {
      if (m.tier === 'A' || !m.frames) continue;
      for (const f of crowdFrames(m.frames)) {
        const t = String(f.transform);
        for (const [, v] of t.matchAll(/translateY\((-?[\d.]+)px\)/g)) expect(Math.abs(+v), id).toBeLessThanOrEqual(dy + 1e-9);
        for (const [, v] of t.matchAll(/scaleY?\(([\d.]+)\)/g)) expect(+v, id).toBeLessThanOrEqual(1 + CROWD_CAP + 1e-9);
        for (const [, v] of t.matchAll(/rotate\((-?[\d.]+)deg\)/g)) expect(Math.abs(+v), id).toBeLessThanOrEqual(1);
      }
    }
    expect(String(crowdFrames(MOTIONS.cheer.frames!)[1].transform)).toBe(`translateY(${-dy}px)`);
    expect(String(crowdFrames(MOTIONS.clap.frames!)[1].transform)).toBe('scaleX(0.94)'); // 옆 움직임은 그대로
  });
  it('모든 캐릭터(봇 포함)의 모션 포즈가 매니페스트에 있다', () => {
    for (let c = 1; c <= 7; c++) for (const m of Object.values(MOTIONS)) expect(hasAsset(`char.${c}.p${String(m.pose).padStart(2, '0')}`)).toBe(true);
  });
  it('매니페스트에 없는 포즈는 기본 포즈로 대체', () => {
    expect(poseKey(1, 99)).toBe('char.1.p01');
    expect(poseKey(7, 0)).toBe('char.7.p01');
    expect(poseKey(3, 12)).toBe('char.3.p12');
  });
  it('로그 → 반응 모션', () => {
    const seats = [0, 1, 2, 3] as const;
    const owners = BOARD.map(() => null as null | 0 | 1 | 2 | 3);
    owners[5] = 2;
    expect(cuesFor({ ev: 'toll', payer: 0, owner: 2, tile: 5, base: 100, multiplier: 1, discounted: false, paid: 100 }, [...seats], owners))
      .toEqual([{ seat: 0, motion: 'cry' }, { seat: 2, motion: 'smileCoin' }]);
    expect(cuesFor({ ev: 'build', seat: 1, tile: 5, level: 4, cost: 1 }, [...seats], owners).map((c) => c.motion)).toEqual(['hammer', 'clap', 'clap', 'clap']);
    expect(cuesFor({ ev: 'takeover', seat: 0, tile: 5, correct: true, shielded: true, cost: 1 }, [...seats], owners)).toEqual([{ seat: 2, motion: 'shrug' }]);
    expect(cuesFor({ ev: 'takeover', seat: 0, tile: 5, correct: true, shielded: false, cost: 1 }, [...seats], owners)).toEqual([{ seat: 2, motion: 'upset' }, { seat: 0, motion: 'flag' }]);
    expect(cuesFor({ ev: 'answer', seat: 3, qid: 'q', choice: 1, correct: false, ms: 1, isBot: true }, [...seats], owners)).toEqual([{ seat: 3, motion: 'scratch' }]);
  });
});

describe('주사위 게이지', () => {
  it('뗀 위치는 0~1 삼각파', () => {
    expect(gaugeAt(0)).toBe(0);
    expect(gaugeAt(300)).toBeCloseTo(0.5);
    expect(gaugeAt(600)).toBeCloseTo(1);
    expect(gaugeAt(1200)).toBeCloseTo(0);
    for (let ms = 0; ms < 10_000; ms += 37) { const g = gaugeAt(ms); expect(g).toBeGreaterThanOrEqual(0); expect(g).toBeLessThanOrEqual(1); }
  });
  it('클라이언트는 떼는 위치 필드 하나만 보낸다(편향은 서버 몫)', () => {
    const msg: Extract<ClientAct, { type: 'roll' }> = { type: 'roll', gauge: gaugeAt(450) };
    expect(Object.keys(msg)).toEqual(['type', 'gauge']);
  });
});

describe('대기 모션 스케줄러 (가짜 시계)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => vi.useRealTimers());

  it('간격은 5~10초 균일 추출(U5 귀퉁이 캐릭터, tokens --idle-interval-min/max)', async () => {
    const s = new MotionScheduler();
    const gaps = Array.from({ length: 4000 }, () => s.nextGap());
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(5000);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(10000);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(Math.abs(mean - 7500)).toBeLessThan(180);
    const q = gaps.filter((g) => g < 6250).length / gaps.length; // 첫 1/4 구간
    expect(Math.abs(q - 0.25)).toBeLessThan(0.04);
    const css = (await import('../../styles/tokens.css?raw')).default;
    expect([css.match(/--idle-interval-min:\s*(\d+)ms/)![1], css.match(/--idle-interval-max:\s*(\d+)ms/)![1]]).toEqual(['5000', '10000']);
  });

  it('말(maxIdle 0)은 대기 이모션이 없다, 행동 모션만(U5 §16.9.3)', () => {
    const s = new MotionScheduler({ rand: () => 0, maxIdle: 0 });
    s.add('a');
    vi.advanceTimersByTime(10 * 60_000);
    expect(s.get('a')).toBeNull();
    expect(s.trigger('a', 'hop')).toBe(true);
    expect(['hop', 'flag', 'hammer', 'drift', 'collapse'].every((m) => isTokenMotion(m as never))).toBe(true);
    for (const m of [...IDLE_MOTIONS, 'yawn', 'smileCoin', 'surprised', 'shrug', 'upset', 'clap', 'expect', 'cheer', 'scratch', 'coinFlip', 'cry'] as const) expect(isTokenMotion(m), m).toBe(false);
    expect(IDLE_MOTIONS).toContain('wave');
    expect(MOTIONS.wave).toMatchObject({ tier: 'A', pose: 5, ms: 1500, cycle: 750, iterations: 2 });
  });

  it('첫 모션 시각 = 5000 + r×5000', () => {
    const s = new MotionScheduler({ rand: () => 0.5 });
    s.add('a');
    vi.advanceTimersByTime(7_499);
    expect(s.get('a')).toBeNull();
    vi.advanceTimersByTime(1);
    expect(s.get('a')?.tier).toBe('A');
  });

  it('동시 재생 ≤ 2 (사람·봇 같은 규칙)', () => {
    let r = 0;
    const s = new MotionScheduler({ rand: () => ((r = (r * 9301 + 49297) % 233280) / 233280) });
    ['human0', 'bot1', 'human2', 'bot3'].forEach((id) => s.add(id));
    let max = 0;
    const played = new Set<string>();
    for (let t = 0; t < 10 * 60_000; t += 50) {
      vi.advanceTimersByTime(50);
      max = Math.max(max, s.idleCount());
      for (const id of ['human0', 'bot1', 'human2', 'bot3']) if (s.get(id)) played.add(id);
    }
    expect(max).toBe(2);
    expect(played.size).toBe(4);
  });

  it('모두 같은 때 깨어나도 2개만 돌고 나머지는 다시 뽑는다', () => {
    const s = new MotionScheduler({ rand: () => 0 });
    ['a', 'b', 'c', 'd'].forEach((id) => s.add(id));
    vi.advanceTimersByTime(5000);
    expect(s.idleCount()).toBe(2);
  });

  it('모달·탭 숨김이면 정지, 풀리면 다시', () => {
    const s = new MotionScheduler({ rand: () => 0 });
    s.add('a');
    vi.advanceTimersByTime(5000);
    expect(s.get('a')?.tier).toBe('A');
    s.setPaused(true);
    expect(s.get('a')).toBeNull();
    vi.advanceTimersByTime(120_000);
    expect(s.get('a')).toBeNull();
    s.setPaused(false);
    vi.advanceTimersByTime(5000);
    expect(s.get('a')?.tier).toBe('A');
  });

  it('우선순위 C > B > A 로 선점하고, 끝나면 기본 자세로 복귀', () => {
    const s = new MotionScheduler({ rand: () => 0 });
    s.add('a');
    vi.advanceTimersByTime(5000);
    expect(s.get('a')?.tier).toBe('A');
    expect(s.trigger('a', 'smileCoin')).toBe(true); // B 가 A 선점
    expect(s.get('a')?.motion).toBe('smileCoin');
    expect(s.trigger('a', 'cheer')).toBe(true); // C 가 B 선점
    expect(s.trigger('a', 'clap')).toBe(false); // B 는 C 를 못 끊는다
    expect(s.get('a')?.motion).toBe('cheer');
    vi.advanceTimersByTime(MOTIONS.cheer.ms);
    expect(s.get('a')).toBeNull(); // 기본 자세
    vi.advanceTimersByTime(5000);
    expect(s.get('a')?.tier).toBe('A'); // 대기 모션 재개
  });

  it('B·C 는 일시 정지 중에도 돈다(A 만 정지)', () => {
    const s = new MotionScheduler({ rand: () => 0 });
    s.add('a');
    s.setPaused(true);
    expect(s.trigger('a', 'cheer')).toBe(true);
  });

  it('하품은 90초 넘게 내 턴이 없을 때만', () => {
    const s = new MotionScheduler({ rand: () => 0.99 }); // 풀의 마지막 = 하품(있을 때)
    s.add('a');
    vi.advanceTimersByTime(15_000);
    expect(s.get('a')?.motion).not.toBe('yawn');
    for (let i = 0; i < 12; i++) vi.advanceTimersByTime(15_000);
    expect(['yawn', null]).toContain(s.get('a')?.motion ?? null);
    vi.advanceTimersByTime(30_000);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) { vi.advanceTimersByTime(100); const m = s.get('a')?.motion; if (m) seen.add(m); }
    expect(seen.has('yawn')).toBe(true);
    s.markTurn('a');
    seen.clear();
    for (let i = 0; i < 800; i++) { vi.advanceTimersByTime(100); const m = s.get('a')?.motion; if (m) seen.add(m); }
    expect(seen.has('yawn')).toBe(false);
  });

  it('무인도 표류 중엔 A 없음, 표류가 기본 자세', () => {
    const s = new MotionScheduler({ rand: () => 0 });
    s.add('a');
    s.setDrifting('a', true);
    vi.advanceTimersByTime(60_000);
    expect(s.get('a')?.motion).toBe('drift');
    s.trigger('a', 'cheer');
    vi.advanceTimersByTime(MOTIONS.cheer.ms);
    expect(s.get('a')?.motion).toBe('drift');
    s.setDrifting('a', false);
    expect(s.get('a')).toBeNull();
  });

  it('파산: 쓰러짐 2초 → 회색, 그 뒤 모션 없음', () => {
    const s = new MotionScheduler({ rand: () => 0 });
    s.add('bot');
    s.setBankrupt('bot');
    expect(s.get('bot')?.motion).toBe('collapse');
    expect(s.isGrey('bot')).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(s.get('bot')).toBeNull();
    expect(s.isGrey('bot')).toBe(true);
    expect(s.trigger('bot', 'cheer')).toBe(false);
    vi.advanceTimersByTime(10 * 60_000);
    expect(s.get('bot')).toBeNull();
  });
});

describe('줌 카메라(PRD §12.4, DESIGN §16.6)', () => {
  it('배율·시간은 shared/timing 한 곳: 1.8, in 400 · hold 300 · out 600 · 홉 320, tokens.css 사본도 같은 값', async () => {
    expect(ZOOM).toEqual({ scale: 1.8, inMs: 400, holdMs: 300, outMs: 600, hopMs: 320 });
    const css = (await import('../../styles/tokens.css?raw')).default;
    const v = (n: string) => Number(css.match(new RegExp(`--${n}:\\s*([\\d.]+)`))![1]);
    expect([v('board-zoom'), v('board-zoom-in'), v('board-zoom-hold'), v('board-zoom-out'), v('board-zoom-hop')]).toEqual([ZOOM.scale, ZOOM.inMs, ZOOM.holdMs, ZOOM.outMs, ZOOM.hopMs]);
  });
  it('클램프: tx ∈ [1366(1−s), 0], ty ∈ [768(1−s), 0] — 모든 칸(가장자리 0·10·15·25 포함)에서 world 가 스테이지를 다 덮는다', () => {
    for (const g of TILES) {
      const { tx, ty } = camShift(ZOOM.scale, g.anchor);
      expect(tx).toBeGreaterThanOrEqual(STAGE.w * (1 - ZOOM.scale) - 1e-9);
      expect(tx).toBeLessThanOrEqual(0);
      expect(ty).toBeGreaterThanOrEqual(STAGE.h * (1 - ZOOM.scale) - 1e-9);
      expect(ty).toBeLessThanOrEqual(0);
      const c = worldCover(ZOOM.scale, g.anchor);
      expect(c.left).toBeLessThanOrEqual(0);
      expect(c.top).toBeLessThanOrEqual(0);
      expect(c.right).toBeGreaterThanOrEqual(STAGE.w - 1e-9);
      expect(c.bottom).toBeGreaterThanOrEqual(STAGE.h - 1e-9);
    }
    // 모서리 4칸은 두 축 모두 끝에 붙는다
    expect(camShift(1.8, TILES[0].anchor)).toEqual({ tx: 0, ty: STAGE.h * (1 - 1.8) });
    expect(camShift(1.8, TILES[10].anchor)).toEqual({ tx: STAGE.w * (1 - 1.8), ty: STAGE.h * (1 - 1.8) });
    expect(camShift(1.8, TILES[15].anchor)).toEqual({ tx: STAGE.w * (1 - 1.8), ty: 0 });
    expect(camShift(1.8, TILES[25].anchor)).toEqual({ tx: 0, ty: 0 });
  });
  it('클램프 안쪽 축은 초점이 화면 가운데(683, 384)', () => {
    const f = TILES[5].anchor; // 아랫줄 가운데: x 는 가운데, y 는 아래 끝 클램프
    const { tx } = camShift(1.8, f);
    expect(f.x * 1.8 + tx).toBeCloseTo(STAGE.w / 2, 6);
    const g = TILES[27].anchor; // 왼쪽 열 가운데쯤: y 는 가운데
    const { ty } = camShift(1.8, g);
    expect(g.y * 1.8 + ty).toBeCloseTo(STAGE.h / 2, 6);
  });
  it('배율 1 이면 이동 0(복귀), 변환 문자열은 translate → scale 순서', () => {
    expect(camShift(1, TILES[12].anchor)).toEqual({ tx: 0, ty: 0 });
    expect(camTransform(1.8, TILES[25].anchor)).toBe('translate(0px, 0px) scale(1.8)');
    expect(camTransform(1.8, TILES[27].anchor)).toMatch(/^translate\(0px, -?\d+px\) scale\(1\.8\)$/);
  });
});

// ── U8(DESIGN §17): 주사위 B 타임라인 · 땅 표시 C2 ──
import { DICE } from '../../shared/timing';
import { bouncePath, CUP, CUP_BOX, rollTimes } from './dice-show';
import { FLAG_CLOTH, flagClip, OWN, ownGeo, PLATE_TRUE, SCENERY_BOTTOM } from './own-geo';
import { spriteBox } from './layout';

describe('귀퉁이 캐릭터 = 원판 중심(U8-impl 사용자 피드백)', () => {
  it('발 = 원판 윗면 중심(PLAZA-U5 실측) ±4px, 남쪽으로 내려가지 않는다 · 위 단 키 75 / 아래 단 96', () => {
    const MEASURED = [[270, 229], [1099, 229], [210, 451], [1151, 451]]; // 돌판 윗면 타원 중심(스테이지 px)
    CORNER_FEET.forEach((f, i) => {
      expect(Math.abs(f.x - MEASURED[i][0]), `자리 ${i + 1} x`).toBeLessThanOrEqual(4);
      expect(Math.abs(f.y - MEASURED[i][1]), `자리 ${i + 1} y`).toBeLessThanOrEqual(4);
      expect(f.y, `자리 ${i + 1} 남쪽 아님`).toBeLessThanOrEqual(CORNER_PADS[i].c.y);
    });
    expect(CORNER_HS).toEqual([75, 75, 96, 96]);
  });
});

describe('주사위 B 나무 컵(§17.1)', () => {
  it('타임라인: 뗌 t0 → 멈춤 +780 · 합 팝 +930 · 더블 칩 +1100 · 이동 +1830, 서버 눈이 늦으면 그 순간 멈추고 나머지 같은 간격', () => {
    expect(rollTimes({ t0: 1000, gotAt: undefined, reduced: false })).toBeNull(); // 눈 없이는 멈추지 않는다
    expect(rollTimes({ t0: 1000, gotAt: 1040, reduced: false })).toEqual({ stop: 1780, pop: 1930, chip: 2100, end: 2830 });
    expect(rollTimes({ t0: 1000, gotAt: 2000, reduced: false })).toEqual({ stop: 2000, pop: 2150, chip: 2320, end: 3050 });
    expect(rollTimes({ t0: 1000, gotAt: 1040, reduced: true })!.end).toBe(1040 + DICE.reduced); // 움직임 줄임 900
    expect(DICE.total - DICE.popAt).toBe(900);
  });
  it('HUD 상자 (583,282) 200×166 안: 쟁반 200×96 중심 (683,400) · 주사위 60 중심 (655,418)·(723,418) · 합 (689,352) · 칩 (745,322)', () => {
    expect(CUP_BOX).toEqual({ x: 583, y: 282, w: 200, h: 166 });
    const abs = (p: { x: number; y: number }) => [p.x + CUP_BOX.x, p.y + CUP_BOX.y];
    expect(abs({ x: CUP.tray.x + CUP.tray.w / 2, y: CUP.tray.y + CUP.tray.h / 2 })).toEqual([683, 400]);
    expect(CUP.dice.map(abs)).toEqual([[655, 418], [723, 418]]);
    expect(abs(CUP.sum)).toEqual([689, 352]);
    expect(abs(CUP.chip)).toEqual([745, 322]);
    for (const d of CUP.dice) { expect(d.x - CUP.die / 2).toBeGreaterThanOrEqual(0); expect(d.y + CUP.die / 2).toBeLessThanOrEqual(CUP_BOX.h); }
    expect(CUP.tray.y + CUP.tray.h).toBeLessThanOrEqual(CUP_BOX.h);
    expect(CUP_BOX.y).toBeGreaterThan(HUD.timer.y + HUD.timer.h / 2 + 10); // 간판 아랫변 257 과 틈
  });
  it('튕김 경로: 컵 입 → 자리, 두 번 튕기고(정점 2) 끝은 바로 선 면(회전 360 배수)·제자리', () => {
    const k = bouncePath(CUP.mouth, CUP.dice[0], 720);
    expect(k.at(-1)!.transform).toBe('translate(0px, 0px) rotate(720deg) scale(1)');
    expect(k[0].transform).toContain(`translate(${CUP.mouth.x - CUP.dice[0].x}px, ${CUP.mouth.y - CUP.dice[0].y}px)`);
    expect(k.map((f) => f.offset)).toEqual([0, 0.22, 0.5, 0.75, 1]);
  });
});

describe('땅 표시 C2 — 앞 모서리 발코니(§17.2·§17.2.1)', () => {
  const all = (f: (g: (typeof TILES)[number], seat: number, level: number) => void) => {
    for (const g of TILES) for (let seat = 0; seat < 4; seat++) for (let level = 0; level <= 4; level++) f(g, seat, level);
  };
  it('깃발 길이 = 단계(1~4: 24·32·40·48, 땅만 0 = 24 — 수정 1회차 시안 무게), 4단계만 금별, 0단계엔 발코니·건물 없음', () => {
    expect([0, 1, 2, 3, 4].map((l) => ownGeo(TILES[1], 0, l).flagLen)).toEqual([24, 24, 32, 40, 48]);
    expect(ownGeo(TILES[1], 0, 3).star).toBeNull();
    expect(ownGeo(TILES[1], 0, 4).star).not.toBeNull();
    expect(ownGeo(TILES[1], 0, 0).building).toBeNull();
    expect(flagClip(48)).toBe('none');
    expect(flagClip(24)).toBe('polygon(0 0, 100% 0, 100% 50.00%, 50% 42.00%, 0 50.00%)');
  });
  it('천 폭 16(자리마다 그림 비율 보정), 천의 절반은 칸 땅덩이 오른쪽 끝(상자 96%) 밖, 가로 틈(이웃 칸 땅덩이) 침범 0', () => {
    all((g, seat) => {
      const f = ownGeo(g, seat, 4).flag;
      const cloth = f.w * FLAG_CLOTH[seat];
      expect(cloth).toBeCloseTo(16, 6);
      const mid = f.x + f.w / 2;
      expect(mid + cloth / 2, `칸 ${g.index} 깃발이 스테이지 안`).toBeLessThanOrEqual(STAGE.w);
      if (g.col === 10) { // 오른쪽 끝 열: 왼쪽(광장 쪽) 바깥으로 거울
        expect(mid).toBeLessThanOrEqual(g.land.x + 0.5);
        return;
      }
      const edge = g.land.x + g.land.w; // 천 가운데 ≈ 땅덩이 오른쪽 끝(천 절반은 칸 밖)
      expect(mid).toBeGreaterThanOrEqual(edge - 0.5);
      expect(mid).toBeLessThanOrEqual(edge + 3);
      const right = TILES.find((o) => o.row === g.row && o.col === g.col + 1);
      if (right) expect(mid + cloth / 2).toBeLessThan(right.land.x);
    });
  });
  it('윗면 가운데 비움 · 위로 솟는 물체 0(위 칸 이름표 가림 0) · 건물 = 풍경 밖(y ≥ 79) · 아래 칸 상자 침범 0', () => {
    all((g, seat, level) => {
      const o = ownGeo(g, seat, level);
      const boxes = [...o.pennants, o.flag, ...(o.star ? [o.star] : []), ...(o.balcony ? [o.balcony] : []), ...(o.building ? [o.building] : [])];
      for (const b of boxes) expect(b.y, `칸 ${g.index}`).toBeGreaterThanOrEqual(g.img.y);
      for (const p of o.posts) expect(p.y0).toBeGreaterThanOrEqual(g.img.y);
      if (o.building) {
        expect(o.building.y - g.img.y).toBeGreaterThanOrEqual(SCENERY_BOTTOM + 2); // 건물 풍경 가림 0(흰 스티커 테 1px + 여유)
        expect(o.building.w).toBeLessThanOrEqual(22);
        expect(o.balcony!.y + o.balcony!.h - g.img.y).toBeLessThanOrEqual(110); // 아래 칸 상자 윗변(열 피치 110)
      }
      // 공터(말 자리, 지름 29 가운데) 위에 아무것도 없다
      const clear = { x: g.anchor.x - 15, y: g.anchor.y - 15, w: 30, h: 30 };
      for (const b of boxes) expect(boxesHit(b, clear), `칸 ${g.index} 공터`).toBe(false);
    });
  });
  it('이름표(실측 x 26~98 · y 83~105)·말(1~4명) 가림 0', () => {
    all((g, seat, level) => {
      const o = ownGeo(g, seat, level);
      const plate = { x: g.img.x + PLATE_TRUE.x, y: g.img.y + PLATE_TRUE.y, w: PLATE_TRUE.w, h: PLATE_TRUE.h };
      const front = [...(o.balcony ? [o.balcony] : []), ...(o.building ? [o.building] : [])];
      for (const b of front) expect(boxesHit(b, plate), `칸 ${g.index} 이름표`).toBe(false);
      for (let n = 1; n <= 4; n++) {
        const p = place(g, n, false);
        for (const f of p.feet) for (const b of [...front, o.flag]) {
          const body = spriteBox(f, p.h);
          // 깃발 그림 상자는 천보다 넓다(막대) — 천 기둥만 잰다
          const bb = b === o.flag ? { x: b.x + b.w / 2 - 6, y: b.y, w: 12, h: o.flagLen } : b;
          expect(boxesHit(body, bb), `칸 ${g.index} ${n}명`).toBe(false);
        }
      }
    });
  });
  it('기둥·밧줄·삼각기 7: 뒤 두 모서리(x 9·115, y 1~28), 삼각기는 밧줄에 매달림', () => {
    const g = TILES[3], o = ownGeo(g, 1, 2);
    expect(o.posts.map((p) => p.x - g.img.x)).toEqual([9, 115]);
    expect(o.pennants).toHaveLength(OWN.pennants);
    for (const p of o.pennants) { expect(p.y - g.img.y).toBeGreaterThanOrEqual(2); expect(p.y + p.h - g.img.y).toBeLessThanOrEqual(23); }
  });
});
