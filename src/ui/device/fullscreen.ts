// U7-device: 휴대폰 상단바를 없애고 화면 전체를 쓴다(사용자 요청 2026-10-30).
// 첫 탭(시작하기, 또는 새로고침·재접속으로 인트로를 건너뛴 경우 아무 첫 탭)에서 문서 전체 화면을 요청하고 가로로 고정한다.
// 거부·미지원이면 조용히 넘어간다 — 게임은 그대로 돈다. 아이폰 Safari 는 요소 전체 화면이 없어 아무 일도 안 일어난다
// (홈 화면에 추가하면 매니페스트·apple-mobile-web-app-capable 로 주소창 없이 열린다).
// 전체 화면에 한 번 들어갔다가 나오면 다시 들어가는 간판(FullscreenButton)을 보인다.
import { useEffect, useState } from 'preact/hooks';

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: (opts?: unknown) => Promise<void> | void };
type Lockable = ScreenOrientation & { lock?: (o: string) => Promise<void> };

const doc = () => (typeof document === 'undefined' ? null : (document as FsDoc));

/** 이 브라우저가 문서 전체 화면을 열 수 있는가(아이폰 Safari·막힌 iframe = false) */
export function fsSupported(): boolean {
  const d = doc();
  if (!d) return false;
  // 자동화 브라우저(Playwright·WebDriver)는 진짜 창을 전체 화면으로 키우면 창 크기 바꾸기가 막힌다(시험 기기 해상도 전환 실패).
  // 사람 기기에선 늘 false. U7 시험은 이 값을 false 로 흉내 낸 뒤 가짜 API 로 잰다
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
  const el = d.documentElement as FsEl;
  if (typeof el.requestFullscreen !== 'function' && typeof el.webkitRequestFullscreen !== 'function') return false;
  const enabled = d.fullscreenEnabled ?? d.webkitFullscreenEnabled;
  return enabled !== false;
}

export function isFullscreen(): boolean {
  const d = doc();
  return !!d && !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/** 홈 화면 앱(매니페스트 fullscreen/standalone · iOS 홈 화면)으로 열렸으면 이미 주소창이 없다 */
export function isStandalone(): boolean {
  if (typeof matchMedia !== 'function') return false;
  if (matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** 한 번이라도 전체 화면에 들어갔는가(나왔을 때만 다시 들어가기 간판을 보인다) */
let entered = false;
let pending = false;
const subs = new Set<() => void>();
const emit = () => { for (const f of subs) f(); };

function onChange() {
  if (isFullscreen()) entered = true;
  emit();
}
if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', onChange);
  document.addEventListener('webkitfullscreenchange', onChange);
}

function lockLandscape() {
  try {
    const o = (typeof screen !== 'undefined' ? screen.orientation : undefined) as Lockable | undefined;
    const p = o?.lock?.('landscape');
    if (p && typeof p.catch === 'function') p.catch(() => {}); // 데스크톱·아이패드·전체 화면 아님: 거부 = 무시
  } catch { /* 지원 안 함 */ }
}

/** 사용자 탭 안에서 부른다(요청은 await 전에 동기로 나간다). 성공 여부를 돌려주되, 실패해도 던지지 않는다 */
export async function enterFullscreen(): Promise<boolean> {
  if (pending || !fsSupported() || isStandalone()) return false;
  if (isFullscreen()) return true;
  const el = document.documentElement as FsEl;
  pending = true;
  try {
    const r = typeof el.requestFullscreen === 'function' ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
    await r;
  } catch {
    return false; // 거부(사용자 설정·정책·iframe) — 게임은 그대로
  } finally {
    pending = false;
  }
  if (isFullscreen()) entered = true;
  lockLandscape();
  emit();
  return true;
}

let armed = false;
let tried = false;
/** 첫 시도는 한 번만: 첫 탭 리스너(캡처)와 시작하기가 같은 탭에서 둘 다 불러도, 거부된 뒤 다시 조르지 않는다 */
export function tryFullscreenOnce() {
  if (tried) return;
  tried = true;
  void enterFullscreen();
}

/** 앱 시작 때 한 번: 첫 탭·첫 Enter 에서 전체 화면을 한 번만 시도한다(거부되면 다시 조르지 않는다) */
export function armFullscreenOnFirstGesture(target: Document = document) {
  if (armed) return;
  armed = true;
  const go = (e: Event) => {
    if (e.type === 'keydown' && !['Enter', ' '].includes((e as KeyboardEvent).key)) return;
    target.removeEventListener('click', go, true);
    target.removeEventListener('keydown', go, true);
    tryFullscreenOnce();
  };
  target.addEventListener('click', go, true);
  target.addEventListener('keydown', go, true);
}

/** 다시 들어가기 간판을 보일까: 지원 + 한 번 들어갔음 + 지금은 나와 있음 + 홈 화면 앱 아님 */
export function useFullscreenExited(): boolean {
  const calc = () => entered && fsSupported() && !isFullscreen() && !isStandalone();
  const [v, setV] = useState(calc);
  useEffect(() => {
    const f = () => setV(calc());
    subs.add(f);
    f();
    return () => { subs.delete(f); };
  }, []);
  return v;
}
