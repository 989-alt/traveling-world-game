import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetWarned, _setHiTier, _setPcTier, assetUrl, boardKeys, deviceNeed, HI_NEED, hiFile, bootKeys, fallbackOf, gameStartKeys, hasAsset, isLazy, tileLazyKeys, warnOnce } from './manifest';
import { preload } from './preload';
import manifest from '../../assets/manifest.json';

beforeEach(() => _resetWarned());

describe('매니페스트 조회', () => {
  it('키 -> URL, 모르는 키는 null + 경고 1회', () => {
    const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(assetUrl('tile.1')).toMatch(/webp\/TILE-01d\.webp$/);
    expect(assetUrl('tile.mission')).toBeNull();
    expect(assetUrl('tile.mission')).toBeNull();
    expect(w).toHaveBeenCalledTimes(1);
    w.mockRestore();
  });
  it('미션 칸 6·20 은 공용 칸 그림 한 장(TILE-Md), 30칸 전부 키가 있다(R4 A4)', () => {
    expect(assetUrl('tile.6')).toBe(assetUrl('tile.20'));
    expect(assetUrl('tile.6')).toMatch(/TILE-Md\.webp$/);
    for (let n = 0; n < 30; n++) expect(hasAsset(`tile.${n}`), `tile.${n}`).toBe(true);
    expect(hasAsset('tile.30')).toBe(false);
    expect(hasAsset('tile.center')).toBe(false);
  });
  it('칸별 그림 키는 30칸 번호(옛 40칸 번호 아님): 3 = 중국, 16 = 이집트, 0 = 한국 문화 카드', () => {
    expect(assetUrl('culture.3')).toMatch(/CC-06\.webp$/);
    expect(assetUrl('building.16.1')).toMatch(/BLD-22-1\.webp$/);
    expect(assetUrl('landmark.19')).toMatch(/LM-17\.webp$/);
    expect(assetUrl('culture.0')).toMatch(/CC-08\.webp$/);
    for (const k of ['building.20.1', 'landmark.6', 'culture.6', 'building.0.1', 'building.8.1', 'cutscene.0']) expect(hasAsset(k), k).toBe(false);
    expect(fallbackOf('card.cn-2')).toBe('culture.3');
  });
  it('fallback: 카드는 culture 로, 배지는 none -> undefined', () => {
    expect(fallbackOf('card.ph-2')).toBe('culture.1');
    expect(fallbackOf('badge.1')).toBeUndefined();
  });
  it('첫 로드 세트에 컷씬·카드·고해상·BGM 이 없다', () => {
    const boot = bootKeys();
    expect(boot.some(isLazy)).toBe(false);
    expect(boot).not.toContain('tile.1'); // 판 그림은 첫 로드 뒤(boardKeys)
    expect(boardKeys()).toEqual(expect.arrayContaining(['tile.0', 'tile.29', 'plaza', 'plaza.mask.asia', 'ui.signpost']));
    expect(boardKeys()).toHaveLength(30 + 1 + 5 + 1);
    expect(boot).toContain('char.1.p01');
    expect(boot).not.toContain('cutscene.1');
  });
  it('도착 칸 사전 로드 키: 카드·컷씬·고해상 랜드마크, 없는 키는 걸러짐', () => {
    expect(tileLazyKeys(1)).toEqual(expect.arrayContaining(['culture.1', 'cutscene.1', 'landmark.1.big', 'badge.1']));
    expect(tileLazyKeys(6)).toEqual([]); // 미션 칸
    expect(hasAsset('cutscene.6')).toBe(false);
  });
});

describe('preload', () => {
  const mk = (fail: (u: string) => boolean) => {
    const urls: string[] = [];
    class I {
      onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(u: string) { urls.push(u); queueMicrotask(() => (fail(u) ? this.onerror : this.onload)?.()); }
    }
    return { I: I as never, urls };
  };
  it('성공한 키는 한 번만 요청하고, 실패는 reject 없이 false + 경고 1회(재시도는 다시 요청)', async () => {
    const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { I, urls } = mk(u => u.includes('CUT-01'));
    const a = await preload(['cutscene.1', 'culture.1'], I);
    const b = await preload(['cutscene.1', 'culture.1'], I);
    expect(a).toEqual([false, true]); expect(b).toEqual([false, true]);
    expect(urls).toHaveLength(3); // culture.1 은 캐시, cutscene.1 은 실패라 재요청
    expect(w).toHaveBeenCalledTimes(1);
    w.mockRestore();
  });
});

describe('warnOnce', () => {
  it('키당 1회', () => {
    const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warnOnce('x', 'a'); warnOnce('x', 'b'); warnOnce('y', 'a');
    expect(w).toHaveBeenCalledTimes(2);
    w.mockRestore();
  });
});


describe('preload 재시도', () => {
  it('실패한 키는 캐시에서 지워 다시 요청할 수 있다', async () => {
    const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let fail = true; let n = 0;
    class I {
      onload: (() => void) | null = null; onerror: (() => void) | null = null;
      set src(_u: string) { n++; queueMicrotask(() => (fail ? this.onerror : this.onload)?.()); }
    }
    expect(await preload(['culture.2'], I as never)).toEqual([false]);
    fail = false;
    expect(await preload(['culture.2'], I as never)).toEqual([true]);
    expect(n).toBe(2);
    w.mockRestore();
  });
});

describe('세로 안내 그림(U4)', () => {
  it('세로판은 첫 로드, 가로판은 매니페스트에 있되 첫 로드 세트 밖(움직임 허용일 때만 app 이 붙인다)', () => {
    expect(bootKeys()).toContain('ui.rotate');
    expect(hasAsset('ui.rotate-wide')).toBe(true);
    expect(assetUrl('ui.rotate-wide')).toMatch(/webp\/UI-rotate-wide\.webp$/);
    expect(bootKeys()).not.toContain('ui.rotate-wide');
  });
});

describe('캐릭터·카드 키', () => {
  it('P01·F00 만 첫 로드, 나머지 포즈는 게임 시작 키', () => {
    expect(bootKeys()).toContain('char.3.f00');
    expect(bootKeys()).not.toContain('char.3.p05');
    expect(gameStartKeys()).toContain('char.3.p05');
    expect(gameStartKeys()).not.toContain('char.3.p01');
    expect(gameStartKeys().every(k => !k.endsWith('.big'))).toBe(true);
  });
  it('카드 키는 content id: card.th-2 / card.aq-s1, fallback 있음', () => {
    expect(hasAsset('card.th-2')).toBe(true);
    expect(fallbackOf('card.th-2')).toBe('culture.2');
    expect(fallbackOf('card.aq-s1')).toBe('event.antarctic');
    expect(hasAsset('card.2.l2')).toBe(false);
  });

  it('이벤트 카드 그림: 한국 탐험·독점도 있는 그림으로(새 그림 없이 한국 문화 카드·축제 그림을 다시 씀)', () => {
    for (const k of ['event.korea', 'event.monopoly', 'event.antarctic', 'event.travel', 'event.festival', 'event.fund', 'event.island']) expect(hasAsset(k), k).toBe(true);
    expect(manifest.entries['event.korea']).toBe(manifest.entries['culture.0']);
  });
});

describe('콘텐츠 그림 참조 <-> 매니페스트 키', () => {
  it('cards L2+ image/image2, missions mp_ 사진은 전부 키가 있다 (그래프 *_graph·mi_·mg_ 는 코드 렌더라 제외)', async () => {
    const cards = (await import('../data/cards.json')).default as { id: string; level: number; image?: string; image2?: string }[];
    const missions = JSON.stringify((await import('../data/missions.json')).default);
    const code = (f: string) => /graph|^mi_|^mg_/.test(f);
    const missing: string[] = [];
    for (const c of cards.filter(x => x.level > 1)) {
      if (c.image && !code(c.image) && !hasAsset(`card.${c.id}`)) missing.push(`card.${c.id}`);
      if (c.image2 && !code(c.image2) && !hasAsset(`card.${c.id}.b`)) missing.push(`card.${c.id}.b`);
    }
    for (const m of missions.matchAll(/"(mp_\w+)\.png"/g)) if (!hasAsset(`mission.${m[1]}`)) missing.push(`mission.${m[1]}`);
    expect(missing).toEqual([]);
    expect(isLazy('mission.mp_alps') && isLazy('card.th-2.b') && isLazy('badge.it')).toBe(true);
  });
});

describe('U9 고해상 단계(hi)', () => {
  it('기기 필요 배율: 1366×768·dpr1 = 1(기본), 1920×1080 = 1.406(hi), 4K@2 = 2.81, 휴대폰은 0', () => {
    expect(deviceNeed(1366, 768, 1)).toBe(1);
    expect(deviceNeed(1920, 1080, 1)).toBeCloseTo(1.406, 3);
    expect(deviceNeed(1920, 1080, 2)).toBeCloseTo(2.811, 3);
    expect(deviceNeed(768, 1366, 1)).toBe(1); // 세로로 들어도 같음
    expect(deviceNeed(844, 390, 3)).toBe(0);
    expect(deviceNeed(1366, 768, 1) > HI_NEED).toBe(false);
    expect(deviceNeed(1920, 1080, 1) > HI_NEED).toBe(true);
  });
  it('hi 켜면 hi 목록 파일만 webp/hi/ 로, base 는 늘 기본, 끄면 그대로', () => {
    _setHiTier(true);
    _setPcTier(true);
    try {
      expect(assetUrl('tile.1')).toMatch(/webp\/hi\/TILE-01d\.webp$/);
      expect(assetUrl('plaza')).toMatch(/webp\/hi\/PLAZA-U5\.webp$/);
      expect(assetUrl('dice.burst')).toMatch(/webp\/hi\/DICE-sum-burst\.webp$/); // U8
      expect(assetUrl('dice.face.3')).toMatch(/webp\/DICE-top-3\.webp$/); // 기본으로 충분(169/256)
      _setPcTier(false); // 광장 2880 은 PC 만(U9 후속) — 태블릿 hi 는 광장·마스크만 기본
      expect(assetUrl('plaza')).toMatch(/webp\/PLAZA-U5\.webp$/);
      expect(assetUrl('plaza.mask.asia')).toMatch(/webp\/PLAZA-U5-mask-asia\.webp$/);
      expect(assetUrl('tile.1')).toMatch(/webp\/hi\/TILE-01d\.webp$/);
      expect(assetUrl('char.1.p12.big', true)).toMatch(/webp\/CH1-P12@1024\.webp$/);
      expect(assetUrl('char.1.f00')).toMatch(/webp\/CH1-F00\.webp$/); // hi 없음 → 기본
    } finally { _setHiTier(false); _setPcTier(null); }
    expect(assetUrl('tile.1')).toMatch(/webp\/TILE-01d\.webp$/);
    expect(hiFile('webp/X.webp')).toBe('webp/hi/X.webp');
  });
  it('hi 목록은 매니페스트 항목 파일만', () => {
    const files = new Set(Object.values(manifest.entries).map((e) => (typeof e === 'string' ? e : e.file)));
    expect((manifest as { hi: string[] }).hi.filter((f) => !files.has(f))).toEqual([]);
  });
});
