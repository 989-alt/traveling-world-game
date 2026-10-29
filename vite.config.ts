import { cpSync, mkdirSync, statSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

// 배포 에셋은 허용 목록으로만 복사한다: webp/*.webp, audio/*.mp3.
// publicDir 통째 복사는 assets/img(원본 PNG 747MB)·assets/prompts(.md)·versions.json·manifest.json 까지 dist 에 싣는다.
// (manifest.json 은 JS 에 번들되므로 dist 에 따로 둘 필요 없다.)
const copyAssets = (): Plugin => ({
  name: 'copy-assets-allowlist',
  apply: 'build',
  closeBundle() {
    for (const [dir, ext] of [['webp', '.webp'], ['audio', '.mp3']]) {
      mkdirSync(`dist/${dir}`, { recursive: true });
      cpSync(`assets/${dir}`, `dist/${dir}`, { recursive: true, filter: s => statSync(s).isDirectory() || s.endsWith(ext) });
    }
  },
});

export default defineConfig({
  plugins: [preact(), copyAssets()],
  // dev 서버는 assets/ 를 루트로 서빙(하네스 규칙). 빌드는 위 플러그인이 대신 복사.
  publicDir: 'assets',
  build: { copyPublicDir: false },
});
