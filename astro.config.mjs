// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages: https://pome-uniikura.github.io/salesforce-learning-hub/
export default defineConfig({
  site: 'https://pome-uniikura.github.io',
  base: '/salesforce-learning-hub',
  trailingSlash: 'always',
  markdown: {
    // ```mermaid のコードブロックは図としてブラウザで描画する
    syntaxHighlight: { type: 'shiki', excludeLangs: ['mermaid'] },
  },
});
