import certData from '../data/certs.json';
import glossaryData from '../data/glossary.json';
import type { CaseStudy, Cert, GlossaryTerm, Question, QuizQuestion, Step } from './types';

export const steps = certData.steps as Step[];
export const certs = (certData.certs as Cert[]).slice().sort((a, b) => a.step - b.step || a.order - b.order);
export const glossary = glossaryData as GlossaryTerm[];

const questionModules = import.meta.glob<{ default: Question[] }>('../data/questions/*.json', { eager: true });

const questionsByCert: Record<string, Question[]> = {};
for (const [path, mod] of Object.entries(questionModules)) {
  const id = path.split('/').pop()!.replace(/\.json$/, '');
  questionsByCert[id] = mod.default;
}

/** 画面に出す資格名 */
export function displayName(cert: Pick<Cert, 'name' | 'shortName'>): string {
  return cert.shortName ?? cert.name.replace('Salesforce Certified ', '');
}

/** 苦手判定や模擬試験の判定に使う基準（合格ライン、なければ目安） */
export function scoreLine(cert: Cert): { value: number; label: string } {
  if (cert.exam.passingScore !== null) return { value: cert.exam.passingScore, label: '合格ライン' };
  return { value: cert.exam.targetScore ?? 65, label: '目安' };
}

const caseModules = import.meta.glob<{ default: CaseStudy[] }>('../data/cases/*.json', { eager: true });
const casesByCert: Record<string, CaseStudy[]> = {};
for (const [path, mod] of Object.entries(caseModules)) {
  casesByCert[path.split('/').pop()!.replace(/\.json$/, '')] = mod.default;
}

/** 資格の事例（ケース）問題の本文（ID → 事例） */
export function getCases(certId: string): Record<string, CaseStudy> {
  return Object.fromEntries((casesByCert[certId] ?? []).map((c) => [c.id, c]));
}

/** 出題目標の「タスク N 名前: 説明」から、タスクの名前を取り出す（タスクがない資格は空） */
export function taskLabels(objectives: string[] | undefined): string[] {
  if (!objectives?.length || !objectives.every((o) => /^タスク \d+ /.test(o))) return [];
  return objectives.map((o) => o.split(':')[0].trim());
}

export function getCert(id: string): Cert | undefined {
  return certs.find((c) => c.id === id);
}

export function getQuestions(certId: string): QuizQuestion[] {
  return (questionsByCert[certId] ?? []).map((q) => ({ ...q, certId }));
}

export function getAllQuestions(): QuizQuestion[] {
  return certs.flatMap((c) => getQuestions(c.id));
}

/** ページのリンクに base を付ける */
export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const clean = path.replace(/^\//, '');
  return `${base}/${clean}`;
}

/** レッスンがある「資格/範囲」の一覧 */
export async function getLessonKeys(): Promise<Set<string>> {
  const { getCollection } = await import('astro:content');
  const lessons = await getCollection('lessons');
  return new Set(lessons.map((l) => `${l.data.cert}/${l.data.domain}`));
}

/** クライアントのスクリプトに渡す、資格の要約 */
export function certSummaries(lessonKeys: Set<string>) {
  return certs.map((c) => ({
    id: c.id,
    name: displayName(c),
    status: c.status,
    suggestedTarget: c.suggestedTarget ?? null,
    studyHours: c.study?.hours ?? null,
    domains: c.domains.map((d) => ({
      id: d.id,
      name: d.name,
      weight: d.weight,
      hours: domainStudyHours(c, d.id),
      tasks: taskLabels(d.objectives),
    })),
    questions: getQuestions(c.id).map((q) => ({ id: q.id, domain: q.domain, task: q.task ?? null })),
    lessonDomains: c.domains.map((d) => d.id).filter((d) => lessonKeys.has(`${c.id}/${d}`)),
  }));
}

export type CertSummary = ReturnType<typeof certSummaries>[number];

/** 練習問題 1 問あたりの時間（回答と解説を読む時間、分） */
export const MINUTES_PER_QUESTION = 1.5;

/** 0.5 時間単位に丸める（最低 0.5 時間） */
export function roundHours(h: number): number {
  return Math.max(0.5, Math.round(h * 2) / 2);
}

/** 時間の表示（例: 1.5 → 「1.5 時間」、0.5 → 「30 分」） */
export function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} 分`;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} 時間`;
}

/** 範囲の学習時間の目安（資格の合計時間 × 配点） */
export function domainStudyHours(cert: Cert, domainId: string): number | null {
  const total = cert.study?.hours;
  const weight = cert.domains.find((d) => d.id === domainId)?.weight;
  if (!total || weight == null) return null;
  return roundHours((total * weight) / 100);
}

export interface LessonStats {
  /** レッスンを読む時間（分）。日本語はおよそ 1 分 500 文字 */
  readMinutes: number;
  /** 「やってみよう（N 分）」の合計（分） */
  handsOnMinutes: number;
}

/** レッスン本文から読む時間とハンズオンの時間を見積もる */
export function lessonStats(body: string): LessonStats {
  const readMinutes = Math.max(1, Math.round(body.replace(/```mermaid[\s\S]*?```/g, '').length / 500));
  let handsOnMinutes = 0;
  for (const m of body.matchAll(/やってみよう（[^）]*?(\d+)\s*分/g)) handsOnMinutes += Number(m[1]);
  return { readMinutes, handsOnMinutes };
}

/** 「資格/範囲」ごとのレッスンの見積もり */
export async function getLessonStats(): Promise<Map<string, LessonStats>> {
  const { getCollection } = await import('astro:content');
  const lessons = await getCollection('lessons');
  return new Map(lessons.map((l) => [`${l.data.cert}/${l.data.domain}`, lessonStats(l.body ?? '')]));
}

/** 範囲ごとの学習時間の内訳（このサイトの教材の分） */
export function domainBreakdown(cert: Cert, domainId: string, stats?: LessonStats) {
  const questions = getQuestions(cert.id).filter((q) => q.domain === domainId).length;
  const practiceMinutes = Math.round(questions * MINUTES_PER_QUESTION);
  const siteMinutes = (stats?.readMinutes ?? 0) + (stats?.handsOnMinutes ?? 0) + practiceMinutes;
  const totalHours = domainStudyHours(cert, domainId);
  return {
    totalHours,
    readMinutes: stats?.readMinutes ?? 0,
    handsOnMinutes: stats?.handsOnMinutes ?? 0,
    questions,
    practiceMinutes,
    siteMinutes,
    /** 復習・公式教材・実務での練習に使う残りの時間（分） */
    otherMinutes: totalHours === null ? null : Math.max(0, Math.round(totalHours * 60 - siteMinutes)),
  };
}
