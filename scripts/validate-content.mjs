// 教材データの整合性チェック（npm run validate）
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const { certs } = JSON.parse(readFileSync(join(root, 'src/data/certs.json'), 'utf8'));
const errors = [];
const certById = new Map(certs.map((c) => [c.id, c]));

for (const c of certs) {
  const weights = c.domains.map((d) => d.weight).filter((w) => w !== null);
  if (weights.length === c.domains.length) {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (sum !== 100) errors.push(`${c.id}: 配点の合計が ${sum}% です`);
  }
}

// 事例（ケース）
const caseIds = new Set();
const caseDir = join(root, 'src/data/cases');
for (const file of readdirSync(caseDir)) {
  for (const c of JSON.parse(readFileSync(join(caseDir, file), 'utf8'))) {
    if (caseIds.has(c.id)) errors.push(`cases/${file} ${c.id}: ID が重複しています`);
    caseIds.add(c.id);
    if (!c.title || !c.scenario) errors.push(`cases/${file} ${c.id}: タイトルか本文が空です`);
  }
}
const usedCases = new Map();

const seen = new Set();
const qDir = join(root, 'src/data/questions');
for (const file of readdirSync(qDir)) {
  const certId = file.replace(/\.json$/, '');
  const cert = certById.get(certId);
  if (!cert) {
    errors.push(`${file}: 資格 ${certId} が certs.json にありません`);
    continue;
  }
  const domainIds = new Set(cert.domains.map((d) => d.id));
  // 出題目標が「タスク N」で書かれている資格は、すべての問題にタスク番号が必要
  const taskCounts = Object.fromEntries(cert.domains.map((d) => [d.id, (d.objectives ?? []).every((o) => /^タスク \d+ /.test(o)) ? (d.objectives ?? []).length : 0]));
  for (const q of JSON.parse(readFileSync(join(qDir, file), 'utf8'))) {
    const where = `${file} ${q.id}`;
    if (seen.has(q.id)) errors.push(`${where}: ID が重複しています`);
    seen.add(q.id);
    if (!domainIds.has(q.domain)) errors.push(`${where}: 範囲 ${q.domain} がありません`);
    if (!q.question || !q.explanation) errors.push(`${where}: 問題文か解説が空です`);
    if (q.choices.length < 2) errors.push(`${where}: 選択肢が足りません`);
    if (new Set(q.choices).size !== q.choices.length) errors.push(`${where}: 選択肢が重複しています`);
    if (!q.answer.length || q.answer.some((a) => a < 0 || a >= q.choices.length)) errors.push(`${where}: 正解の番号が不正です`);
    if (q.type === 'match') {
      if (!Array.isArray(q.prompts) || q.prompts.length < 2) errors.push(`${where}: match の左の項目（prompts）が足りません`);
      else if (q.prompts.length !== q.answer.length) errors.push(`${where}: prompts と answer の数が違います`);
    } else if (!['single', 'multi'].includes(q.type)) errors.push(`${where}: type が不正です（${q.type}）`);
    const tasks = taskCounts[q.domain];
    if (tasks && !(Number.isInteger(q.task) && q.task >= 1 && q.task <= tasks)) errors.push(`${where}: タスク番号（1〜${tasks}）がありません`);
    if (q.caseId) {
      if (!caseIds.has(q.caseId)) errors.push(`${where}: 事例 ${q.caseId} がありません`);
      usedCases.set(q.caseId, (usedCases.get(q.caseId) ?? 0) + 1);
    }
    if (q.diagram !== undefined && (typeof q.diagram !== 'string' || !q.diagram.trim())) errors.push(`${where}: 図が空です`);
    if (q.type === 'single' && q.answer.length !== 1) errors.push(`${where}: single なのに正解が ${q.answer.length} 個です`);
    if (q.type === 'multi' && q.answer.length < 2) errors.push(`${where}: multi なのに正解が 1 個です`);
    const m = q.question.match(/（(\d) つ選択）/);
    if (m && Number(m[1]) !== q.answer.length) errors.push(`${where}: 「${m[1]} つ選択」と正解数が一致しません`);
  }
}

for (const id of caseIds) if (!usedCases.has(id)) errors.push(`事例 ${id} を使う問題がありません`);

const lessonDir = join(root, 'src/content/lessons');
for (const certId of readdirSync(lessonDir)) {
  const cert = certById.get(certId);
  for (const file of readdirSync(join(lessonDir, certId))) {
    const text = readFileSync(join(lessonDir, certId, file), 'utf8');
    const cm = text.match(/^cert:\s*(.+)$/m)?.[1].trim();
    const dm = text.match(/^domain:\s*(.+)$/m)?.[1].trim();
    if (cm !== certId) errors.push(`lessons/${certId}/${file}: cert が ${cm} です`);
    if (!cert?.domains.some((d) => d.id === dm)) errors.push(`lessons/${certId}/${file}: 範囲 ${dm} がありません`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`OK: 資格 ${certs.length} 件、問題 ${seen.size} 問`);
