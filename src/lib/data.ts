import certData from '../data/certs.json';
import glossaryData from '../data/glossary.json';
import type { Cert, GlossaryTerm, Question, QuizQuestion, Step } from './types';

export const steps = certData.steps as Step[];
export const certs = (certData.certs as Cert[]).slice().sort((a, b) => a.step - b.step || a.order - b.order);
export const glossary = glossaryData as GlossaryTerm[];

const questionModules = import.meta.glob<{ default: Question[] }>('../data/questions/*.json', { eager: true });

const questionsByCert: Record<string, Question[]> = {};
for (const [path, mod] of Object.entries(questionModules)) {
  const id = path.split('/').pop()!.replace(/\.json$/, '');
  questionsByCert[id] = mod.default;
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
    name: c.name,
    status: c.status,
    suggestedTarget: c.suggestedTarget ?? null,
    domains: c.domains.map((d) => ({ id: d.id, name: d.name, weight: d.weight })),
    questions: getQuestions(c.id).map((q) => ({ id: q.id, domain: q.domain })),
    lessonDomains: c.domains.map((d) => d.id).filter((d) => lessonKeys.has(`${c.id}/${d}`)),
  }));
}

export type CertSummary = ReturnType<typeof certSummaries>[number];
