// ビルド後に実行する（npm run build の最後）。
// オフライン保存用の一覧 dist/precache.json を作り、dist/sw.js にビルド ID を書き込む。
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dist');
const config = readFileSync(join(root, 'astro.config.mjs'), 'utf8');
const base = `/${(config.match(/base:\s*'([^']*)'/)?.[1] ?? '').replace(/^\/|\/$/g, '')}/`.replace('//', '/');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const pages = [];
const assets = [];
let bytes = 0;
for (const file of walk(dist)) {
  const rel = relative(dist, file).split(sep).join('/');
  const size = statSync(file).size;
  if (rel.endsWith('index.html')) {
    pages.push(base + rel.replace(/index\.html$/, ''));
    bytes += size;
  } else if (rel.startsWith('_astro/') || rel.startsWith('icons/') || ['favicon.svg', 'manifest.webmanifest', 'apple-touch-icon.png'].includes(rel)) {
    assets.push(base + rel);
    bytes += size;
  }
}
pages.sort();
assets.sort();

const build = Date.now().toString(36);
writeFileSync(join(dist, 'precache.json'), JSON.stringify({ build, bytes, pages, assets }));
const swPath = join(dist, 'sw.js');
const sw = readFileSync(swPath, 'utf8');
if (!sw.includes("const BUILD = '__BUILD_ID__';")) throw new Error('sw.js にビルド ID の置き場所がありません');
writeFileSync(swPath, sw.replace("const BUILD = '__BUILD_ID__';", `const BUILD = '${build}';`));
console.log(`PWA: ページ ${pages.length} 件・ファイル ${assets.length} 件（${(bytes / 1024 / 1024).toFixed(1)} MB）を保存の一覧にしました`);
