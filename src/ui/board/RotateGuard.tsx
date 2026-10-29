// 세로 화면 안내(DESIGN §4.2 세로 화면 행, U1 · 2026-10-29 QA6 r6 minor).
// 게임 화면 루트(.game)의 마지막 자식으로 둔다: position fixed + 전용 z(--z-rotate, 기존 최고 60 위)라
// 문항·해설·컷씬·알림·규칙/멈춤 간판 등 모든 레이어 위에 뜬다. Board 안에 두면 줌 스테이지 stacking context 에 갇혀
// 바깥 간판이 위로 올라오고 눌렸다(r6). 떠 있는 동안 형제 레이어는 전부 inert(나중에 붙는 레이어도), 보드 대기 모션은
// Board 가 같은 usePortrait 로 멈춘다(PRD §12.2 covered 와 같음). 버튼 없음 — 돌리면 저절로 사라진다.
// U4(2026-10-29): 카드 2장(P 세로판 3:4 · L 가로판 16:9)을 같은 중심에 겹쳐 4.8s 주기로 돌며 크로스페이드(board.css).
// 가로판이 받아지고 디코드될 때까지 P 정지, 못 받으면 P 만 옛 ±3° 흔들림. 움직임을 줄이면 P 정지만, 가로판은 요청도 안 한다.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Pic } from '../../assets/AssetImg';
import { ROTATE_WIDE, assetUrl } from '../../assets/manifest';
import { preload } from '../../assets/preload';

const isPortrait = () => typeof innerWidth === 'number' && innerHeight > innerWidth;

/** 가로 전용 게임: 화면이 세로인가(창 크기 바뀌면 다시 잰다) */
export function usePortrait(): boolean {
  const [portrait, setPortrait] = useState(isPortrait);
  useLayoutEffect(() => {
    const fit = () => setPortrait(isPortrait());
    fit();
    addEventListener('resize', fit);
    return () => removeEventListener('resize', fit);
  }, []);
  return portrait;
}

const MARK = 'data-rotate-inert';
const RM = '(prefers-reduced-motion: reduce)';

/** 움직임 줄이기(바뀌면 따라간다) */
function useReduced(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(RM).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(RM);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

type Wide = 'wait' | 'ready' | 'fail';
/** 가로판: 덮개가 뜨면 ui.rotate 와 함께 받고 디코드까지 마친 뒤 ready(첫 크로스페이드에 빈 칸이 안 보이게) */
function useWide(on: boolean): Wide {
  const [st, setSt] = useState<Wide>('wait');
  useEffect(() => {
    if (!on || st !== 'wait') return;
    let live = true;
    void preload(['ui.rotate', ROTATE_WIDE]).then(async ([, ok]) => {
      const url = assetUrl(ROTATE_WIDE);
      if (ok && url) { const im = new Image(); im.src = url; await im.decode().catch(() => {}); }
      if (live) setSt(ok ? 'ready' : 'fail');
    });
    return () => { live = false; };
  }, [on, st]);
  return st;
}

export function RotateGuard() {
  const portrait = usePortrait();
  const reduced = useReduced();
  const wide = useWide(portrait && !reduced);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!portrait || !el || !parent) return;
    // 원래 inert 였던 형제는 건드리지 않는다(표시한 것만 되돌린다)
    const mark = () => {
      for (const c of parent.children) {
        if (c === el || c.hasAttribute('inert')) continue;
        c.setAttribute('inert', '');
        c.setAttribute(MARK, '');
      }
    };
    mark();
    const mo = new MutationObserver(mark); // 덮개가 떠 있는 동안 새로 붙는 문항·알림·간판도
    mo.observe(parent, { childList: true });
    return () => {
      mo.disconnect();
      for (const c of parent.querySelectorAll(`:scope > [${MARK}]`)) { c.removeAttribute('inert'); c.removeAttribute(MARK); }
    };
  }, [portrait]);
  if (!portrait) return null;
  const mode = reduced ? 'still' : wide === 'ready' ? 'turn' : wide === 'fail' ? 'sway' : 'still';
  return (
    <div ref={ref} class="board-rotate" role="alert" data-mode={mode}>
      {/* U1(DESIGN §4.2 세로 화면 안내): 구름 바탕 + 전용 일러스트 + 크림 알약. 버튼 없음 — 돌리면 저절로 사라진다.
          옛 CSS 기기 아이콘·3/4 원은 그림을 못 불러올 때만 */}
      <Pic k="ui.boardBg" class="board-rotate-bg" eager />
      <div class="board-rotate-body">
        <div class="board-rotate-card is-p">
          <Pic k="ui.rotate" class="board-rotate-art" eager
            fallback={<span class="board-rotate-icon" aria-hidden="true"><span class="board-rotate-device" /></span>} />
        </div>
        {/* U4 가로판: 받아진 뒤에만 그린다(움직임 줄이기면 요청 자체를 안 함) */}
        {mode === 'turn' && (
          <div class="board-rotate-card is-l" aria-hidden="true">
            <Pic k={ROTATE_WIDE} class="board-rotate-art" eager />
          </div>
        )}
      </div>
      <div class="board-rotate-pill">
        <p class="board-rotate-title">기기를 가로로 돌려 주세요</p>
        <p class="board-rotate-text">옆으로 눕히면 판이 크게 보여요</p>
      </div>
    </div>
  );
}
