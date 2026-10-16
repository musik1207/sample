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
  };
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
    if (done) d.lessons[key] = new Date().toISOString();
    else delete d.lessons[key];
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
