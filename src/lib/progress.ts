import type { CertSummary } from './data';
import { isDue, type ProgressData } from './storage';

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

/** 「あと N 日」「N 日超過」の表示 */
export function daysLabel(days: number): string {
  if (days > 0) return `あと ${days} 日`;
  if (days === 0) return '今日';
  return `${-days} 日超過`;
}

/** 連続して学習した日数と、今日の学習量 */
export function studyStreak(activity: Record<string, number>, now = new Date()): { streak: number; today: number } {
  const key = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const day = new Date(now);
  const today = activity[key(day)] ?? 0;
  // 今日まだ学習していなくても、昨日までの連続は途切れていない扱いにする
  if (!today) day.setDate(day.getDate() - 1);
  let streak = 0;
  while ((activity[key(day)] ?? 0) > 0) {
    streak++;
    day.setDate(day.getDate() - 1);
  }
  return { streak, today };
}

/** 受験目標日までのペース（残りの学習時間は進み具合で減らす） */
export function paceText(studyHours: number | null, percent: number, daysLeft: number): string {
  if (!studyHours || daysLeft <= 0) return '';
  const remaining = (studyHours * (100 - percent)) / 100;
  if (remaining <= 0) return '学習の目安時間をこなしました。模擬試験で仕上げましょう。';
  const perDay = Math.ceil((remaining * 60) / daysLeft / 5) * 5;
  return `残り約 ${Math.round(remaining)} 時間。1 日あたり約 ${perDay} 分のペースです。`;
}

export interface DomainAccuracy {
  /** 一度でも解いた問題数 */
  answered: number;
  /** 直近の回答が正解だった問題数 */
  lastCorrect: number;
  /** 正答率（%）。解いた問題がなければ null */
  rate: number | null;
}

/** 範囲ごとの正答率（各問題の直近の回答で数える） */
export function domainAccuracy(cert: CertSummary, data: ProgressData, domainId: string): DomainAccuracy {
  let answered = 0;
  let lastCorrect = 0;
  for (const q of cert.questions) {
    if (q.domain !== domainId) continue;
    const s = data.questions[q.id];
    if (!s) continue;
    answered++;
    if (s.last) lastCorrect++;
  }
  return { answered, lastCorrect, rate: answered ? Math.round((lastCorrect / answered) * 100) : null };
}

/** 苦手な範囲: 5 問以上解いて、正答率が基準（合格ラインか目安）に届いていない範囲（低い順） */
export function weakDomains(cert: CertSummary, data: ProgressData, line: number) {
  return cert.domains
    .map((d) => ({ ...d, acc: domainAccuracy(cert, data, d.id) }))
    .filter((d) => d.acc.answered >= 5 && d.acc.rate !== null && d.acc.rate < line)
    .sort((a, b) => a.acc.rate! - b.acc.rate!);
}

export interface NextAction {
  label: string;
  href: string;
  /** 補足（例: 前回の続き） */
  note?: string;
}

/** 資格で次にやること（未読のレッスン → 練習問題 → 模擬試験） */
export function nextAction(cert: CertSummary, data: ProgressData, base: string): NextAction | null {
  const domainName = (id: string) => cert.domains.find((d) => d.id === id)?.name ?? id;
  const unread = cert.lessonDomains.find((d) => !data.lessons[`${cert.id}/${d}`]);
  if (unread) return { label: `レッスンを読む: ${domainName(unread)}`, href: `${base}/certs/${cert.id}/${unread}/` };
  const p = certProgress(cert, data);
  if (p.mastered < p.questionsTotal) {
    // まだ正解していない問題が多い範囲から
    const domain = cert.domains
      .map((d) => {
        const ids = cert.questions.filter((q) => q.domain === d.id).map((q) => q.id);
        return { id: d.id, left: ids.filter((id) => !(data.questions[id]?.correct > 0)).length };
      })
      .sort((a, b) => b.left - a.left)[0];
    return { label: `練習問題: ${domainName(domain.id)}`, href: `${base}/certs/${cert.id}/quiz/?domain=${domain.id}` };
  }
  if (p.questionsTotal > 0) return { label: '模擬試験に挑戦', href: `${base}/certs/${cert.id}/quiz/?mode=mock` };
  return null;
}

export interface UnitAccuracy {
  domainId: string;
  /** タスク番号（タスクがない資格は null で、範囲ごとに集計） */
  task: number | null;
  label: string;
  total: number;
  answered: number;
  rate: number | null;
}

/** タスクごと（タスクがない資格は範囲ごと）の正答率。各問題の直近の回答で数える */
export function unitAccuracy(cert: CertSummary, data: ProgressData): UnitAccuracy[] {
  const units: UnitAccuracy[] = [];
  for (const d of cert.domains) {
    const groups = d.tasks.length ? d.tasks.map((label, i) => ({ task: i + 1, label })) : [{ task: null, label: d.name }];
    for (const g of groups) {
      const qs = cert.questions.filter((q) => q.domain === d.id && (g.task === null || q.task === g.task));
      let answered = 0;
      let ok = 0;
      for (const q of qs) {
        const s = data.questions[q.id];
        if (!s) continue;
        answered++;
        if (s.last) ok++;
      }
      units.push({ domainId: d.id, task: g.task, label: g.label, total: qs.length, answered, rate: answered ? Math.round((ok / answered) * 100) : null });
    }
  }
  return units;
}

export interface ReadinessCheck {
  label: string;
  value: string;
  target: string;
  ok: boolean;
}

/**
 * 合格の準備度。すべて満たしたら受験の目安。
 * - 全問題の 8 割以上を解いた
 * - 初めて解いたときの正答率（初見の実力）が基準以上
 * - 直近 2 回の模擬試験（本番に近い問題数）が基準以上
 * - すべてのタスク（範囲）を 5 問以上解き、正答率が基準以上
 * - 今日の復習が残っていない
 */
export function readiness(cert: CertSummary, data: ProgressData, line: number, fullMock: number) {
  const ids = cert.questions.map((q) => q.id);
  const stats = ids.map((id) => data.questions[id]).filter(Boolean);
  const coverage = ids.length ? Math.round((stats.length / ids.length) * 100) : 0;
  const firstKnown = stats.map((s) => s!.first ?? s!.last);
  const firstRate = firstKnown.length ? Math.round((firstKnown.filter(Boolean).length / firstKnown.length) * 100) : null;
  const mocks = data.mocks.filter((m) => m.certId === cert.id && m.total >= Math.floor(fullMock * 0.9)).slice(-2);
  const mockRates = mocks.map((m) => Math.round((m.score / m.total) * 100));
  const units = unitAccuracy(cert, data);
  const weakUnits = units.filter((u) => u.total > 0 && (u.answered < 5 || (u.rate ?? 0) < line));
  const due = ids.filter((id) => isDue(data.questions[id])).length;
  const checks: ReadinessCheck[] = [
    { label: '解いた問題', value: `${coverage}%`, target: '80% 以上', ok: coverage >= 80 },
    {
      label: '初見の正答率',
      value: firstRate === null ? '—' : `${firstRate}%`,
      target: `${line}% 以上`,
      ok: firstRate !== null && firstRate >= line && stats.length >= Math.min(100, ids.length * 0.5),
    },
    {
      label: '直近 2 回の模擬試験',
      value: mockRates.length ? mockRates.map((r) => `${r}%`).join('・') : 'まだ',
      target: `2 回とも ${line}% 以上`,
      ok: mockRates.length === 2 && mockRates.every((r) => r >= line),
    },
    {
      label: units.some((u) => u.task !== null) ? 'すべてのタスク' : 'すべての範囲',
      value: weakUnits.length ? `${weakUnits.length} 個が未達` : 'すべて達成',
      target: `5 問以上・${line}% 以上`,
      ok: weakUnits.length === 0,
    },
    { label: '今日の復習', value: due ? `${due} 問残り` : 'なし', target: '0 問', ok: due === 0 },
  ];
  return { checks, ready: checks.every((c) => c.ok), units, weakUnits };
}

/** 今日復習する問題の数 */
export function dueCount(data: ProgressData, ids?: string[]): number {
  const list = ids ?? Object.keys(data.questions);
  return list.filter((id) => isDue(data.questions[id])).length;
}
