// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages: https://pome-uniikura.github.io/sample/
export default defineConfig({
  site: 'https://pome-uniikura.github.io',
  base: '/sample',
  trailingSlash: 'always',
  markdown: {
    // ```mermaid のコードブロックは図としてブラウザで描画する
    syntaxHighlight: { type: 'shiki', excludeLangs: ['mermaid'] },
  },
});
