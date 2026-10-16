import type { CertSummary } from './data';
import type { ProgressData } from './storage';

export interface CertProgress {
  lessonsDone: number;
  lessonsTotal: number;
  /** 一度でも正解した問題数 */
  mastered: number;
  questionsTotal: number;
  reviewCount: number;
  percent: number;
}

export function certProgress(cert: CertSummary, data: ProgressData, domainId?: string): CertProgress {
  const lessonDomains = domainId ? cert.lessonDomains.filter((d) => d === domainId) : cert.lessonDomains;
  const lessonsDone = lessonDomains.filter((d) => data.lessons[`${cert.id}/${d}`]).length;
  const qIds = cert.questions.filter((q) => !domainId || q.domain === domainId).map((q) => q.id);
  let mastered = 0;
  let reviewCount = 0;
  for (const id of qIds) {
    const s = data.questions[id];
    if (s && s.correct > 0) mastered++;
    if (s?.inReview) reviewCount++;
  }
  const total = lessonDomains.length + qIds.length;
  return {
    lessonsDone,
    lessonsTotal: lessonDomains.length,
    mastered,
    questionsTotal: qIds.length,
    reviewCount,
    percent: total === 0 ? 0 : Math.round(((lessonsDone + mastered) / total) * 100),
  };
}

export function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function readJson<T>(id: string): T {
  const el = document.getElementById(id);
  return JSON.parse(el?.textContent ?? 'null') as T;
}
