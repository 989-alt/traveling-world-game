// 코인 변화 연출 부품(계산은 coin-logic.ts): 롤링 숫자 · 증감 팝 · 날아가는/빠지는/떨어지는 코인 + 연출 시간표 훅.
// 움직임은 transform·opacity 만 쓴다. 재접속(전체 다시 받기)·탭 숨김은 연출 없이 최종값, reduced-motion 은 숫자 즉시·팝만 짧게.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Pic } from '../../assets/AssetImg';
import { movesShowMs } from '../../shared/timing';
import type { LogEvent, Seat } from '../../shared/types';
import {
  coinChanges, coinCount, digitReels, DROP_MS, FLY_MS, plan, POP_MS, POP_REDUCED_MS, reelMs, type CoinFlow, type Reel,
} from './coin-logic';
import { CHAR, CORNER_FEET, CORNER_HS, HUD } from './geometry';

// ── 롤링 숫자 ─────────────────────────────────────────

let runSeq = 0;

/** 코인 숫자. value 가 바뀌면(animate) 바뀐 자리만 릴처럼 돌다 선다 */
export function CoinCounter({ value, animate }: { value: number; animate: boolean }) {
  const [run, setRun] = useState<{ reels: Reel[]; key: number; up: boolean } | null>(null);
  const last = useRef(value);
  useLayoutEffect(() => {
    const from = last.current;
    if (from === value) return;
    last.current = value;
    if (!animate) { setRun(null); return; }
    const reels = digitReels(from, value);
    const key = ++runSeq;
    setRun({ reels, key, up: value >= from });
    const ms = Math.max(0, ...reels.filter((r) => r.spin).map((r) => reelMs(r.order))) + 80;
    const h = setTimeout(() => setRun((r) => (r?.key === key ? null : r)), ms);
    return () => clearTimeout(h);
  }, [value]);
  const reels = run?.reels ?? digitReels(value, value);
  return (
    <b class={`coin-num${run ? (run.up ? ' is-gain' : ' is-loss') : ''}`} aria-hidden="true" data-coin={value}>
      {reels.map((r, i) => {
        const comma = r.strip.length === 1 && r.strip[0] === ',';
        const cls = `reel${comma ? ' reel--comma' : ''}${r.spin ? ` is-spin ${r.up ? 'is-up' : 'is-down'}` : ''}${r.exit ? ' is-exit' : ''}${r.enter ? ' is-enter' : ''}`;
        return (
          <span key={run ? `${run.key}-${i}` : `s${i}-${r.strip[0]}`} class={cls}
            style={r.spin ? { '--n': r.strip.length - 1, '--dur': `${reelMs(r.order)}ms` } : undefined}>
            <span class="reel-strip">{r.strip.map((c) => <span class="reel-cell">{c || ' '}</span>)}</span>
          </span>
        );
      })}
    </b>
  );
}

// ── 팝 ────────────────────────────────────────────────

export interface ActivePop { id: number; seat: Seat; text: string; gain: boolean; lane: number; still: boolean }

/** 패널 위 증감 팝. 이유는 숫자 왼쪽 */
export function CoinPops({ pops }: { pops: ActivePop[] }) {
  if (!pops.length) return null;
  return (
    <span class="coin-pops" aria-hidden="true">
      {pops.map((p) => {
        const sp = p.text.lastIndexOf(' ');
        return (
          <span key={p.id} class={`coin-pop ${p.gain ? 'is-gain' : 'is-loss'}${p.still ? ' is-still' : ''}`} style={{ '--lane': p.lane }} data-pop={p.text}>
            <span class="coin-pop-in"><span class="coin-pop-why">{p.text.slice(0, sp)}</span> <b class="coin-pop-num">{p.text.slice(sp + 1)}</b></span>
          </span>
        );
      })}
    </span>
  );
}

// ── 코인 흐름 ─────────────────────────────────────────

/** 패널 코인 아이콘 자리(스테이지 px): U5 패널 200×48 — 테 3 + 자리색 띠 30%(58) 뒤 크림 칸 가운데 정렬(아이콘 16 + 숫자 4~5자) ≈ 중심 − 8, 세로 가운데(board.css .panel-*) */
export const coinIconAt = (seat: Seat) => ({ x: HUD.panels[seat].x - 8, y: HUD.panels[seat].y });
/** 귀퉁이 전신 캐릭터 손(받는 쪽, U5 §16.9.3): 발에서 키 45% 위, 광장 안쪽으로 몸 폭 1/4 */
export const cornerHandAt = (seat: Seat) => {
  const f = CORNER_FEET[seat], inward = f.x < 683 ? 1 : -1;
  const h = CORNER_HS[seat];
  return { x: f.x + inward * 0.25 * ((h * CHAR.w) / CHAR.h), y: f.y - 0.45 * h };
};

export interface Fly { id: number; flow: CoinFlow; n: number }

function CoinImg() {
  return <Pic k="ui.coin" class="coin-fx-img" fallback={<i class="coin-fx-img coin-fx-fallback" />} />;
}

/** 스테이지 위 코인 층(HUD 안, 패널 위) */
export function CoinFlyLayer({ flies }: { flies: Fly[] }) {
  if (!flies.length) return null;
  return (
    <div class="coin-fx" aria-hidden="true">
      {flies.flatMap((f) => Array.from({ length: f.n }, (_, i) => {
        const spread = (i - (f.n - 1) / 2) * 9;
        if (f.flow.kind === 'transfer') {
          const a = coinIconAt(f.flow.from), b = cornerHandAt(f.flow.to); // 지불자 패널 → 받는 사람 귀퉁이 캐릭터 손(U5)
          return (
            <span key={`${f.id}-${i}`} class="coin-fly" data-flow="transfer" style={{ left: `${a.x}px`, top: `${a.y}px`, '--dx': `${b.x - a.x}px`, '--dy': `${b.y - a.y}px`,
              '--arc': `${110 + (i % 3) * 22}px`, '--delay': `${i * 55}ms`, '--dur': `${FLY_MS}ms` }}>
              <span class="coin-fly-arc"><span class="coin-fly-spin"><CoinImg /></span></span>
            </span>
          );
        }
        const at = coinIconAt(f.flow.seat);
        return (
          <span key={`${f.id}-${i}`} class={f.flow.kind === 'pay' ? 'coin-drain' : 'coin-drop'} data-flow={f.flow.kind}
            style={{ left: `${at.x}px`, top: `${at.y}px`, '--sx': `${spread}px`, '--delay': `${i * 60}ms`, '--dur': `${f.flow.kind === 'pay' ? 620 : DROP_MS}ms` }}>
            <span class="coin-fly-spin"><CoinImg /></span>
          </span>
        );
      }))}
    </div>
  );
}

// ── 시간표 훅 ─────────────────────────────────────────

export interface CoinFxIn {
  coins: number[];
  bankrupt: boolean[];
  owners: (Seat | null)[];
  log?: LogEvent[];
  /** 연출 없이 최종값(재접속 다시 받기·탭 숨김) */
  instant: boolean;
  reduced: boolean;
}
export interface CoinFxOut { shown: number[]; pops: ActivePop[]; flies: Fly[]; shake: boolean[]; animate: boolean }

/** 새 로그·코인 → 자리별 표시 숫자·팝·흐름. 이동 연출(홉·줌)이 끝난 뒤, 앞 묶음이 끝난 뒤에 시작한다 */
export function useCoinFx({ coins, bankrupt, owners, log, instant, reduced }: CoinFxIn): CoinFxOut {
  const [shown, setShown] = useState(coins);
  const [pops, setPops] = useState<ActivePop[]>([]);
  const [flies, setFlies] = useState<Fly[]>([]);
  const [shake, setShake] = useState<boolean[]>(() => coins.map(() => false));
  const prev = useRef(coins);
  const prevOwners = useRef(owners);
  const seen = useRef(log?.length ?? 0);
  const busyUntil = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const ids = useRef(0);
  const later = (ms: number, f: () => void) => {
    const h = setTimeout(() => { timers.current.delete(h); f(); }, Math.max(0, ms));
    timers.current.add(h);
  };
  const clearAll = () => { timers.current.forEach(clearTimeout); timers.current.clear(); busyUntil.current = 0; };
  useEffect(() => clearAll, []);

  const key = coins.join();
  useEffect(() => {
    const len = log?.length ?? 0;
    const restarted = len < seen.current; // 새 판
    const fresh = restarted ? [] : (log ?? []).slice(seen.current);
    seen.current = len;
    const before = prev.current, own = prevOwners.current;
    prev.current = coins;
    prevOwners.current = owners;
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (instant || hidden || restarted) {
      clearAll();
      setShown(coins); setPops([]); setFlies([]); setShake(coins.map(() => false));
      return;
    }
    if (coins.every((c, i) => c === before[i])) return;
    const changes = coinChanges(fresh, own, before, coins, bankrupt);
    const now = performance.now();
    const start = Math.max(now + (reduced ? 0 : movesShowMs(fresh)), busyUntil.current);
    const p = plan(changes, start);
    busyUntil.current = p.end;
    const final = coins;
    if (reduced) setShown(final); // 숫자 즉시
    else for (const [seat, at] of p.rollAt) later(at - now, () => setShown((cur) => cur.map((v, i) => (i === seat ? final[i] : v))));
    for (const pp of p.pops) {
      later(pp.at - now, () => {
        const id = ++ids.current;
        setPops((cur) => {
          const used = new Set(cur.filter((x) => x.seat === pp.seat).map((x) => x.lane));
          let lane = 0;
          while (used.has(lane)) lane++;
          return [...cur, { id, seat: pp.seat, text: pp.text, gain: pp.gain, lane, still: reduced }];
        });
        later(reduced ? POP_REDUCED_MS : POP_MS, () => setPops((cur) => cur.filter((x) => x.id !== id)));
      });
    }
    if (!reduced) {
      for (const f of p.flows) {
        later(f.at - now, () => {
          const id = ++ids.current;
          const n = coinCount(f.amount);
          setFlies((cur) => [...cur, { id, flow: f.flow, n }]);
          later(FLY_MS + n * 60 + 200, () => setFlies((cur) => cur.filter((x) => x.id !== id)));
          const payer = f.flow.kind === 'transfer' ? f.flow.from : f.flow.kind === 'pay' ? f.flow.seat : null;
          if (payer !== null) {
            setShake((cur) => cur.map((v, i) => (i === payer ? true : v)));
            later(450, () => setShake((cur) => cur.map((v, i) => (i === payer ? false : v))));
          }
        });
      }
    }
  }, [key, log?.length, instant]);

  return { shown, pops, flies, shake, animate: !reduced && !instant };
}
