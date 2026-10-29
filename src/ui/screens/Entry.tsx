// 첫 화면 = 게임 인트로(DESIGN §15.1, R2 C1~C5, 기준 그림 INTRO-mock-wide).
// 로고 + 돌 광장 위 캐릭터 6·봇 + 시작하기 → 팝업 1(나무판: 친구 방 들어가기 / 새 방 만들기) → 2a 코드 6칸 / 2b 놀이 시간 → 로비.
// 글을 쓰는 칸은 방 코드 하나뿐(6칸 = 한 글자씩, 대문자 자동, 붙여넣기 6자 분배).
import { useEffect, useRef, useState } from 'preact/hooks';
import { AssetImg, Pic } from '../../assets/AssetImg';
import { audio } from '../../audio/engine';
import { createRoom } from '../../net/socket';
import { CODE_CHARS, CODE_RE } from '../../shared/protocol';
import { TOTAL_MINUTES, type TotalMinutes } from '../../shared/types';
import type { GameClient } from '../../state/client';
import { MOTIONS } from '../characters/motions';
import { MotionScheduler } from '../characters/scheduler';
import { PlankButton, PlankDialog, STAGE, useStageScale } from '../overlays/PlankDialog';
import { ScrollDialog, SignButton } from '../overlays/ScrollPanel';
import { tryFullscreenOnce } from '../device/fullscreen';
import { Rules } from './Rules';
import '../../styles/screens.css';

const VERSION = 'v0.5';
const cleanCode = (v: string) => [...v.toUpperCase()].filter((c) => CODE_CHARS.includes(c)).join('');
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 무대 위 6명: 시안(INTRO-mock-wide)대로 크게(키 ≈ 290, 화면 높이 38%) 가운데로 모아 살짝 겹치게, 환호(P12)·점프(P11) 번갈아.
 *  2026-10-27 검토 판정: DESIGN §15.1 의 '높이 200·광장 6등분'보다 시안이 우선 */
const CAST = [1, 2, 3, 4, 5, 6].map((c, i) => ({
  c,
  pose: i % 2 ? 'p11' : 'p12',
  x: 290 + 155 * i,
  y: [610, 618, 624, 624, 618, 610][i],
}));

type Popup = null | 'menu' | 'join' | 'make';

export function Entry({ client }: { client: GameClient }) {
  const [popup, setPopup] = useState<Popup>(null);
  const [rules, setRules] = useState(false);
  const [muted, setMuted] = useState(audio.muted);
  const scale = useStageScale();
  const startRef = useRef<HTMLButtonElement>(null);
  const still = popup !== null || rules;
  useIdle(still);

  const closeAll = () => { setPopup(null); requestAnimationFrame(() => startRef.current?.focus({ preventScroll: true })); };

  return (
    <main class="sc sc--entry intro" data-popup={popup ?? 'none'} data-still={still ? '1' : '0'}>
      <AssetImg k="ui.boardBg" class="sc-bg" />
      <div class="in-stage" style={{ transform: `translate(-50%, -50%) scale(${scale})`, width: `${STAGE.w}px`, height: `${STAGE.h}px` }}>
        <h1 class="in-title">
          <Pic k="logo.v2" class="in-logo" alt="돌아라! 지구 한 바퀴" eager fallback={<span class="in-logo-text">돌아라! 지구 한 바퀴</span>} />
        </h1>
        <Pic k="ui.stage" class="in-ground" eager fallback={<span class="in-ground in-ground--css" />} />
        <div class="in-cast" aria-hidden="true">
          <Actor c={7} pose="p01" x={1200} y={606} bot />
          {CAST.map((a) => <Actor key={a.c} {...a} />)}
        </div>
        <button type="button" ref={startRef} class="intro-start" data-act="intro-start" onClick={() => { tryFullscreenOnce(); setPopup('menu'); }}>
          {/* 펄스는 안쪽 면만(버튼 상자는 고정 — 누르는 자리가 흔들리지 않게) */}
          <span class="intro-start-face"><PlayIcon />시작하기</span>
          <i class="in-star in-star--l" aria-hidden="true" /><i class="in-star in-star--r" aria-hidden="true" />
        </button>
        <div class="in-signs">
          <SignButton label={muted ? '소리 켜기' : '소리 끄기'} onClick={() => { audio.setMuted(!muted); setMuted(!muted); }}>
            <SpeakerIcon off={muted} />
          </SignButton>
          <SignButton label="규칙 보기" onClick={() => setRules(true)}><b class="sign-q">?</b></SignButton>
        </div>
        <span class="in-version">{VERSION}</span>
      </div>

      {popup === 'menu' && (
        <PlankDialog title="어떻게 놀까?" onClose={closeAll}>
          <div class="plank-btns">
            <PlankButton icon="🔑" label="친구 방 들어가기" act="to-join" onClick={() => setPopup('join')} />
            <PlankButton icon="✨" label="새 방 만들기" act="to-make" onClick={() => setPopup('make')} />
          </div>
        </PlankDialog>
      )}
      {popup === 'join' && <JoinPopup client={client} onBack={() => setPopup('menu')} />}
      {popup === 'make' && <MakePopup client={client} onBack={() => setPopup('menu')} />}
      {rules && <Rules onClose={() => setRules(false)} />}
    </main>
  );
}

/** 무대 위 한 명: 발 = (x, y). 접지 그림자는 발밑 타원(같은 그림 안에 선 느낌) */
function Actor({ c, pose, x, y, bot }: { c: number; pose: string; x: number; y: number; bot?: boolean }) {
  return (
    <div class={`in-ch${bot ? ' in-ch--bot' : ''}`} data-ch={c} style={{ left: `${x}px`, top: `${y}px` }}>
      <span class="in-shadow" />
      <div class="in-ch-body">
        <Pic k={`char.${c}.${pose}.big`} class="in-ch-img" eager fallback={<Pic k={`char.${c}.${pose}`} class="in-ch-img" />} />
      </div>
    </div>
  );
}

/** 대기 모션 A(PRD §12.2): 스케줄러 재사용, 동시 ≤ 2. 팝업이 뜨면 멈춤. 모션 줄이기면 아예 안 돈다 */
function useIdle(paused: boolean) {
  const sch = useRef<MotionScheduler | null>(null);
  useEffect(() => {
    if (reduced()) return;
    const anims = new Map<string, Animation>();
    const s = new MotionScheduler({
      maxIdle: 2,
      onChange: (id) => {
        anims.get(id)?.cancel();
        anims.delete(id);
        const p = s.get(id);
        const el = document.querySelector<HTMLElement>(`.in-ch[data-ch="${id}"] .in-ch-body`);
        const m = p && MOTIONS[p.motion];
        if (!el || !m || typeof el.animate !== 'function') return;
        // 포즈 교체 그림(1024)은 P01·P12 뿐이라 트윈만 쓴다. 키프레임 없는 모션(쉬기)은 작은 깡충
        const frames = m.frames ?? [{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)', offset: 0.3 }, { transform: 'translateY(0)', offset: 0.6 }, { transform: 'translateY(0)' }];
        anims.set(id, el.animate(frames, { duration: m.cycle ?? m.ms, iterations: m.iterations ?? 1, easing: 'ease-in-out' }));
      },
    });
    for (const a of CAST) s.add(String(a.c));
    sch.current = s;
    return () => { s.dispose(); for (const a of anims.values()) a.cancel(); sch.current = null; };
  }, []);
  useEffect(() => { sch.current?.setPaused(paused); }, [paused]);
}

const PlayIcon = () => (
  <svg class="intro-start-play" viewBox="0 0 48 48" aria-hidden="true">
    <path d="M14 8.5c0-2.3 2.5-3.7 4.4-2.5l22.7 15.5a3 3 0 0 1 0 5L18.4 42c-1.9 1.2-4.4-.2-4.4-2.5z" fill="#FFFFFF" stroke="#142038" stroke-width="4.5" stroke-linejoin="round" />
  </svg>
);

const SpeakerIcon = ({ off }: { off: boolean }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    {off ? <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none" />
      : <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none" />}
  </svg>
);

/** 팝업 2a: 친구가 알려 준 코드 6칸(나무 글자 타일). 한 칸에 한 글자, 다음 칸으로 자동, 붙여넣기는 6자 분배 */
function JoinPopup({ client, onBack }: { client: GameClient; onBack: () => void }) {
  const [cells, setCells] = useState<string[]>(['', '', '', '', '', '']);
  const [msg, setMsg] = useState('');
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const code = cells.join('');
  const focus = (i: number) => refs.current[Math.max(0, Math.min(5, i))]?.focus();

  const put = (i: number, el: HTMLInputElement) => {
    const got = cleanCode(el.value);
    const next = [...cells];
    let k = i;
    if (!got) next[i] = '';
    else {
      // 칸에 글자가 있는데 하나 더 쳤으면(커서가 끝) 새 글자만. 여러 글자(붙여넣기)면 i 부터 나눠 넣는다
      const chars = got.length === 2 && cells[i] && got[0] === cells[i] ? [got[1]] : [...got];
      for (const ch of chars) { if (k > 5) break; next[k++] = ch; }
    }
    el.value = next[i]; // 거른 글자가 칸에 남지 않게
    setCells(next);
    if (got) focus(k);
  };
  const submit = (e: Event) => {
    e.preventDefault();
    if (CODE_RE.test(code)) client.open(code);
    else setMsg('방 코드는 6자리예요. 친구 화면의 코드를 다시 봐 주세요.');
  };

  return (
    <ScrollDialog label="친구 방 들어가기" onBack={onBack}>
      <form class="pp-form" onSubmit={submit}>
        <h2 class="pp-title" id="code-label">친구가 알려 준 코드</h2>
        <div class="code-tiles" role="group" aria-labelledby="code-label">
          {cells.map((v, i) => (
            <input key={i} ref={(el) => { refs.current[i] = el; }} id={i === 0 ? 'room-code' : undefined} class="code-tile" type="text"
              inputMode="text" autoComplete="off" autoCapitalize="characters" spellcheck={false} value={v} data-autofocus={i === 0 ? '' : undefined}
              aria-label={`코드 ${i + 1}번째 글자`}
              onInput={(e) => put(i, e.target as HTMLInputElement)}
              onFocus={(e) => (e.target as HTMLInputElement).select()}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !cells[i] && i > 0) { e.preventDefault(); const n = [...cells]; n[i - 1] = ''; setCells(n); focus(i - 1); }
                else if (e.key === 'ArrowLeft') { e.preventDefault(); focus(i - 1); }
                else if (e.key === 'ArrowRight') { e.preventDefault(); focus(i + 1); }
              }} />
          ))}
        </div>
        {msg && <p class="pp-msg" role="alert">{msg}</p>}
        <button type="submit" class="pp-go" data-act="join" disabled={code.length !== 6}>들어가기</button>
      </form>
    </ScrollDialog>
  );
}

/** 팝업 2b: 놀이 시간 40/60/80분 나무 말뚝 토글 3개(기본 40, 가운데 정렬) → 방 만들기 (DESIGN §15.2, 2026-10-28 U1·U3) */
function MakePopup({ client, onBack }: { client: GameClient; onBack: () => void }) {
  const [minutes, setMinutes] = useState<TotalMinutes>(40);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const make = async () => {
    setBusy(true);
    setMsg('');
    const c = await createRoom({ totalMinutes: minutes });
    setBusy(false);
    if (c) client.open(c);
    else setMsg('방을 만들지 못했어요. 인터넷 연결을 보고 다시 눌러 주세요.');
  };
  return (
    <ScrollDialog label="새 방 만들기" onBack={onBack}>
      <div class="pp-form">
        <fieldset class="peg-set">
          <legend class="pp-title">얼마나 놀까요?</legend>
          <div class="peg-row peg-row--time">
            {TOTAL_MINUTES.map((n) => (
              <button type="button" key={n} class="peg" data-minutes={n} aria-pressed={minutes === n} data-autofocus={n === 40 ? '' : undefined} onClick={() => setMinutes(n)}>{n}분</button>
            ))}
          </div>
          <p class="pp-hint">수업 중간에 멈추면 같은 코드로 이어서 할 수 있어요</p>
        </fieldset>
        {msg && <p class="pp-msg" role="alert">{msg}</p>}
        <button type="button" class="pp-go" data-act="make" disabled={busy} onClick={make}>{busy ? '만드는 중…' : '방 만들기'}</button>
      </div>
    </ScrollDialog>
  );
}

/** 방에 들어가는 중. 계속 안 이어지면(없는 방·인터넷 끊김) 돌아갈 길을 준다 */
export function Connecting({ retrying, onBack }: { retrying: boolean; onBack: () => void }) {
  return (
    <main class="sc sc--wait">
      <AssetImg k="ui.boardBg" class="sc-bg" />
      <div class="sc-glass sc-note" role="status">
        <p>{retrying ? '방에 들어갈 수 없어요. 코드가 맞는지, 인터넷이 잘 되는지 확인해 주세요.' : '방에 들어가는 중이에요…'}</p>
        {retrying && <button type="button" class="ov-btn ov-btn--secondary" onClick={onBack}>처음 화면으로</button>}
      </div>
    </main>
  );
}

/** 같은 자리에 다른 기기가 들어와 이 기기는 멈췄다 */
export function Replaced({ onAgain }: { onAgain: () => void }) {
  return (
    <main class="sc sc--wait">
      <AssetImg k="ui.boardBg" class="sc-bg" />
      <div class="sc-glass sc-note" role="status">
        <p>다른 기기에서 이 자리로 들어왔어요. 여기서 계속하려면 아래 버튼을 눌러요.</p>
        <button type="button" class="ov-btn ov-btn--primary" onClick={onAgain}>이 기기로 계속하기</button>
      </div>
    </main>
  );
}
