// U5 회귀(orchestrator 리뷰): 칸 그림이 DOM 에선 받아졌는데 화면에 안 칠해지는 경우까지 잡는 검사(u5-layout·u5-bugs 공용).
import type { Page } from '@playwright/test';

/** 30칸이 실제로 화면에 그려졌나: 배경을 마젠타로 바꿔 찍고 칸마다 윗면 가운데(상자 15~85% × 15~60%)의 마젠타 비율을 잰다.
 *  DOM(img.complete·naturalWidth)만으로는 못 잡는 '그림은 받았는데 안 칠해진' 칸까지 잡는다(U5 board.png 8·9·10 빠짐) */
export async function paintedTiles(page: Page) {
  const boxes = await page.evaluate(() => {
    const sr = document.querySelector('.board-stage')!.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>('.tile')].map((el) => {
      const r = el.getBoundingClientRect(), i = el.querySelector('img');
      return { t: +el.dataset.tile!, x: r.x, y: r.y, w: r.width, h: r.height, nw: i?.naturalWidth ?? 0, done: !!i?.complete,
        inside: r.x >= sr.x - 2 && r.y >= sr.y - 2 && r.x + r.width <= sr.x + sr.width + 2 && r.y + r.height <= sr.y + sr.height + 2,
        vis: !!i && getComputedStyle(i).visibility !== 'hidden' && +getComputedStyle(el).opacity > 0.9 };
    });
  });
  await page.evaluate(() => {
    (document.querySelector('.board-bg') as HTMLElement).style.visibility = 'hidden';
    (document.querySelector('.board-root') as HTMLElement).style.background = '#ff00ff';
  });
  const png = await page.screenshot();
  await page.evaluate(() => {
    (document.querySelector('.board-bg') as HTMLElement).style.visibility = '';
    (document.querySelector('.board-root') as HTMLElement).style.background = '';
  });
  const dpr = await page.evaluate(() => devicePixelRatio);
  const mag = await page.evaluate(async ([b64, boxes, dpr]) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const c = cv.getContext('2d')!; c.drawImage(img, 0, 0);
    return (boxes as { x: number; y: number; w: number; h: number }[]).map((b) => {
      const x0 = Math.round((b.x + 0.15 * b.w) * (dpr as number)), x1 = Math.round((b.x + 0.85 * b.w) * (dpr as number));
      const y0 = Math.round((b.y + 0.15 * b.h) * (dpr as number)), y1 = Math.round((b.y + 0.6 * b.h) * (dpr as number));
      const d = c.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] < 40 && d[i + 2] > 230) n++;
      return n / (d.length / 4);
    });
  }, [png.toString('base64'), boxes, dpr] as const);
  return boxes.map((b, i) => ({ ...b, magenta: mag[i] }));
}

