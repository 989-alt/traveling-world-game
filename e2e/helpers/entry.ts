// 첫 화면(인트로 → 팝업, R2 C1~C4) 통과 도우미. 방 코드 입력 폼이 팝업 안으로 들어가서 시험마다 같은 길을 쓴다.
import type { Page } from '@playwright/test';

/** 인트로 '시작하기' → 팝업 1 '친구 방 들어가기' → 팝업 2a(코드 6칸) */
export async function openJoin(page: Page) {
  await page.locator('[data-act="intro-start"]').click();
  await page.locator('[data-act="to-join"]').click();
}

/** 인트로 '시작하기' → 팝업 1 '새 방 만들기' → 팝업 2b */
export async function openMake(page: Page) {
  await page.locator('[data-act="intro-start"]').click();
  await page.locator('[data-act="to-make"]').click();
}

/** 코드로 방에 들어간다(첫 칸에 6자를 넣으면 6칸에 나뉜다) */
export async function joinCode(page: Page, code: string) {
  await openJoin(page);
  await page.locator('#room-code').fill(code);
  await page.locator('[data-act="join"]').click();
}

/** 6칸에 들어 있는 코드 */
export const codeValue = (page: Page) => page.locator('.code-tile').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join(''));
