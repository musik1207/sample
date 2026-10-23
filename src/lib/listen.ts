/**
 * レッスンの読み上げ（聞く）。
 * 端末に入っている日本語の音声（Web Speech API）で、本文を段落ごとに読み上げる。
 */
import { loadListenPrefs, type ListenPrefs } from './storage';

/** 読み上げの単位にする要素（いちばん内側のものだけ使う） */
const BLOCK_SELECTOR = 'h2, h3, h4, p, li, tr';
/** 1 回の発話の上限（長すぎると途中で止まるブラウザがある） */
const MAX_CHUNK = 140;

export interface Block {
  el: HTMLElement;
  chunks: string[];
  /** 属する章（h2）の見出し */
  section: string;
}

export function isListenSupported(): boolean {
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

/** 読み上げやすい文に直す（記号を言葉に、飾りを取り除く） */
export function normalizeForSpeech(text: string): string {
  return text
    .replace(/[✓✔☐☑🎉]/gu, '')
    .replace(/[→⇒➡←]/g, '、')
    .replace(/\s*[×✕]\s*/g, ' かける ')
    .replace(/\s*÷\s*/g, ' わる ')
    // 数字の前に詰めて書いた符号は「マイナス」「プラス」（例: −200 万円）
    .replace(/(^|[\s（(＝=、])[−-](?=\d)/g, '$1マイナス')
    .replace(/(^|[\s（(＝=、])[＋+](?=\d)/g, '$1プラス')
    .replace(/\s[−-]\s/g, ' ひく ')
    .replace(/\s[＋+]\s/g, ' たす ')
    // 式の中で詰めて書いた記号（例: (O+4M+P)/6、n(n−1)）
    .replace(/(?<=[A-Za-z0-9)）])[+＋](?=[A-Za-z0-9(（])/g, ' たす ')
    .replace(/(?<=[A-Za-z0-9)）])−(?=[A-Za-z0-9(（])/g, ' ひく ')
    .replace(/(?<=[A-Za-z0-9)）])\s*\/\s*(?=\d)/g, ' わる ')
    // 式の「＝」は「は」、文章の「＝」は「つまり」と読む
    .replace(/(?<=[A-Za-z0-9)）%])\s*[＝=]\s*|\s*[＝=]\s*(?=[A-Za-z0-9(（−-])/g, ' は ')
    .replace(/\s*[＝=]\s*/g, '、つまり、')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 文の切れ目で、長すぎない単位に分ける */
export function splitChunks(text: string): string[] {
  if (!text) return [];
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) ?? [text];
  const chunks: string[] = [];
  let buf = '';
  const push = (s: string) => {
    if (s.trim()) chunks.push(s.trim());
  };
  for (const s of sentences) {
    if ((buf + s).length <= MAX_CHUNK) {
      buf += s;
      continue;
    }
    push(buf);
    buf = '';
    if (s.length <= MAX_CHUNK) {
      buf = s;
      continue;
    }
    // 1 文が長いときは読点で分ける
    let part = '';
    for (const piece of s.split(/(?<=、)/)) {
      if ((part + piece).length > MAX_CHUNK) {
        push(part);
        part = '';
      }
      part += piece;
    }
    buf = part;
  }
  push(buf);
  return chunks;
}

function textOf(el: HTMLElement): string {
  if (el instanceof HTMLTableRowElement) {
    return [...el.cells]
      .map((c) => c.innerText.trim())
      .filter(Boolean)
      .join('、');
  }
  return el.innerText;
}

/** レッスン本文から、読み上げる段落の一覧を作る */
export function collectBlocks(root: HTMLElement): Block[] {
  let section = '';
  const blocks: Block[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    if (el.closest('figure, pre, .diagram-hint')) continue;
    if (el.querySelector(BLOCK_SELECTOR)) continue;
    if (el.tagName === 'H2') section = el.innerText.trim();
    const chunks = splitChunks(normalizeForSpeech(textOf(el)));
    if (chunks.length) blocks.push({ el, chunks, section });
  }
  return blocks;
}

/** 日本語の声の一覧（端末によっては読み込みに少し時間がかかる） */
export async function japaneseVoices(): Promise<SpeechSynthesisVoice[]> {
  const pick = () => speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith('ja'));
  let voices = pick();
  if (voices.length) return voices;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
  voices = pick();
  return voices;
}

export function chooseVoice(voices: SpeechSynthesisVoice[], name: string | null): SpeechSynthesisVoice | null {
  return voices.find((v) => v.name === name) ?? voices.find((v) => v.default) ?? voices[0] ?? null;
}

export interface ReaderEvents {
  /** 読んでいる段落・再生中かが変わった */
  onChange: (state: { index: number; total: number; playing: boolean; section: string; finished: boolean }) => void;
}

/** 段落ごとに読み上げ、読んでいる段落を強調する */
export class LessonReader {
  private blocks: Block[];
  private index = 0;
  private chunk = 0;
  private playing = false;
  private finished = false;
  /** 古い発話の終了通知を無視するための番号 */
  private generation = 0;
  private prefs: ListenPrefs = loadListenPrefs();
  private voice: SpeechSynthesisVoice | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private active: HTMLElement | null = null;

  constructor(
    root: HTMLElement,
    private events: ReaderEvents,
  ) {
    this.blocks = collectBlocks(root);
    japaneseVoices().then((voices) => {
      this.voice = chooseVoice(voices, this.prefs.voice);
    });
    // 画面を消す・別のアプリに切り替えると読み上げが止まるので、一時停止の状態にそろえる
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.playing) this.pause();
    });
  }

  get total(): number {
    return this.blocks.length;
  }

  get rate(): number {
    return this.prefs.rate;
  }

  /** 画面に見えている最初の段落の番号 */
  firstVisibleIndex(topOffset: number): number {
    const i = this.blocks.findIndex((b) => b.el.getBoundingClientRect().top >= topOffset);
    return i < 0 ? 0 : i;
  }

  /** 要素が属する段落の番号（なければ -1） */
  indexOf(target: Element): number {
    return this.blocks.findIndex((b) => b.el === target || b.el.contains(target));
  }

  play(from?: number): void {
    if (from !== undefined) {
      this.index = Math.max(0, Math.min(from, this.blocks.length - 1));
      this.chunk = 0;
    }
    if (this.finished) {
      this.index = 0;
      this.chunk = 0;
      this.finished = false;
    }
    this.playing = true;
    this.lock();
    this.restart();
  }

  pause(): void {
    this.playing = false;
    this.generation++;
    speechSynthesis.cancel();
    this.unlock();
    this.emit();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  next(): void {
    this.jump(this.index + 1);
  }

  prev(): void {
    // 段落の途中なら頭に戻り、頭ならひとつ前へ
    this.jump(this.chunk > 0 ? this.index : this.index - 1);
  }

  jump(index: number): void {
    if (index >= this.blocks.length) return this.finish();
    this.index = Math.max(0, index);
    this.chunk = 0;
    this.finished = false;
    if (this.playing) this.restart();
    else {
      this.highlight();
      this.emit();
    }
  }

  setRate(rate: number): void {
    this.prefs = { ...loadListenPrefs(), rate };
    if (this.playing) this.restart();
  }

  stop(): void {
    this.pause();
    this.active?.classList.remove('tts-active');
    this.active = null;
  }

  /** いまの段落の、いまの文から読み直す */
  private restart(): void {
    const gen = ++this.generation;
    speechSynthesis.cancel();
    // 止めた直後に話し始めると無視される端末があるので、少し待つ
    setTimeout(() => {
      if (gen === this.generation) this.speak(gen);
    }, 60);
  }

  private speak(gen: number): void {
    const block = this.blocks[this.index];
    if (!block) return this.finish();
    if (this.chunk === 0) this.highlight();
    this.emit();
    const u = new SpeechSynthesisUtterance(block.chunks[this.chunk]);
    u.lang = 'ja-JP';
    u.rate = this.prefs.rate;
    if (this.voice) u.voice = this.voice;
    const advance = () => {
      if (gen !== this.generation || !this.playing) return;
      if (this.chunk + 1 < block.chunks.length) this.chunk++;
      else {
        this.index++;
        this.chunk = 0;
      }
      if (this.index >= this.blocks.length) return this.finish();
      this.speak(gen);
    };
    u.onend = advance;
    u.onerror = (e) => {
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      advance();
    };
    speechSynthesis.speak(u);
  }

  private finish(): void {
    this.playing = false;
    this.finished = true;
    this.generation++;
    speechSynthesis.cancel();
    this.unlock();
    this.index = Math.max(0, this.blocks.length - 1);
    this.emit();
  }

  private highlight(): void {
    const el = this.blocks[this.index]?.el;
    if (!el || el === this.active) return;
    this.active?.classList.remove('tts-active');
    el.classList.add('tts-active');
    this.active = el;
    // 画面の外に出たら、読んでいる段落が見える位置まで送る
    const r = el.getBoundingClientRect();
    const player = document.getElementById('tts-player')?.getBoundingClientRect();
    const bottom = player ? player.top : window.innerHeight;
    if (r.top < 70 || r.bottom > bottom - 16) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  private emit(): void {
    this.events.onChange({
      index: this.index,
      total: this.blocks.length,
      playing: this.playing,
      section: this.blocks[this.index]?.section ?? '',
      finished: this.finished,
    });
  }

  private async lock(): Promise<void> {
    try {
      if ('wakeLock' in navigator && !this.wakeLock) this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      /* 画面を消さない設定ができない端末では何もしない */
    }
  }

  private unlock(): void {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }
}
