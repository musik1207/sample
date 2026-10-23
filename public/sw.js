/*
 * オフライン対応のサービスワーカー
 *
 * - ページ（HTML）: ネットワークを優先し、常に最新を表示する。圏外や遅いときは保存済みのページを出す
 * - _astro/ のファイル: 名前にハッシュが付いていて中身が変わらないので、保存済みを優先する
 * - そのほか（アイコンなど）: 保存済みをすぐ返し、裏で更新する
 * - 設定ページの「オフライン用に保存」で、全ページと全ファイルをまとめて保存できる
 *
 * __BUILD_ID__ はビルド後に scripts/pwa-manifest.mjs が置き換える。
 * 中身が変わることで、デプロイのたびに新しいサービスワーカーに切り替わる。
 */
const BUILD = '__BUILD_ID__';
const PAGES = 'pages-v1';
const ASSETS = 'assets-v1';
const META = 'meta-v1';
const BASE = new URL(self.registration.scope).pathname;
const FLAG_KEY = `${BASE}__offline-all`;
const MAX_ASSETS = 400;
const NETWORK_TIMEOUT_MS = 4000;
// サーバーが Vary を付けても、保存したファイルを見つけられるようにする
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await putPage(await caches.open(PAGES), BASE);
      } catch {
        /* 圏外でのインストールは、ページの保存だけ諦める */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      // 「オフライン用に保存」済みなら、新しい版の教材を裏で保存し直す
      const flag = await readFlag();
      if (flag && flag.build !== BUILD) saveAll(null).catch(() => {});
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  if (url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/precache.json')) return;

  // waitUntil はイベントを受けたその場で呼ぶ（非同期の途中で呼ぶと失敗するブラウザがある）
  if (req.mode === 'navigate') {
    const network = caches.open(PAGES).then((cache) => putPage(cache, req.url));
    event.waitUntil(network.catch(() => {}));
    event.respondWith(handlePage(req, network));
  } else if (url.pathname.startsWith(`${BASE}_astro/`)) {
    event.respondWith(cacheFirst(req));
  } else {
    const network = fetch(req).then(async (res) => {
      if (res.ok) await (await caches.open(ASSETS)).put(req, res.clone());
      return res;
    });
    event.waitUntil(network.catch(() => {}));
    event.respondWith(staleWhileRevalidate(req, network));
  }
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  const port = event.ports && event.ports[0];
  const reply = (data) => port && port.postMessage(data);
  if (msg.type === 'cache-urls') event.waitUntil(cacheUrls(msg.urls || []));
  else if (msg.type === 'save-all') event.waitUntil(saveAll(reply).catch((err) => reply({ type: 'error', message: String(err) })));
  else if (msg.type === 'status') event.waitUntil(getStatus().then(reply));
  else if (msg.type === 'clear') event.waitUntil(clearAll().then(() => reply({ type: 'cleared' })));
});

/** クエリとハッシュを外した、ページの保存キー */
function pageKey(input) {
  const u = new URL(input, self.location.origin);
  u.search = '';
  u.hash = '';
  return u.href;
}

async function fetchPage(url) {
  // ETag で確かめてから使うので、デプロイ後もすぐ新しいページになる
  const res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
  if (!res.redirected) return res;
  // GitHub Pages の「末尾に / を付ける転送」を経た応答は、そのままでは画面遷移に返せないので作り直す
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function putPage(cache, url) {
  const res = await fetchPage(url);
  if (res.ok) await cache.put(pageKey(url), res.clone());
  return res;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function handlePage(req, network) {
  const cached = await (await caches.open(PAGES)).match(pageKey(req.url), MATCH);
  try {
    // 保存済みがあれば、待ちすぎずに保存済みへ切り替える（裏では最新を取りに行き続ける）
    return await (cached ? withTimeout(network, NETWORK_TIMEOUT_MS) : network);
  } catch {
    if (cached) return cached;
    return offlinePage();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req, MATCH);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    trim(cache);
  }
  return res;
}

async function staleWhileRevalidate(req, network) {
  const hit = await (await caches.open(ASSETS)).match(req, MATCH);
  return hit || network;
}

/** 古いファイルから消して、保存の量を一定に保つ */
async function trim(cache) {
  const flag = await readFlag();
  if (flag) return; // すべて保存しているときは消さない
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
}

/** 初めて開いたページで、すでに読み込んだファイルを保存する */
async function cacheUrls(urls) {
  const pages = await caches.open(PAGES);
  const assets = await caches.open(ASSETS);
  for (const raw of urls) {
    try {
      const u = new URL(raw);
      if (u.origin !== self.location.origin || !u.pathname.startsWith(BASE)) continue;
      if (u.pathname.endsWith('/')) await putPage(pages, u.href);
      else if (!(await assets.match(u.href, MATCH))) {
        const res = await fetch(u.href);
        if (res.ok) await assets.put(u.href, res);
      }
    } catch {
      /* 1 つ失敗しても続ける */
    }
  }
}

/** 全ページと全ファイルを保存する（設定ページから） */
async function saveAll(reply) {
  const res = await fetch(`${BASE}precache.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error('保存する一覧を取得できませんでした');
  const list = await res.json();
  const pages = await caches.open(PAGES);
  const assets = await caches.open(ASSETS);
  const jobs = [...list.pages.map((p) => ['page', p]), ...list.assets.map((a) => ['asset', a])];
  const total = jobs.length;
  let done = 0;
  let failed = 0;
  const worker = async () => {
    while (jobs.length) {
      const [kind, path] = jobs.shift();
      const url = new URL(path, self.location.origin).href;
      try {
        if (kind === 'page') {
          const r = await putPage(pages, url);
          if (!r.ok) failed++;
        } else if (!(await assets.match(url, MATCH))) {
          const r = await fetch(url);
          if (r.ok) await assets.put(url, r);
          else failed++;
        }
      } catch {
        failed++;
      }
      done++;
      if (reply && (done % 5 === 0 || done === total)) reply({ type: 'progress', done, total });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await writeFlag({ build: list.build, savedAt: new Date().toISOString(), bytes: list.bytes, failed });
  if (reply) reply({ type: 'done', total, failed, bytes: list.bytes });
}

async function getStatus() {
  const pages = await (await caches.open(PAGES)).keys();
  const flag = await readFlag();
  return { type: 'status', pages: pages.length, saved: Boolean(flag), savedAt: flag ? flag.savedAt : null, upToDate: Boolean(flag && flag.build === BUILD) };
}

async function clearAll() {
  await Promise.all([caches.delete(PAGES), caches.delete(ASSETS), caches.delete(META)]);
}

async function readFlag() {
  const hit = await (await caches.open(META)).match(FLAG_KEY, MATCH);
  return hit ? hit.json() : null;
}

async function writeFlag(data) {
  await (await caches.open(META)).put(FLAG_KEY, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }));
}

function offlinePage() {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>オフラインです</title>
<style>body{margin:0;font-family:system-ui,-apple-system,'Hiragino Sans',sans-serif;background:#f5f6f8;color:#16202c;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box;text-align:center;line-height:1.7}
@media (prefers-color-scheme:dark){body{background:#0f141a;color:#e6ebf1}a{color:#5aa2f0}}
a{color:#0b5cab;font-weight:700}</style></head>
<body><main><h1 style="font-size:1.3rem">オフラインです</h1><p>このページはまだ端末に保存されていません。<br>電波のある場所でもう一度開いてください。</p>
<p>設定ページの「オフライン用に保存」を使うと、全ページを保存できます。</p><p><a href="${BASE}">ロードマップへ戻る</a></p></main></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
