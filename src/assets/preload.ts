import { assetUrl, warnOnce } from './manifest';

const done = new Map<string, Promise<boolean>>();
const ok = new Set<string>();
/** 이미 받아 둔 키인가(동기) — 받는 중 화면을 띄울지 첫 렌더에서 정할 때 */
export const isLoaded = (keys: string[]) => keys.every((k) => ok.has(k));
type ImgCtor = new () => { src: string; onload: (() => void) | null; onerror: (() => void) | null; decode?: () => Promise<void> };

/** 키들을 사용 직전에 받아(디코드까지) 둔다. 실패해도 reject 하지 않고(경고 1회) false. 같은 키는 한 번만 요청. */
export function preload(keys: string[], Img: ImgCtor = Image as unknown as ImgCtor): Promise<boolean[]> {
  return Promise.all(keys.map(key => {
    const hit = done.get(key);
    if (hit) return hit;
    const url = assetUrl(key);
    const p = new Promise<boolean>(res => {
      if (!url) return res(false);
      const img = new Img();
      // 받은 뒤 디코드까지 끝나야 '받음'(U5): 판을 여는 시점에 칸 그림이 아직 디코드 중이면 빈 칸으로 한 프레임 이상 보인다
      img.onload = () => { const fin = () => { ok.add(key); res(true); }; img.decode ? img.decode().then(fin, fin) : fin(); };
      img.onerror = () => { warnOnce(key, `로드 실패 ${url}`); done.delete(key); res(false); }; // 실패는 지워서 다시 시도 가능
      img.src = url;
    });
    done.set(key, p);
    return p;
  }));
}

