// 대기·반응·내 턴 모션 스케줄러 (PRD §12.2). 화면과 떨어진 순수 상태 기계 — 가짜 시계로 시험한다.
// 규칙: A 간헐 모션은 캐릭터마다 5~10초 균일 간격(U5 귀퉁이 캐릭터, 옛 8~15초 폐기), 보드 전체 동시 ≤ 2, 일시 정지(모달·탭 숨김) 중엔 A 없음.
// maxIdle 0 = A 간헐 모션 없음(판 위 말 — U5 §16.9.3 이모션 0).
// 우선순위 C > B > A: 높은 쪽이 낮은 쪽을 선점하고, 끝나면 기본 자세(motion null)로 돌아온다.
import { IDLE_MOTIONS, MOTIONS, RANK, type MotionId, type Tier } from './motions';

export interface Playing { motion: MotionId; tier: Tier; startedAt: number }
interface Actor {
  playing: Playing | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  endTimer: ReturnType<typeof setTimeout> | null;
  lastTurnAt: number;
  bankrupt: boolean;
  /** 무인도 표류 중이면 A 간헐 모션 대신 표류가 기본 자세 */
  drifting: boolean;
}

export interface SchedulerOptions {
  rand?: () => number;
  onChange?: (id: string) => void;
  minMs?: number;
  maxMs?: number;
  maxIdle?: number;
  /** 하품 조건: 내 턴 없이 이만큼 지남 */
  yawnAfterMs?: number;
}

export class MotionScheduler {
  private actors = new Map<string, Actor>();
  private paused = false;
  private readonly o: Required<SchedulerOptions>;

  constructor(opts: SchedulerOptions = {}) {
    this.o = { rand: Math.random, onChange: () => {}, minMs: 5000, maxMs: 10000, maxIdle: 2, yawnAfterMs: 90_000, ...opts };
  }

  add(id: string) {
    if (this.actors.has(id)) return;
    this.actors.set(id, { playing: null, idleTimer: null, endTimer: null, lastTurnAt: Date.now(), bankrupt: false, drifting: false });
    this.schedule(id);
  }

  remove(id: string) {
    const a = this.actors.get(id);
    if (!a) return;
    this.clear(a);
    this.actors.delete(id);
  }

  dispose() { for (const id of [...this.actors.keys()]) this.remove(id); }

  get(id: string): Playing | null { return this.actors.get(id)?.playing ?? null; }
  isGrey(id: string) { const a = this.actors.get(id); return !!a && a.bankrupt && !a.playing; }
  idleCount() { let n = 0; for (const a of this.actors.values()) if (a.playing?.tier === 'A') n++; return n; }

  /** 모달이 보드를 덮거나 탭이 숨으면 true. A 를 멈추고, 풀리면 새 간격으로 다시 잡는다. */
  setPaused(p: boolean) {
    if (p === this.paused) return;
    this.paused = p;
    for (const [id, a] of this.actors) {
      if (p) {
        if (a.idleTimer) clearTimeout(a.idleTimer), (a.idleTimer = null);
        if (a.playing?.tier === 'A') this.end(id);
      } else this.schedule(id);
    }
  }

  markTurn(id: string) { const a = this.actors.get(id); if (a) a.lastTurnAt = Date.now(); }

  /** B·C 모션. 지금 더 높은 단계가 돌고 있거나 파산이면 무시(false). */
  trigger(id: string, motion: MotionId): boolean {
    const a = this.actors.get(id);
    const m = MOTIONS[motion];
    if (!a || a.bankrupt) return false;
    if (a.playing && RANK[a.playing.tier] > RANK[m.tier]) return false;
    this.start(id, motion);
    return true;
  }

  /** 끝이 없는 모션(기대·표류)을 멈춘다. */
  stop(id: string, motion: MotionId) {
    const a = this.actors.get(id);
    if (a?.playing?.motion === motion) this.end(id);
  }

  /** 무인도 표류: 켜져 있으면 표류가 기본 자세이고 A 간헐 모션은 없다. */
  setDrifting(id: string, on: boolean) {
    const a = this.actors.get(id);
    if (!a || a.drifting === on || a.bankrupt) return;
    a.drifting = on;
    if (on) { if (!a.playing || a.playing.tier === 'A') this.start(id, 'drift'); }
    else this.stop(id, 'drift');
  }

  /** 파산: 쓰러짐 2초 뒤 회색, 그 뒤 모션 없음. */
  setBankrupt(id: string) {
    const a = this.actors.get(id);
    if (!a || a.bankrupt) return;
    this.start(id, 'collapse');
    a.bankrupt = true;
  }

  private start(id: string, motion: MotionId) {
    const a = this.actors.get(id)!;
    this.clear(a);
    const m = MOTIONS[motion];
    a.playing = { motion, tier: m.tier, startedAt: Date.now() };
    if (Number.isFinite(m.ms)) a.endTimer = setTimeout(() => this.end(id), m.ms);
    this.o.onChange(id);
  }

  private end(id: string) {
    const a = this.actors.get(id);
    if (!a) return;
    this.clear(a);
    a.playing = null;
    if (a.drifting && !a.bankrupt) { this.start(id, 'drift'); return; }
    this.o.onChange(id);
    this.schedule(id);
  }

  private clear(a: Actor) {
    if (a.idleTimer) clearTimeout(a.idleTimer);
    if (a.endTimer) clearTimeout(a.endTimer);
    a.idleTimer = a.endTimer = null;
  }

  /** 다음 A 시도 시각: 지금 + U(min, max). */
  nextGap() { return this.o.minMs + this.o.rand() * (this.o.maxMs - this.o.minMs); }

  private schedule(id: string) {
    const a = this.actors.get(id);
    if (!a || this.paused || a.bankrupt || a.idleTimer || this.o.maxIdle <= 0) return;
    a.idleTimer = setTimeout(() => {
      a.idleTimer = null;
      // 바쁘거나 표류 중이거나 이미 2개가 돌면 이번 차례는 넘기고 새 간격을 뽑는다
      if (!a.playing && !a.drifting && this.idleCount() < this.o.maxIdle) {
        const pool: MotionId[] = Date.now() - a.lastTurnAt > this.o.yawnAfterMs ? [...IDLE_MOTIONS, 'yawn'] : IDLE_MOTIONS;
        this.start(id, pool[Math.floor(this.o.rand() * pool.length) % pool.length]);
      } else this.schedule(id);
    }, this.nextGap());
  }
}
