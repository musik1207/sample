/**
 * ホーム画面のアプリ（Web アプリ）としての動き。
 * サービスワーカーの登録と、オフライン保存の操作をまとめる。
 */

const BASE = import.meta.env.BASE_URL;

/** ホーム画面から開いているか */
export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  // iPad は Mac と同じ表示になることがあるので、タッチ操作できるかも見る
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** サービスワーカーを登録する（本番のビルドだけ） */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', async () => {
    try {
      const firstTime = !navigator.serviceWorker.controller;
      await navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE });
      if (firstTime) {
        // 初めてのときは、このページがすでに読み込んだファイルも保存してもらう
        const reg = await navigator.serviceWorker.ready;
        const urls = [location.href, ...performance.getEntriesByType('resource').map((e) => e.name)].filter((u) =>
          u.startsWith(location.origin + BASE),
        );
        reg.active?.postMessage({ type: 'cache-urls', urls });
      }
    } catch {
      /* 登録できない環境（プライベートブラウズなど）では何もしない */
    }
    // ホーム画面のアプリでは、学習記録が消されにくくなるよう保存の継続を頼む
    if (isStandalone()) navigator.storage?.persist?.().catch(() => {});
  });
}

export interface OfflineStatus {
  pages: number;
  saved: boolean;
  savedAt: string | null;
  upToDate: boolean;
}

type SwMessage =
  | ({ type: 'status' } & OfflineStatus)
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; total: number; failed: number; bytes: number }
  | { type: 'error'; message: string }
  | { type: 'cleared' };

async function activeWorker(): Promise<ServiceWorker | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration(BASE);
  return reg?.active ?? null;
}

/** サービスワーカーに頼みごとをし、返事を受け取る */
async function ask(type: string, onMessage: (msg: SwMessage) => boolean): Promise<void> {
  const sw = await activeWorker();
  if (!sw) throw new Error('この端末ではオフライン保存を使えません');
  const channel = new MessageChannel();
  await new Promise<void>((resolve, reject) => {
    channel.port1.onmessage = (e: MessageEvent<SwMessage>) => {
      if (e.data.type === 'error') reject(new Error(e.data.message));
      else if (onMessage(e.data)) resolve();
    };
    sw.postMessage({ type }, [channel.port2]);
  });
  channel.port1.close();
}

export async function offlineStatus(): Promise<OfflineStatus | null> {
  let result: OfflineStatus | null = null;
  try {
    await ask('status', (msg) => {
      if (msg.type === 'status') result = msg;
      return true;
    });
  } catch {
    return null;
  }
  return result;
}

export async function saveAllForOffline(onProgress: (done: number, total: number) => void): Promise<{ failed: number; bytes: number }> {
  let result = { failed: 0, bytes: 0 };
  await ask('save-all', (msg) => {
    if (msg.type === 'progress') onProgress(msg.done, msg.total);
    if (msg.type === 'done') {
      result = { failed: msg.failed, bytes: msg.bytes };
      return true;
    }
    return false;
  });
  return result;
}

export async function clearOffline(): Promise<void> {
  await ask('clear', (msg) => msg.type === 'cleared');
}
