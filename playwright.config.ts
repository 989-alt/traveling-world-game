import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // 비결정적 흔들림은 1회만 다시 돌린다(T12). 두 번 실패하면 결함. 재시도 때 trace, 실패 때 스크린숏
  retries: 1,
  // 재시도로 통과한 시험(flaky)도 실행 실패로 친다: 흔들림을 숨기지 않는다
  failOnFlakyTests: true,
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1366, height: 768 }, trace: 'on-first-retry', screenshot: 'only-on-failure' },
  projects: [
    // 성능 측정·4인 가속 통합 시험은 다른 spec 과 CPU 를 나누면 흔들린다(T15 실측: 스로틀 기준 루프 15→36 ms, 가속 시계 shown 창 ≈150 ms).
    // 그래서 먼저 혼자(workers 1) 돌리고, desktop 이 그 뒤에 병렬로 돈다. --project=desktop 은 의존 프로젝트까지 함께 돈다
    { name: 'desktop-solo', testMatch: /(perf|full-lesson)\.spec\.ts$/, workers: 1 },
    { name: 'desktop', testIgnore: /(perf|full-lesson)\.spec\.ts$/, dependencies: ['desktop-solo'] }, // 기본: 1366×768 데스크톱 마우스
    { name: 'tablet-touch', use: { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: true,
  },
});
