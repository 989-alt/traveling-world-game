// @ts-nocheck -- node 전용 테스트(@types/node 없음, 의존성 추가 금지). check-assets.mjs 를 자식 프로세스로 돌린다.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assetUrl, bootKeys } from "./manifest";

describe('check-assets 스크립트', () => {
  const script = join(__dirname, '../../scripts/check-assets.mjs');
  // 최소 VP8X WebP 헤더(치수만 읽는다)
  const webp = (w: number, h: number, pad = 0) => {
    const b = Buffer.alloc(30 + pad);
    b.write('RIFF', 0); b.writeUInt32LE(b.length - 8, 4); b.write('WEBPVP8X', 8);
    b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
    return b;
  };
  const run = (entries: object, files: Record<string, Buffer>, hi?: string[]) => {
    const root = mkdtempSync(join(tmpdir(), 'ca-'));
    mkdirSync(join(root, 'webp/hi'), { recursive: true });
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: 1, entries, ...(hi ? { hi } : {}) }));
    for (const [f, b] of Object.entries(files)) writeFileSync(join(root, f), b);
    return spawnSync('node', [script], { env: { ...process.env, ASSETS_ROOT: root }, encoding: 'utf8' });
  };
  it('정상 -> exit 0', () => {
    const r = run({ 'building.1.1': 'webp/a.webp', 'tile.1': 'webp/t.webp' }, { 'webp/a.webp': webp(256, 256), 'webp/t.webp': webp(512, 512) });
    expect(r.status).toBe(0);
  });
  it('U9 hi: 칸은 hi 필수·하한 627·기본보다 큼·비율 같음·상한 2048', () => {
    const base = { 'webp/t.webp': webp(512, 512) };
    expect(run({ 'tile.1': 'webp/t.webp' }, { ...base, 'webp/hi/t.webp': webp(640, 640) }, ['webp/t.webp']).status).toBe(0);
    expect(run({ 'tile.1': 'webp/t.webp' }, base, []).stderr).toContain('고해상(hi) 없음: tile.1');
    expect(run({ 'tile.1': 'webp/t.webp' }, base, ['webp/t.webp']).stderr).toContain('hi 누락');
    expect(run({ 'tile.1': 'webp/t.webp' }, { ...base, 'webp/hi/t.webp': webp(600, 600) }, ['webp/t.webp']).stderr).toContain('고해상 하한 627');
    expect(run({ 'tile.1': 'webp/t.webp' }, { ...base, 'webp/hi/t.webp': webp(640, 500) }, ['webp/t.webp']).stderr).toContain('hi 비율 다름');
    expect(run({ 'building.1.1': 'webp/a.webp' }, { 'webp/a.webp': webp(256, 256), 'webp/hi/a.webp': webp(4096, 4096) }, ['webp/a.webp']).stderr).toContain('상한 2048');
    expect(run({ 'building.1.1': 'webp/a.webp' }, { 'webp/a.webp': webp(256, 256), 'webp/hi/a.webp': webp(256, 256) }, ['webp/a.webp']).stderr).toContain('기본보다 크지 않음');
  });
  it('U9 후속: 광장 hi 만 긴 변 2880 까지(하한 2833), 다른 그림은 2048', () => {
    const plaza = (w: number, h: number) => run({ plaza: 'webp/p.webp' }, { 'webp/p.webp': webp(1944, 698), 'webp/hi/p.webp': webp(w, h) }, ['webp/p.webp']);
    expect(plaza(2880, 1034).status).toBe(0);
    expect(plaza(2048, 735).stderr).toContain('고해상 하한 2833');
    expect(plaza(3000, 1077).stderr).toContain('상한 2880');
    expect(run({ 'tile.1': 'webp/t.webp' }, { 'webp/t.webp': webp(512, 512), 'webp/hi/t.webp': webp(2880, 2880) }, ['webp/t.webp']).stderr).toContain('상한 2048');
  });
  it('U8 주사위·땅 표시 규격: 컵 512 · 눈 256 · 깃발 256 · 삼각기/발코니 128', () => {
    expect(run({ 'dice.cup.pour': 'webp/c.webp', 'dice.face.6': 'webp/d.webp', 'own.flag.2': 'webp/f.webp', 'own.balcony.4': 'webp/b.webp' },
      { 'webp/c.webp': webp(512, 512), 'webp/d.webp': webp(256, 256), 'webp/f.webp': webp(256, 256), 'webp/b.webp': webp(128, 128) }).status).toBe(0);
    expect(run({ 'dice.face.1': 'webp/d.webp' }, { 'webp/d.webp': webp(128, 128) }).stderr).toContain('필요 256x256');
    expect(run({ 'own.pennant.1': 'webp/p.webp' }, { 'webp/p.webp': webp(64, 64) }).stderr).toContain('필요 128x128');
  });
  it('필수 누락 -> 목록 + exit 1', () => {
    const r = run({ 'tile.1': 'webp/a.webp' }, {});
    expect(r.status).toBe(1); expect(r.stderr).toContain('누락(필수): tile.1');
  });
  it('optional 은 fallback 있으면 통과, 없으면 실패', () => {
    expect(run({ 'badge.1': { file: 'webp/b.webp', optional: true, fallback: 'none' } }, {}).status).toBe(0);
    expect(run({ 'badge.1': { file: 'webp/b.webp', optional: true } }, {}).status).toBe(1);
  });
  it('치수 초과·600KB 초과·WebP 아님 -> 실패', () => {
    expect(run({ 'building.1.1': 'webp/a.webp' }, { 'webp/a.webp': webp(600, 600) }).stderr).toContain('상한 512');
    expect(run({ 'tile.1': 'webp/a.webp' }, { 'webp/a.webp': webp(256, 256) }).stderr).toContain('필요 512x512'); // R5d 칸 512
    expect(run({ 'plaza': 'webp/a.webp' }, { 'webp/a.webp': webp(1536, 686) }).stderr).toContain('줌 하한 1944'); // 줌 1.8 규칙
    expect(run({ 'building.1.1': 'webp/a.webp' }, { 'webp/a.webp': webp(48, 48) }).stderr).toContain('줌 하한 65');
    expect(run({ 'char.1.p01': 'webp/a.webp' }, { 'webp/a.webp': webp(512, 512) }).status).toBe(1);
    expect(run({ 'culture.1': 'webp/a.webp' }, { 'webp/a.webp': webp(1440, 500) }).stderr).toContain('필요 1440x576');
    expect(run({ 'building.1.1': 'webp/a.webp' }, { 'webp/a.webp': webp(256, 256, 601 * 1024) }).stderr).toContain('600KB 초과');
    expect(run({ 'building.1.1': 'webp/a.webp' }, { 'webp/a.webp': Buffer.alloc(64) }).stderr).toContain('WebP 아님');
  });
  it('실제 에셋 전체가 통과', () => {
    expect(() => execFileSync('node', [script], { stdio: 'pipe' })).not.toThrow();
  });
  it('fallback 순환 -> 실패', () => {
    const o = (fallback) => ({ file: 'webp/x.webp', optional: true, fallback });
    const r = run({ 'card.a-2': o('card.b-2'), 'card.b-2': o('card.a-2') }, {});
    expect(r.status).toBe(1); expect(r.stderr).toContain('fallback 순환');
  });
  it('mp3: 0바이트·엉뚱한 바이트 -> 실패, ID3/프레임 헤더 -> 통과', () => {
    const e = { 'bgm.x': 'audio/x.mp3' };
    const go = (b) => { const root = mkdtempSync(join(tmpdir(), 'ca-')); mkdirSync(join(root, 'webp')); mkdirSync(join(root, 'audio'));
      writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: 1, entries: e })); writeFileSync(join(root, 'audio/x.mp3'), b);
      return spawnSync('node', [script], { env: { ...process.env, ASSETS_ROOT: root }, encoding: 'utf8' }).status; };
    expect(go(Buffer.alloc(0))).toBe(1);
    expect(go(Buffer.from('hello'))).toBe(1);
    expect(go(Buffer.from('ID3\x04\x00', 'latin1'))).toBe(0);
    expect(go(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe(0);
  });
});

describe('첫 로드 이미지 예산 (PRD §11 ≤ 3MB)', () => {
  it('bootKeys 파일 크기 합 ≤ 3MB', () => {
    let sum = 0;
    for (const k of bootKeys()) sum += statSync(join(__dirname, '../../assets', assetUrl(k).replace(/^\//, ''))).size;
    console.log('boot bytes', sum, (sum / 1048576).toFixed(2) + ' MB', bootKeys().length + ' files');
    expect(sum).toBeLessThanOrEqual(3 * 1024 * 1024);
  });
});
