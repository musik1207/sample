// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages: https://musik1207.github.io/sample/
export default defineConfig({
  site: 'https://musik1207.github.io',
  base: '/sample',
  trailingSlash: 'always',
  markdown: {
    // ```mermaid のコードブロックは図としてブラウザで描画する
    syntaxHighlight: { type: 'shiki', excludeLangs: ['mermaid'] },
  },
});
