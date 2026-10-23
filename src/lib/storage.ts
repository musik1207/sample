/**
 * 学習記録の保存処理。
 *
 * 画面側は必ずこのモジュール経由で読み書きする。
 * 社内公開版ではアダプタを API（サーバー保存）に差し替える想定。
 */

export const SCHEMA_VERSION = 1;
const STORAGE_KEY = 'sf-cert-study:v1';

export interface QuestionStat {
  attempts: number;
  correct: number;
  /** 直近の結果 */
  last: boolean;
  /** 連続正解数 */
  streak: number;
  lastAt: string;
  /** 復習リストに入っているか */
  inReview: boolean;
}

export interface MockResult {
  certId: string;
  date: string;
  score: number;
  total: number;
  durationSec: number;
  byDomain: Record<string, { correct: number; total: number }>;
}

export interface CertPlan {
  targetDate?: string;
  passedDate?: string;
}

export interface ProgressData {
  version: number;
  updatedAt: string;
  /** key: `${certId}/${domainId}` → 読了日時 */
  lessons: Record<string, string>;
  questions: Record<string, QuestionStat>;
  mocks: MockResult[];
  plans: Record<string, CertPlan>;
  /** 日付（YYYY-MM-DD、端末の時刻）→ その日に回答した問題と読了したレッスンの数 */
  activity: Record<string, number>;
}

export interface StorageAdapter {
  load(): ProgressData | null;
  save(data: ProgressData): void;
  clear(): void;
}

/** 復習リストから外すのに必要な連続正解数 */
export const REVIEW_CLEAR_STREAK = 2;

export function emptyProgress(): ProgressData {
  return {
    version: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    lessons: {},
    questions: {},
    mocks: [],
    plans: {},
    activity: {},
  };
}

class LocalStorageAdapter implements StorageAdapter {
  load(): ProgressData | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as ProgressData) : null;
    } catch {
      return null;
    }
  }
  save(data: ProgressData): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // 保存できない環境（プライベートブラウズ等）では記録を諦める
    }
  }
  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  }
}

let adapter: StorageAdapter = new LocalStorageAdapter();

/** 保存先を差し替える（社内版でサーバー保存にするときに使う） */
export function setStorageAdapter(next: StorageAdapter): void {
  adapter = next;
}

export function loadProgress(): ProgressData {
  const data = adapter.load();
  if (!data || typeof data !== 'object') return emptyProgress();
  return normalize(data);
}

function normalize(data: Partial<ProgressData>): ProgressData {
  const base = emptyProgress();
  return {
    version: SCHEMA_VERSION,
    updatedAt: data.updatedAt ?? base.updatedAt,
    lessons: data.lessons ?? {},
    questions: data.questions ?? {},
    mocks: Array.isArray(data.mocks) ? data.mocks : [],
    plans: data.plans ?? {},
    activity: data.activity ?? {},
  };
}

/** 端末の時刻での今日の日付（YYYY-MM-DD） */
export function todayKey(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function countActivity(d: ProgressData): void {
  const key = todayKey();
  d.activity[key] = (d.activity[key] ?? 0) + 1;
}

function update(mutator: (d: ProgressData) => void): ProgressData {
  const data = loadProgress();
  mutator(data);
  data.updatedAt = new Date().toISOString();
  adapter.save(data);
  return data;
}

export function setLessonDone(certId: string, domainId: string, done: boolean): void {
  update((d) => {
    const key = `${certId}/${domainId}`;
    if (done) {
      if (!d.lessons[key]) countActivity(d);
      d.lessons[key] = new Date().toISOString();
    } else delete d.lessons[key];
  });
}

export function isLessonDone(data: ProgressData, certId: string, domainId: string): boolean {
  return Boolean(data.lessons[`${certId}/${domainId}`]);
}

export function recordAnswer(questionId: string, correct: boolean): QuestionStat {
  let result!: QuestionStat;
  update((d) => {
    const prev = d.questions[questionId];
    const streak = correct ? (prev?.streak ?? 0) + 1 : 0;
    let inReview = prev?.inReview ?? false;
    if (!correct) inReview = true;
    else if (inReview && streak >= REVIEW_CLEAR_STREAK) inReview = false;
    result = {
      attempts: (prev?.attempts ?? 0) + 1,
      correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
      last: correct,
      streak,
      lastAt: new Date().toISOString(),
      inReview,
    };
    d.questions[questionId] = result;
    countActivity(d);
  });
  return result;
}

export function addMockResult(result: MockResult): void {
  update((d) => {
    d.mocks.push(result);
  });
}

export function setPlan(certId: string, plan: CertPlan): void {
  update((d) => {
    d.plans[certId] = { ...d.plans[certId], ...plan };
    const p = d.plans[certId];
    if (!p.targetDate) delete p.targetDate;
    if (!p.passedDate) delete p.passedDate;
  });
}

export function exportProgress(): string {
  return JSON.stringify(loadProgress(), null, 2);
}

/** 書き出したファイルを読み込む。形式が違えば例外を投げる */
export function importProgress(json: string): ProgressData {
  const parsed = JSON.parse(json) as Partial<ProgressData>;
  if (!parsed || typeof parsed !== 'object' || typeof parsed.version !== 'number') {
    throw new Error('学習記録のファイルではありません');
  }
  if (parsed.version > SCHEMA_VERSION) {
    throw new Error('新しい形式のファイルのため読み込めません');
  }
  const data = normalize(parsed);
  adapter.save(data);
  return data;
}

export function resetProgress(): void {
  adapter.clear();
}

/*
 * 端末ごとの設定（表示とレッスンの読みかけ位置）。
 * 学習記録とは別に保存し、書き出しの対象にもしない。
 */

const PREFS_KEY = 'sf-cert-study:prefs';
const READING_KEY = 'sf-cert-study:reading';

export interface DisplayPrefs {
  theme: 'auto' | 'light' | 'dark';
  size: 'normal' | 'large';
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 保存できない環境では諦める */
  }
}

export function loadPrefs(): DisplayPrefs {
  return readLocal<DisplayPrefs>(PREFS_KEY, { theme: 'auto', size: 'normal' });
}

/** 設定を保存して、すぐに画面へ反映する */
export function savePrefs(prefs: DisplayPrefs): void {
  writeLocal(PREFS_KEY, prefs);
  const root = document.documentElement;
  if (prefs.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = prefs.theme;
  if (prefs.size === 'normal') delete root.dataset.size;
  else root.dataset.size = prefs.size;
  // ステータスバー（ホーム画面のアプリ）などの色も合わせる
  const colors = { light: '#ffffff', dark: '#161d25' };
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const scheme = m.media.includes('dark') ? 'dark' : 'light';
    m.content = colors[prefs.theme === 'auto' ? scheme : prefs.theme];
  });
}

export interface ReadingPos {
  /** 最後に読んでいた見出しの ID */
  heading: string;
  /** その見出しの文字 */
  label: string;
  at: string;
}

type ReadingMap = Record<string, ReadingPos>;

export function getReadingPos(lessonKey: string): ReadingPos | null {
  return readLocal<ReadingMap>(READING_KEY, {})[lessonKey] ?? null;
}

export function setReadingPos(lessonKey: string, pos: ReadingPos | null): void {
  const map = readLocal<ReadingMap>(READING_KEY, {});
  if (pos) map[lessonKey] = pos;
  else delete map[lessonKey];
  writeLocal(READING_KEY, map);
}

/** 読み上げの設定（端末ごと） */
const LISTEN_KEY = 'sf-cert-study:listen';

export interface ListenPrefs {
  /** 速さ（1 が標準） */
  rate: number;
  /** 声の名前。null なら端末の標準の日本語の声 */
  voice: string | null;
}

export function loadListenPrefs(): ListenPrefs {
  return readLocal<ListenPrefs>(LISTEN_KEY, { rate: 1, voice: null });
}

export function saveListenPrefs(prefs: ListenPrefs): void {
  writeLocal(LISTEN_KEY, prefs);
}
