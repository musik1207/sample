import type { CaseStudy, QuizQuestion } from './types';
import { addMockResult, recordAnswer, type ProgressData } from './storage';
import { renderDiagrams } from './diagrams';

export interface DomainInfo {
  id: string;
  name: string;
  weight: number | null;
}

export interface MockOptions {
  certId: string;
  minutes: number;
  passingScore: number | null;
  scoreLabel?: string;
  /** 休憩の回数。1 以上なら問題をセクションに分け、休憩の後は前のセクションに戻れない */
  breaks?: number;
  breakMinutes?: number;
}

export interface QuizOptions {
  root: HTMLElement;
  questions: QuizQuestion[];
  mode: 'practice' | 'mock';
  title: string;
  domains: DomainInfo[];
  /** 事例（ケース）問題の本文 */
  cases?: Record<string, CaseStudy>;
  /** 模擬試験の設定 */
  mock?: MockOptions;
  /** 終了画面に出す「戻る」リンク */
  backHref: string;
  backLabel: string;
}

interface Item {
  q: QuizQuestion;
  /** 表示順 → 元の選択肢インデックス */
  order: number[];
  /** single / multi で選んだ選択肢（元のインデックス） */
  selected: Set<number>;
  /** match で、左の項目ごとに選んだ選択肢（元のインデックス。未選択は -1） */
  matches: number[];
  submitted: boolean;
  flagged: boolean;
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 解いた回数が少ない問題を先に並べる（同じ回数の中はランダム） */
function unseenFirst(list: QuizQuestion[], progress?: ProgressData): QuizQuestion[] {
  const attempts = (q: QuizQuestion) => progress?.questions[q.id]?.attempts ?? 0;
  return shuffle(list).sort((a, b) => attempts(a) - attempts(b));
}

/** 同じ事例の問題をまとめる（事例の中は元の順番のまま） */
function groupByCase(list: QuizQuestion[]): QuizQuestion[][] {
  const groups = new Map<string, QuizQuestion[]>();
  const units: QuizQuestion[][] = [];
  for (const q of list) {
    if (!q.caseId) units.push([q]);
    else if (groups.has(q.caseId)) groups.get(q.caseId)!.push(q);
    else {
      const g = [q];
      groups.set(q.caseId, g);
      units.push(g);
    }
  }
  return units;
}

/**
 * 模擬試験の問題を選ぶ。
 * - 事例問題は事例ごとまとめて、全体の 2 割まで入れる
 * - 残りは配点どおりに範囲ごとに選ぶ
 * - どちらも、まだ解いていない問題を優先する（初見の実力を測るため）
 */
export function pickMockQuestions(all: QuizQuestion[], domains: DomainInfo[], count: number, progress?: ProgressData): QuizQuestion[] {
  if (all.length <= count) return all.slice();
  const attempts = (q: QuizQuestion) => progress?.questions[q.id]?.attempts ?? 0;
  const caseUnits = shuffle(groupByCase(all.filter((q) => q.caseId))).sort(
    (a, b) => a.reduce((s, q) => s + attempts(q), 0) / a.length - b.reduce((s, q) => s + attempts(q), 0) / b.length,
  );
  const picked: QuizQuestion[] = [];
  for (const unit of caseUnits) {
    if (picked.length + unit.length > count * 0.2) continue;
    picked.push(...unit);
  }
  const singles = all.filter((q) => !q.caseId);
  const totalWeight = domains.reduce((s, d) => s + (d.weight ?? 0), 0) || domains.length;
  for (const d of domains) {
    const want = Math.round((count * (d.weight ?? 1)) / totalWeight) - picked.filter((q) => q.domain === d.id).length;
    picked.push(...unseenFirst(singles.filter((q) => q.domain === d.id), progress).slice(0, Math.max(0, want)));
  }
  // 端数の調整
  const rest = unseenFirst(
    singles.filter((q) => !picked.includes(q)),
    progress,
  );
  while (picked.length < count && rest.length) picked.push(rest.shift()!);
  return picked.slice(0, count);
}

/** 出題順を決める。事例の問題はまとめて並べ、模擬試験では事例を先にする（本番と同じ） */
function arrange(list: QuizQuestion[], casesFirst: boolean): QuizQuestion[] {
  const units = groupByCase(list);
  if (!casesFirst) return shuffle(units).flat();
  return [...shuffle(units.filter((u) => u[0].caseId)), ...shuffle(units.filter((u) => !u[0].caseId))].flat();
}

const isAnswered = (item: Item) => (item.q.type === 'match' ? item.matches.every((m) => m >= 0) : item.selected.size > 0);
const isTouched = (item: Item) => (item.q.type === 'match' ? item.matches.some((m) => m >= 0) : item.selected.size > 0);

const isCorrect = (item: Item) =>
  item.q.type === 'match'
    ? item.q.answer.every((a, i) => item.matches[i] === a)
    : item.selected.size === item.q.answer.length && item.q.answer.every((a) => item.selected.has(a));

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

/** Mermaid の図を入れる場所（描画は renderDiagrams が行う） */
function diagramBlock(source: string): HTMLElement {
  return el('pre', { class: 'quiz-diagram' }, el('code', { class: 'language-mermaid' }, source));
}

/** キーボード操作の受け口（runQuiz を呼び直したときに古いものを外す） */
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
let unloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;

export function runQuiz(opts: QuizOptions): void {
  const { root, mode } = opts;
  const domainName = (id: string) => opts.domains.find((d) => d.id === id)?.name ?? id;
  const breaks = mode === 'mock' ? (opts.mock?.breaks ?? 0) : 0;
  let items: Item[] = [];
  let index = 0;
  /** セクションの境目（[開始, 次の開始, …, 終わり]） */
  let bounds: number[] = [];
  let section = 0;
  /** 休憩などで止めていた時間を除いた経過時間 */
  let elapsedBefore = 0;
  let runningSince = Date.now();
  let running = true;
  let timer: number | undefined;
  let finished = false;
  /** 事例の本文を閉じたもの */
  const collapsedCases = new Set<string>();

  const sectionStart = () => bounds[section] ?? 0;
  const sectionEnd = () => bounds[section + 1] ?? items.length;
  const sectionItems = () => items.slice(sectionStart(), sectionEnd());

  function start(questions: QuizQuestion[]) {
    items = arrange(questions, mode === 'mock').map((q) => ({
      q,
      order: shuffle(q.choices.map((_, i) => i)),
      selected: new Set<number>(),
      matches: (q.prompts ?? []).map(() => -1),
      submitted: false,
      flagged: false,
    }));
    index = 0;
    section = 0;
    bounds = sectionBounds();
    elapsedBefore = 0;
    runningSince = Date.now();
    running = true;
    finished = false;
    if (mode === 'mock') startTimer();
    renderQuestion();
  }

  /** 休憩で分けるセクションの境目。事例があれば事例のセクションを最初にする */
  function sectionBounds(): number[] {
    const n = items.length;
    if (!breaks || n < (breaks + 1) * 5) return [0, n];
    const caseCount = items.findIndex((it) => !it.q.caseId);
    const parts = breaks + 1;
    if (caseCount > 0 && caseCount < n) {
      const rest = n - caseCount;
      const b = [0, caseCount];
      for (let i = 1; i < parts - 1; i++) b.push(caseCount + Math.round((rest * i) / (parts - 1)));
      b.push(n);
      return b;
    }
    return Array.from({ length: parts + 1 }, (_, i) => Math.round((n * i) / parts));
  }

  const elapsedSec = () => Math.floor((elapsedBefore + (running ? Date.now() - runningSince : 0)) / 1000);

  function pauseClock() {
    if (!running) return;
    elapsedBefore += Date.now() - runningSince;
    running = false;
  }

  function resumeClock() {
    if (running) return;
    runningSince = Date.now();
    running = true;
  }

  function startTimer() {
    window.clearInterval(timer);
    const limit = (opts.mock?.minutes ?? 105) * 60;
    const tick = () => {
      const left = limit - elapsedSec();
      const t = root.querySelector('[data-timer]');
      if (t) {
        const m = Math.max(0, Math.floor(left / 60));
        const s = Math.max(0, left % 60);
        t.textContent = `残り ${m}:${String(s).padStart(2, '0')}`;
        t.classList.toggle('timer-warn', left <= 300);
      }
      if (left <= 0) finishMock(true);
    };
    timer = window.setInterval(tick, 1000);
    if (unloadHandler) window.removeEventListener('beforeunload', unloadHandler);
    unloadHandler = (e) => {
      if (!finished) e.preventDefault();
    };
    window.addEventListener('beforeunload', unloadHandler);
  }

  function header() {
    const answered = items.filter((i) => (mode === 'mock' ? isAnswered(i) : i.submitted)).length;
    const correct = items.filter((i) => i.submitted && isCorrect(i)).length;
    const sectionLabel = bounds.length > 2 ? ` ・ セクション ${section + 1} / ${bounds.length - 1}` : '';
    const status =
      mode === 'mock'
        ? `問題 ${index + 1} / ${items.length} ・ 回答済み ${answered}${sectionLabel}`
        : `問題 ${index + 1} / ${items.length} ・ 正解 ${correct} / ${answered}`;
    const bar = el('span');
    bar.style.width = `${(answered / items.length) * 100}%`;
    return el(
      'div',
      { class: 'quiz-header' },
      el(
        'div',
        { class: 'quiz-header-row' },
        el('div', {}, el('p', { class: 'quiz-title' }, opts.title), el('p', { class: 'small muted' }, status)),
        mode === 'mock' ? el('span', { class: 'timer', 'data-timer': '', 'aria-live': 'off' }, '') : null,
      ),
      el('div', { class: 'progress', 'aria-hidden': 'true' }, bar),
    );
  }

  /** 事例の本文（同じ事例の何問目か） */
  function caseCard(q: QuizQuestion): HTMLElement | null {
    const c = q.caseId ? opts.cases?.[q.caseId] : undefined;
    if (!c) return null;
    const group = items.filter((it) => it.q.caseId === q.caseId);
    const pos = group.findIndex((it) => it.q === q) + 1;
    const details = el(
      'details',
      { class: 'case-card' },
      el('summary', {}, el('span', { class: 'tag tag-accent' }, '事例'), ` ${c.title}`, el('span', { class: 'small muted' }, `（問 ${pos} / ${group.length}）`)),
      ...c.scenario.split('\n').filter(Boolean).map((p) => el('p', {}, p)),
      c.diagram ? diagramBlock(c.diagram) : null,
    );
    details.open = !collapsedCases.has(c.id);
    details.addEventListener('toggle', () => {
      if (details.open) collapsedCases.delete(c.id);
      else collapsedCases.add(c.id);
    });
    return details;
  }

  function choiceList(item: Item, showResult: boolean): HTMLElement {
    const { q } = item;
    const inputType = q.type === 'multi' ? 'checkbox' : 'radio';
    const choices = el('div', { class: 'choices', role: q.type === 'multi' ? 'group' : 'radiogroup', 'aria-labelledby': 'question-text' });
    item.order.forEach((orig, pos) => {
      const id = `c-${pos}`;
      const input = el('input', { type: inputType, name: 'choice', id, value: String(orig) }) as HTMLInputElement;
      input.checked = item.selected.has(orig);
      input.disabled = showResult;
      input.addEventListener('change', () => {
        if (q.type === 'single') item.selected = new Set([orig]);
        else if (input.checked) item.selected.add(orig);
        else item.selected.delete(orig);
        updateButtons();
        if (mode === 'mock') renderPalette();
      });
      let state = '';
      if (showResult) {
        if (q.answer.includes(orig)) state = ' is-correct';
        else if (item.selected.has(orig)) state = ' is-wrong';
      }
      choices.append(
        el('label', { class: `choice${state}`, for: id }, input, el('span', { class: 'choice-key' }, String.fromCharCode(65 + pos)), el('span', {}, q.choices[orig])),
      );
    });
    return choices;
  }

  /** マッチング: 左の項目ごとに、右の候補から選ぶ */
  function matchList(item: Item, showResult: boolean): HTMLElement {
    const { q } = item;
    const list = el('div', { class: 'match-list', role: 'group', 'aria-labelledby': 'question-text' });
    (q.prompts ?? []).forEach((prompt, i) => {
      const id = `m-${i}`;
      const select = el('select', { id, class: 'match-select' }) as HTMLSelectElement;
      select.append(new Option('選んでください', '-1'));
      for (const orig of item.order) select.append(new Option(q.choices[orig], String(orig)));
      select.value = String(item.matches[i]);
      select.disabled = showResult;
      select.addEventListener('change', () => {
        item.matches[i] = Number(select.value);
        updateButtons();
        if (mode === 'mock') renderPalette();
      });
      let state = '';
      let note: HTMLElement | null = null;
      if (showResult) {
        const ok = item.matches[i] === q.answer[i];
        state = ok ? ' is-correct' : ' is-wrong';
        if (!ok) note = el('p', { class: 'match-answer small' }, `正解: ${q.choices[q.answer[i]]}`);
      }
      list.append(el('div', { class: `match-row${state}` }, el('label', { class: 'match-prompt', for: id }, prompt), select, note));
    });
    return list;
  }

  function renderQuestion() {
    const item = items[index];
    const { q } = item;
    const showResult = mode === 'practice' && item.submitted;

    const body = el(
      'div',
      { class: 'card quiz-card' },
      el(
        'p',
        { class: 'quiz-meta small muted' },
        el('span', {}, domainName(q.domain)),
        q.type === 'multi' ? el('span', { class: 'tag tag-accent' }, `${q.answer.length} つ選択`) : null,
        q.type === 'match' ? el('span', { class: 'tag tag-accent' }, 'マッチング') : null,
      ),
      el('p', { class: 'question', id: 'question-text' }, q.question),
      q.diagram ? diagramBlock(q.diagram) : null,
      q.type === 'match' ? matchList(item, showResult) : choiceList(item, showResult),
    );

    if (showResult) {
      const ok = isCorrect(item);
      const correctLabels =
        q.type === 'match'
          ? ''
          : item.order
              .map((orig, pos) => (q.answer.includes(orig) ? String.fromCharCode(65 + pos) : null))
              .filter(Boolean)
              .join('・');
      body.append(
        el(
          'div',
          { class: `feedback ${ok ? 'ok' : 'ng'}`, role: 'status' },
          el('p', { class: 'feedback-title' }, ok ? '正解！' : q.type === 'match' ? '不正解（正しい組み合わせは上に表示）' : `不正解　正解は ${correctLabels}`),
          el('p', {}, q.explanation),
        ),
      );
    }

    const actions = el('div', { class: 'quiz-actions' });
    if (mode === 'practice') {
      if (!item.submitted) {
        const submit = el('button', { class: 'btn btn-primary', type: 'button', 'data-submit': '' }, '回答する');
        submit.addEventListener('click', () => {
          item.submitted = true;
          recordAnswer(q.id, isCorrect(item));
          renderQuestion();
          // 解説と「次の問題」ボタンが画面の外にあるときは見える位置まで送る
          root.querySelector<HTMLElement>('.quiz-actions')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          root.querySelector<HTMLElement>('[data-next]')?.focus({ preventScroll: true });
        });
        actions.append(submit);
      } else {
        const last = index === items.length - 1;
        const nextBtn = el('button', { class: 'btn btn-primary', type: 'button', 'data-next': '' }, last ? '結果を見る' : '次の問題 →');
        nextBtn.addEventListener('click', () => {
          if (last) showPracticeResult();
          else {
            index++;
            renderQuestion();
            scrollToTop();
          }
        });
        actions.append(nextBtn);
      }
      // 途中でやめても、それまでの結果を見られるようにする
      const answered = items.filter((i) => i.submitted).length;
      if (answered > 0 && index < items.length - 1) {
        const stop = el('button', { class: 'btn btn-ghost', type: 'button' }, 'ここで終了して結果を見る');
        stop.addEventListener('click', showPracticeResult);
        actions.prepend(stop);
      }
    } else {
      const prevBtn = el('button', { class: 'btn', type: 'button' }, '← 前へ');
      prevBtn.disabled = index === sectionStart();
      prevBtn.addEventListener('click', () => {
        index--;
        renderQuestion();
      });
      const flag = el('button', { class: `btn${item.flagged ? ' is-flagged' : ''}`, type: 'button' }, item.flagged ? '★ 見直し' : '☆ 見直し');
      flag.addEventListener('click', () => {
        item.flagged = !item.flagged;
        renderQuestion();
      });
      const nextBtn = el('button', { class: 'btn', type: 'button', 'data-next': '' }, '次へ →');
      nextBtn.disabled = index === sectionEnd() - 1;
      nextBtn.addEventListener('click', () => {
        index++;
        renderQuestion();
        scrollToTop();
      });
      const finish = el('button', { class: 'btn btn-primary', type: 'button' }, '見直し画面へ');
      finish.addEventListener('click', renderReviewScreen);
      actions.append(prevBtn, flag, nextBtn, finish);
    }

    root.replaceChildren(header(), ...[caseCard(q)].filter((n): n is HTMLElement => n !== null), body, actions);
    if (mode === 'mock') {
      root.append(el('div', { class: 'palette', 'data-palette': '' }));
      renderPalette();
    }
    if (q.type !== 'match') {
      root.append(
        el(
          'p',
          { class: 'kbd-hint small muted' },
          'キーボード: ',
          el('kbd', {}, '1'),
          '〜',
          el('kbd', {}, String(Math.min(9, item.order.length))),
          ' で選択、',
          el('kbd', {}, 'Enter'),
          mode === 'mock' ? ' で次の問題' : ' で回答・次の問題',
        ),
      );
    }
    updateButtons();
    if (root.querySelector('code.language-mermaid')) renderDiagrams(root);
  }

  /** 次の問題に進んだとき、問題文が画面の上に隠れていれば戻す */
  function scrollToTop() {
    if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: 'start' });
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || finished) return;
    const target = e.target as HTMLElement;
    if (target.closest('input[type="text"], input[type="search"], input[type="date"], textarea, select, dialog, summary')) return;
    const item = items[index];
    if (!item || !root.querySelector('.quiz-card')) return;
    const pos = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
    if (pos >= 0 && pos < item.order.length && item.q.type !== 'match') {
      const input = root.querySelector<HTMLInputElement>(`#c-${pos}`);
      if (!input || input.disabled) return;
      e.preventDefault();
      input.click();
      input.focus({ preventScroll: true });
      return;
    }
    // ボタンやリンクの上の Enter は、そのボタン自体の動作に任せる
    if (e.key === 'Enter' && !target.closest('button, a')) {
      const btn = root.querySelector<HTMLButtonElement>('[data-submit]:not([disabled]), [data-next]:not([disabled])');
      if (btn) {
        e.preventDefault();
        btn.click();
      }
    }
  }

  /** 本番の試験と同じく、採点前（またはセクションの終わり）に回答状況を一覧で確認する画面 */
  function renderReviewScreen() {
    const list = sectionItems();
    const offset = sectionStart();
    const unanswered = list.filter((i) => !isAnswered(i)).length;
    const flagged = list.filter((i) => i.flagged).length;
    const lastSection = section >= bounds.length - 2;
    const jumpTo = (pred: (i: Item) => boolean) => {
      const i = list.findIndex(pred);
      if (i >= 0) {
        index = offset + i;
        renderQuestion();
      }
    };
    const palette = el(
      'div',
      { class: 'palette review-palette' },
      ...list.map((it, i) => {
        const b = el(
          'button',
          {
            type: 'button',
            class: `pal${isAnswered(it) ? ' answered' : ''}${it.flagged ? ' flagged' : ''}`,
            'aria-label': `問題 ${offset + i + 1}${isAnswered(it) ? '' : '（未回答）'}${it.flagged ? '（見直し）' : ''}`,
          },
          String(offset + i + 1),
        );
        b.addEventListener('click', () => {
          index = offset + i;
          renderQuestion();
        });
        return b;
      }),
    );
    const actions = el('div', { class: 'quiz-actions' });
    if (unanswered) {
      const b = el('button', { class: 'btn', type: 'button' }, `未回答の問題へ（${unanswered}）`);
      b.addEventListener('click', () => jumpTo((i) => !isAnswered(i)));
      actions.append(b);
    }
    if (flagged) {
      const b = el('button', { class: 'btn', type: 'button' }, `見直しの問題へ（${flagged}）`);
      b.addEventListener('click', () => jumpTo((i) => i.flagged));
      actions.append(b);
    }
    const back = el('button', { class: 'btn', type: 'button' }, '問題に戻る');
    back.addEventListener('click', renderQuestion);
    const submit = el('button', { class: 'btn btn-primary', type: 'button' }, lastSection ? '試験を終了して採点する' : 'このセクションを終えて休憩へ');
    submit.addEventListener('click', () => {
      if (lastSection) {
        if (window.confirm('採点すると回答は変更できません。採点しますか？')) finishMock(false);
      } else if (window.confirm('休憩に入ると、このセクションの問題には戻れなくなります。よろしいですか？')) {
        renderBreak();
      }
    });
    actions.append(back, submit);
    const title = bounds.length > 2 ? `見直し（セクション ${section + 1} / ${bounds.length - 1}）` : '見直し';
    root.replaceChildren(
      header(),
      el(
        'div',
        { class: 'card' },
        el('h2', { class: 'review-title' }, title),
        el('p', { class: 'small muted' }, `回答済み ${list.length - unanswered} / ${list.length} ・ 見直しマーク ${flagged} 問。番号を押すとその問題に戻れます。`),
        palette,
      ),
      actions,
    );
  }

  /** 休憩の画面。試験の残り時間は止まる */
  function renderBreak() {
    pauseClock();
    const total = (opts.mock?.breakMinutes ?? 10) * 60;
    const breakStart = Date.now();
    const clock = el('p', { class: 'break-clock' }, '');
    const resume = el('button', { class: 'btn btn-primary', type: 'button' }, '休憩を終えて次のセクションへ');
    let breakTimer: number | undefined;
    const goNext = () => {
      window.clearInterval(breakTimer);
      section++;
      index = sectionStart();
      resumeClock();
      renderQuestion();
      scrollToTop();
    };
    const tick = () => {
      const left = total - Math.floor((Date.now() - breakStart) / 1000);
      clock.textContent = `${Math.max(0, Math.floor(left / 60))}:${String(Math.max(0, left % 60)).padStart(2, '0')}`;
      // 本番と同じく、休憩時間が過ぎたら試験を再開する
      if (left <= 0) goNext();
    };
    resume.addEventListener('click', goNext);
    root.replaceChildren(
      header(),
      el(
        'div',
        { class: 'card break-card' },
        el('h2', {}, `休憩（${section + 1} 回目）`),
        el('p', { class: 'muted' }, '試験の残り時間は止まっています。休憩時間が終わると、自動で次のセクションが始まります。'),
        clock,
        el('div', { class: 'btn-row' }, resume),
      ),
    );
    tick();
    breakTimer = window.setInterval(tick, 1000);
    resume.focus();
  }

  function updateButtons() {
    const submit = root.querySelector<HTMLButtonElement>('[data-submit]');
    if (submit) submit.disabled = !isAnswered(items[index]);
  }

  function renderPalette() {
    const p = root.querySelector('[data-palette]');
    if (!p) return;
    const offset = sectionStart();
    p.replaceChildren(
      ...sectionItems().map((it, i) => {
        const n = offset + i;
        const b = el(
          'button',
          {
            type: 'button',
            class: `pal${n === index ? ' current' : ''}${isAnswered(it) ? ' answered' : isTouched(it) ? ' partial' : ''}${it.flagged ? ' flagged' : ''}`,
            'aria-label': `問題 ${n + 1}`,
          },
          String(n + 1),
        );
        b.addEventListener('click', () => {
          index = n;
          renderQuestion();
        });
        return b;
      }),
    );
  }

  function byDomainTable(list: Item[]) {
    const stats = new Map<string, { correct: number; total: number }>();
    for (const it of list) {
      const s = stats.get(it.q.domain) ?? { correct: 0, total: 0 };
      s.total++;
      if (isCorrect(it)) s.correct++;
      stats.set(it.q.domain, s);
    }
    const line = opts.mock?.passingScore ?? 65;
    const rows = opts.domains
      .filter((d) => stats.has(d.id))
      .map((d) => {
        const s = stats.get(d.id)!;
        const pct = Math.round((s.correct / s.total) * 100);
        return el(
          'tr',
          {},
          el('td', {}, d.name),
          el('td', {}, `${s.correct}/${s.total}`),
          el('td', { class: pct < line ? 'weak' : '' }, `${pct}%`),
        );
      });
    const table = el(
      'table',
      {},
      el('thead', {}, el('tr', {}, el('th', {}, '範囲'), el('th', {}, '正解'), el('th', {}, '正答率'))),
      el('tbody', {}, ...rows),
    );
    return { table: el('div', { class: 'table-wrap' }, table), stats };
  }

  function answerText(it: Item): { mine: string; right: string } {
    const { q } = it;
    if (q.type === 'match') {
      const pairs = (sel: number[]) =>
        (q.prompts ?? []).map((p, i) => `${p} → ${sel[i] >= 0 ? q.choices[sel[i]] : '未回答'}`).join(' / ');
      return { mine: isTouched(it) ? pairs(it.matches) : '未回答', right: pairs(q.answer) };
    }
    return {
      mine: it.selected.size ? [...it.selected].map((i) => q.choices[i]).join(' / ') : '未回答',
      right: q.answer.map((i) => q.choices[i]).join(' / '),
    };
  }

  function reviewList(list: Item[]) {
    const wrong = list.filter((it) => !isCorrect(it));
    if (!wrong.length) return el('p', {}, '全問正解です。');
    return el(
      'ol',
      { class: 'review-list' },
      ...wrong.map((it) => {
        const { mine, right } = answerText(it);
        const c = it.q.caseId ? opts.cases?.[it.q.caseId] : undefined;
        return el(
          'li',
          { class: 'card' },
          el('p', { class: 'small muted' }, domainName(it.q.domain), c ? ` ・ 事例「${c.title}」` : ''),
          el('p', { class: 'question' }, it.q.question),
          el('p', { class: 'small' }, 'あなたの回答: ', mine),
          el('p', { class: 'small ok-text' }, '正解: ', right),
          el('p', { class: 'small' }, it.q.explanation),
        );
      }),
    );
  }

  function resultActions(wrongCount: number, list: Item[]) {
    const row = el('div', { class: 'btn-row' });
    if (wrongCount > 0) {
      const retry = el('button', { class: 'btn btn-primary', type: 'button' }, `間違えた ${wrongCount} 問をもう一度`);
      retry.addEventListener('click', () => {
        const wrongQs = list.filter((it) => !isCorrect(it)).map((it) => it.q);
        // 再挑戦は練習モード
        runQuiz({ ...opts, mode: 'practice', questions: wrongQs, title: '間違えた問題の再挑戦' });
      });
      row.append(retry);
    }
    const again = el('button', { class: 'btn', type: 'button' }, 'もう一度最初から');
    again.addEventListener('click', () => start(opts.questions));
    row.append(again, el('a', { class: 'btn', href: opts.backHref }, opts.backLabel));
    return row;
  }

  function showPracticeResult() {
    finished = true;
    // 途中で終えた場合は、回答した問題だけで集計する
    const done = items.filter((i) => i.submitted);
    const correct = done.filter(isCorrect).length;
    const pct = done.length ? Math.round((correct / done.length) * 100) : 0;
    const { table } = byDomainTable(done);
    root.replaceChildren(
      el(
        'div',
        { class: 'card result' },
        el('p', { class: 'small muted' }, opts.title, done.length < items.length ? `（${items.length} 問中 ${done.length} 問に回答）` : ''),
        el('p', { class: 'score' }, `${correct} / ${done.length} 問正解`, el('span', { class: 'score-pct' }, `${pct}%`)),
        el('div', { class: 'progress thick result-bar', 'aria-hidden': 'true' }, el('span', { style: `width:${pct}%` })),
        table,
        resultActions(done.length - correct, done),
      ),
    );
    root.scrollIntoView({ block: 'start' });
  }

  function finishMock(timeUp: boolean) {
    if (finished) return;
    finished = true;
    window.clearInterval(timer);
    pauseClock();
    const durationSec = elapsedSec();
    // 未回答は時間切れや飛ばしなので、学習記録（復習リスト）には入れない
    for (const it of items) if (isTouched(it)) recordAnswer(it.q.id, isCorrect(it));
    const correct = items.filter(isCorrect).length;
    const pct = Math.round((correct / items.length) * 100);
    const { table, stats } = byDomainTable(items);
    addMockResult({
      certId: opts.mock!.certId,
      date: new Date().toISOString(),
      score: correct,
      total: items.length,
      durationSec,
      byDomain: Object.fromEntries(stats),
    });
    const passing = opts.mock?.passingScore;
    const label = opts.mock?.scoreLabel ?? '合格ライン';
    const verdict =
      passing == null
        ? null
        : el(
            'p',
            { class: `verdict ${pct >= passing ? 'ok' : 'ng'}` },
            pct >= passing ? `${label}（${passing}%）を超えました` : `${label}（${passing}%）まであと ${passing - pct} ポイント`,
          );
    root.replaceChildren(
      el(
        'div',
        { class: 'card result' },
        timeUp ? el('p', { class: 'notice' }, '時間切れのため自動で採点しました。') : null,
        el('p', { class: 'small muted' }, opts.title),
        el('p', { class: 'score' }, `${correct} / ${items.length} 問正解`, el('span', { class: 'score-pct' }, `${pct}%`)),
        verdict,
        el('p', { class: 'small muted' }, `所要時間 ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒（休憩を除く）`),
        el('h2', {}, '範囲別の正答率'),
        table,
        resultActions(items.length - correct, items),
      ),
      el('h2', {}, '間違えた問題の解説'),
      reviewList(items),
    );
    root.scrollIntoView({ block: 'start' });
  }

  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = onKey;
  document.addEventListener('keydown', keyHandler);

  if (!opts.questions.length) {
    root.replaceChildren(el('div', { class: 'card' }, el('p', {}, '対象の問題がありません。'), el('a', { class: 'btn', href: opts.backHref }, opts.backLabel)));
    return;
  }
  start(opts.questions);
}
