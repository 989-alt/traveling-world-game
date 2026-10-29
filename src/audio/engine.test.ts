import { describe, expect, it } from 'vitest';
import { createAudio, MAX_SFX } from './engine';
import { SFX, sfxDuration } from './sfx';

// 가짜 AudioContext: 만든 오실레이터를 모아 두고 onended 를 수동으로 발사한다.
function fake(opts: { suspended?: boolean; playReject?: boolean; makeCtxThrows?: boolean } = {}) {
  let state = opts.suspended ? 'suspended' : 'running';
  let playReject = !!opts.playReject;
  const oscs: { onended: (() => void) | null }[] = [];
  let ctxMade = 0;
  let resumeOk = !opts.suspended;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connect: (n: unknown) => n, gain: param() });
  const makeCtx = () => {
    ctxMade++;
    if (opts.makeCtxThrows) throw new Error('no audio');
    return {
      get state() { return state; },
      currentTime: 0, destination: {}, resume: async () => { if (!opts.suspended || resumeOk) state = 'running'; },
      createGain: node,
      createOscillator: () => { const o = { type: '', frequency: param(), onended: null as null | (() => void), connect: (n: unknown) => n, start() {}, stop() {} }; oscs.push(o); return o; },
    } as unknown as AudioContext;
  };
  const els: { url: string; volume: number; muted: boolean; loop: boolean; paused: boolean; played: number }[] = [];
  const makeAudio = (url: string) => {
    const el = { url, volume: 1, muted: false, loop: false, paused: false, played: 0, play() { el.played++; return playReject ? Promise.reject(new Error('NotAllowed')) : Promise.resolve(); }, pause() { el.paused = true; } };
    els.push(el);
    return el as unknown as HTMLAudioElement;
  };
  let t = 0;
  const timers: (() => void)[] = [];
  const storage = new Map<string, string>();
  const deps = {
    makeCtx, makeAudio,
    storage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) },
    now: () => t,
    setTimer: (fn: () => void) => void timers.push(fn),
  };
  const advance = (ms: number) => { t += ms; for (const fn of timers.splice(0)) fn(); };
  return { deps, oscs, els, storage, advance, allowResume: () => { resumeOk = true; }, allowPlay: () => { playReject = false; }, get ctxMade() { return ctxMade; } };
}

describe('sfx 표', () => {
  it('14종, 각 ≤ 0.6초', () => {
    expect(Object.keys(SFX)).toHaveLength(14);
    for (const n of Object.keys(SFX)) expect(sfxDuration(n)).toBeLessThanOrEqual(0.6);
  });
});

describe('오디오 매니저', () => {
  it('제스처 전에는 AudioContext·BGM 재생이 없다', () => {
    const f = fake(); const a = createAudio(f.deps);
    a.playBgm('bgm.lobby'); a.playSfx('coin');
    expect(f.ctxMade).toBe(0); expect(f.els).toHaveLength(0); expect(f.oscs).toHaveLength(0);
  });

  it('unlock 뒤 대기 중이던 BGM 이 시작하고, unlock 은 한 번만 컨텍스트를 만든다', async () => {
    const f = fake(); const a = createAudio(f.deps);
    a.playBgm('bgm.lobby'); await a.unlock(); await a.unlock();
    expect(f.ctxMade).toBe(1); expect(f.els).toHaveLength(1);
    expect(f.els[0].loop).toBe(true); expect(f.els[0].played).toBe(1);
  });

  it('효과음 동시 4개를 넘으면 버리고, 끝나면 다시 쓴다', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    for (let i = 0; i < 6; i++) a.playSfx('dice');
    expect(a.activeSfx).toBe(MAX_SFX);
    f.oscs.filter(o => o.onended).forEach(o => o.onended!());
    expect(a.activeSfx).toBe(0);
    a.playSfx('coin'); expect(a.activeSfx).toBe(1);
  });

  it('모르는 효과음 이름은 무시', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.playSfx('nope'); expect(a.activeSfx).toBe(0);
  });

  it('음소거 상태가 저장·복원되고 효과음을 막는다', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.setMuted(true); a.playSfx('coin');
    expect(a.activeSfx).toBe(0); expect(f.storage.get('tw.muted')).toBe('1');
    expect(createAudio(f.deps).muted).toBe(true);
    a.setMuted(false); a.playSfx('coin'); expect(a.activeSfx).toBe(1);
  });

  it('BGM 곡 교체는 크로스페이드(새 곡 0->, 옛 곡 ->0 뒤 정지)', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.playBgm('bgm.board'); a.playBgm('bgm.final');
    expect(f.els).toHaveLength(2);
    expect(f.els[0].paused).toBe(false); // 아직 페이드 중
    f.advance(500);
    expect(f.els[1].volume).toBeGreaterThan(0); expect(f.els[0].volume).toBeLessThan(0.5);
    f.advance(600);
    expect(f.els[0].paused).toBe(true); expect(f.els[0].volume).toBe(0);
  });

  it('같은 곡을 다시 요청해도 새로 만들지 않는다', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.playBgm('bgm.board'); a.playBgm('bgm.board'); expect(f.els).toHaveLength(1);
  });

  it('localStorage 가 막혀도 던지지 않는다', () => {
    const f = fake();
    const a = createAudio({ ...f.deps, storage: { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } } });
    expect(a.muted).toBe(false); expect(() => a.setMuted(true)).not.toThrow(); expect(a.muted).toBe(true);
  });

  it('suspended 컨텍스트는 running 이 될 때까지 unlocked 가 아니고, 제스처마다 resume 재시도', async () => {
    const f = fake({ suspended: true }); const a = createAudio(f.deps);
    a.playBgm('bgm.lobby');
    expect(await a.unlock()).toBe(false); expect(a.unlocked).toBe(false); expect(f.els).toHaveLength(0);
    a.playSfx('coin'); expect(a.activeSfx).toBe(0);
    f.allowResume();
    expect(await a.unlock()).toBe(true); expect(a.unlocked).toBe(true); expect(f.ctxMade).toBe(1); expect(f.els).toHaveLength(1);
  });

  it('makeCtx 가 던져도 unlock 은 false 로 끝나고 다음 제스처에 다시 시도', async () => {
    const f = fake({ makeCtxThrows: true }); const a = createAudio(f.deps);
    expect(await a.unlock()).toBe(false); expect(a.unlocked).toBe(false);
    expect(await a.unlock()).toBe(false); expect(f.ctxMade).toBe(2);
  });

  it('거부된 BGM play() 는 다음 제스처에서 같은 요소로 재시도', async () => {
    const f = fake({ playReject: true }); const a = createAudio(f.deps);
    a.playBgm('bgm.board'); await a.unlock();
    await Promise.resolve(); // 거부 처리
    expect(f.els[0].played).toBe(1);
    f.allowPlay();
    expect(await a.unlock()).toBe(true);
    expect(f.els).toHaveLength(1); expect(f.els[0].played).toBe(2);
    await a.unlock(); expect(f.els[0].played).toBe(2); // 성공 뒤엔 더 안 부름
  });

  it('새 페이드가 같은 요소의 옛 페이드를 취소한다', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    a.playBgm('bgm.board'); f.advance(300);
    a.playBgm(null); f.advance(300); // board 페이드아웃 시작
    expect(f.els[0].volume).toBeLessThan(0.2);
  });

  it('onended 가 안 오는 효과음 슬롯은 시간이 지나면 회수된다', async () => {
    const f = fake(); const a = createAudio(f.deps); await a.unlock();
    for (let i = 0; i < 4; i++) a.playSfx('dice');
    a.playSfx('coin'); expect(a.activeSfx).toBe(4);
    f.advance(2000);
    a.playSfx('coin'); expect(a.activeSfx).toBe(1);
  });
});
