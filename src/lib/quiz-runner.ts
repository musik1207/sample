import type { QuizQuestion } from './types';
import { addMockResult, recordAnswer } from './storage';

export interface DomainInfo {
  id: string;
  name: string;
  weight: number | null;
}

export interface QuizOptions {
  root: HTMLElement;
  questions: QuizQuestion[];
  mode: 'practice' | 'mock';
  title: string;
  domains: DomainInfo[];
  /** 模擬試験の設定 */
  mock?: { certId: string; minutes: number; passingScore: number | null };
  /** 終了画面に出す「戻る」リンク */
  backHref: string;
  backLabel: string;
}

interface Item {
  q: QuizQuestion;
  /** 表示順 → 元の選択肢インデックス */
  order: number[];
  selected: Set<number>;
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

/** 配点に合わせて範囲ごとに問題を選ぶ */
export function pickMockQuestions(all: QuizQuestion[], domains: DomainInfo[], count: number): QuizQuestion[] {
  if (all.length <= count) return shuffle(all);
  const byDomain = new Map<string, QuizQuestion[]>();
  for (const q of all) byDomain.set(q.domain, [...(byDomain.get(q.domain) ?? []), q]);
  const totalWeight = domains.reduce((s, d) => s + (d.weight ?? 0), 0) || domains.length;
  const picked: QuizQuestion[] = [];
  for (const d of domains) {
    const pool = shuffle(byDomain.get(d.id) ?? []);
    const want = Math.round((count * (d.weight ?? 1)) / totalWeight);
    picked.push(...pool.slice(0, want));
  }
  // 端数の調整
  const rest = shuffle(all.filter((q) => !picked.includes(q)));
  while (picked.length < count && rest.length) picked.push(rest.pop()!);
  return shuffle(picked.slice(0, count));
}

const isCorrect = (item: Item) =>
  item.selected.size === item.q.answer.length && item.q.answer.every((a) => item.selected.has(a));

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

/** キーボード操作の受け口（runQuiz を呼び直したときに古いものを外す） */
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

export function runQuiz(opts: QuizOptions): void {
  const { root, mode } = opts;
  const domainName = (id: string) => opts.domains.find((d) => d.id === id)?.name ?? id;
  let items: Item[] = [];
  let index = 0;
  let startedAt = Date.now();
  let timer: number | undefined;
  let finished = false;

  function start(questions: QuizQuestion[]) {
    items = shuffle(questions).map((q) => ({
      q,
      order: shuffle(q.choices.map((_, i) => i)),
      selected: new Set<number>(),
      submitted: false,
      flagged: false,
    }));
    index = 0;
    startedAt = Date.now();
    finished = false;
    if (mode === 'mock') startTimer();
    renderQuestion();
  }

  function startTimer() {
    window.clearInterval(timer);
    const limit = (opts.mock?.minutes ?? 105) * 60;
    const tick = () => {
      const left = limit - Math.floor((Date.now() - startedAt) / 1000);
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
    window.addEventListener('beforeunload', (e) => {
      if (!finished) e.preventDefault();
    });
  }

  function header() {
    const answered = items.filter((i) => (mode === 'mock' ? i.selected.size > 0 : i.submitted)).length;
    const correct = items.filter((i) => i.submitted && isCorrect(i)).length;
    const status =
      mode === 'mock' ? `問題 ${index + 1} / ${items.length} ・ 回答済み ${answered}` : `問題 ${index + 1} / ${items.length} ・ 正解 ${correct} / ${answered}`;
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

  function renderQuestion() {
    const item = items[index];
    const { q } = item;
    const showResult = mode === 'practice' && item.submitted;
    const inputType = q.type === 'multi' ? 'checkbox' : 'radio';

    const choices = el('div', { class: 'choices', role: q.type === 'multi' ? 'group' : 'radiogroup' });
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

    const body = el(
      'div',
      { class: 'card quiz-card' },
      el(
        'p',
        { class: 'quiz-meta small muted' },
        el('span', {}, domainName(q.domain)),
        q.type === 'multi' ? el('span', { class: 'tag tag-accent' }, `${q.answer.length} つ選択`) : null,
      ),
      el('p', { class: 'question', id: 'question-text' }, q.question),
      choices,
    );
    choices.setAttribute('aria-labelledby', 'question-text');

    if (showResult) {
      const ok = isCorrect(item);
      const correctLabels = item.order
        .map((orig, pos) => (q.answer.includes(orig) ? String.fromCharCode(65 + pos) : null))
        .filter(Boolean)
        .join('・');
      body.append(
        el(
          'div',
          { class: `feedback ${ok ? 'ok' : 'ng'}`, role: 'status' },
          el('p', { class: 'feedback-title' }, ok ? '正解！' : `不正解　正解は ${correctLabels}`),
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
      prevBtn.disabled = index === 0;
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
      nextBtn.disabled = index === items.length - 1;
      nextBtn.addEventListener('click', () => {
        index++;
        renderQuestion();
        scrollToTop();
      });
      const finish = el('button', { class: 'btn btn-primary', type: 'button' }, '見直し画面へ');
      finish.addEventListener('click', renderReviewScreen);
      actions.append(prevBtn, flag, nextBtn, finish);
    }

    root.replaceChildren(header(), body, actions);
    if (mode === 'mock') {
      root.append(el('div', { class: 'palette', 'data-palette': '' }));
      renderPalette();
    }
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
    updateButtons();
  }

  /** 次の問題に進んだとき、問題文が画面の上に隠れていれば戻す */
  function scrollToTop() {
    if (root.getBoundingClientRect().top < 0) root.scrollIntoView({ block: 'start' });
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey || finished) return;
    const target = e.target as HTMLElement;
    if (target.closest('input[type="text"], input[type="search"], input[type="date"], textarea, select, dialog')) return;
    const item = items[index];
    if (!item || !root.querySelector('.quiz-card')) return;
    const pos = /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1;
    if (pos >= 0 && pos < item.order.length) {
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

  /** 本番の試験と同じく、採点前に全問の回答状況を一覧で確認する画面 */
  function renderReviewScreen() {
    const unanswered = items.filter((i) => i.selected.size === 0).length;
    const flagged = items.filter((i) => i.flagged).length;
    const jumpTo = (pred: (i: Item) => boolean) => {
      const i = items.findIndex(pred);
      if (i >= 0) {
        index = i;
        renderQuestion();
      }
    };
    const list = el(
      'div',
      { class: 'palette review-palette' },
      ...items.map((it, i) => {
        const b = el(
          'button',
          {
            type: 'button',
            class: `pal${it.selected.size ? ' answered' : ''}${it.flagged ? ' flagged' : ''}`,
            'aria-label': `問題 ${i + 1}${it.selected.size ? '' : '（未回答）'}${it.flagged ? '（見直し）' : ''}`,
          },
          String(i + 1),
        );
        b.addEventListener('click', () => {
          index = i;
          renderQuestion();
        });
        return b;
      }),
    );
    const actions = el('div', { class: 'quiz-actions' });
    if (unanswered) {
      const b = el('button', { class: 'btn', type: 'button' }, `未回答の問題へ（${unanswered}）`);
      b.addEventListener('click', () => jumpTo((i) => i.selected.size === 0));
      actions.append(b);
    }
    if (flagged) {
      const b = el('button', { class: 'btn', type: 'button' }, `見直しの問題へ（${flagged}）`);
      b.addEventListener('click', () => jumpTo((i) => i.flagged));
      actions.append(b);
    }
    const back = el('button', { class: 'btn', type: 'button' }, '問題に戻る');
    back.addEventListener('click', renderQuestion);
    const submit = el('button', { class: 'btn btn-primary', type: 'button' }, '試験を終了して採点する');
    submit.addEventListener('click', () => {
      if (window.confirm('採点すると回答は変更できません。採点しますか？')) finishMock(false);
    });
    actions.append(back, submit);
    root.replaceChildren(
      header(),
      el(
        'div',
        { class: 'card' },
        el('h2', { class: 'review-title' }, '見直し'),
        el('p', { class: 'small muted' }, `回答済み ${items.length - unanswered} / ${items.length} ・ 見直しマーク ${flagged} 問。番号を押すとその問題に戻れます。`),
        list,
      ),
      actions,
    );
  }

  function updateButtons() {
    const submit = root.querySelector<HTMLButtonElement>('[data-submit]');
    if (submit) submit.disabled = items[index].selected.size === 0;
  }

  function renderPalette() {
    const p = root.querySelector('[data-palette]');
    if (!p) return;
    p.replaceChildren(
      ...items.map((it, i) => {
        const b = el(
          'button',
          {
            type: 'button',
            class: `pal${i === index ? ' current' : ''}${it.selected.size ? ' answered' : ''}${it.flagged ? ' flagged' : ''}`,
            'aria-label': `問題 ${i + 1}`,
          },
          String(i + 1),
        );
        b.addEventListener('click', () => {
          index = i;
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
          el('td', { class: pct < 65 ? 'weak' : '' }, `${pct}%`),
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

  function reviewList(list: Item[]) {
    const wrong = list.filter((it) => !isCorrect(it));
    if (!wrong.length) return el('p', {}, '全問正解です。');
    return el(
      'ol',
      { class: 'review-list' },
      ...wrong.map((it) =>
        el(
          'li',
          { class: 'card' },
          el('p', { class: 'small muted' }, domainName(it.q.domain)),
          el('p', { class: 'question' }, it.q.question),
          el('p', { class: 'small' }, 'あなたの回答: ', it.selected.size ? [...it.selected].map((i) => it.q.choices[i]).join(' / ') : '未回答'),
          el('p', { class: 'small ok-text' }, '正解: ', it.q.answer.map((i) => it.q.choices[i]).join(' / ')),
          el('p', { class: 'small' }, it.q.explanation),
        ),
      ),
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
    const durationSec = Math.floor((Date.now() - startedAt) / 1000);
    // 未回答は時間切れや飛ばしなので、学習記録（復習リスト）には入れない
    for (const it of items) if (it.selected.size > 0) recordAnswer(it.q.id, isCorrect(it));
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
    const verdict =
      passing == null
        ? null
        : el('p', { class: `verdict ${pct >= passing ? 'ok' : 'ng'}` }, pct >= passing ? `合格ライン（${passing}%）を超えました` : `合格ライン（${passing}%）まであと ${passing - pct} ポイント`);
    root.replaceChildren(
      el(
        'div',
        { class: 'card result' },
        timeUp ? el('p', { class: 'notice' }, '時間切れのため自動で採点しました。') : null,
        el('p', { class: 'small muted' }, opts.title),
        el('p', { class: 'score' }, `${correct} / ${items.length} 問正解`, el('span', { class: 'score-pct' }, `${pct}%`)),
        verdict,
        el('p', { class: 'small muted' }, `所要時間 ${Math.floor(durationSec / 60)} 分 ${durationSec % 60} 秒`),
        el('h2', {}, '範囲別の正答率'),
        table,
        resultActions(items.length - correct, items),
      ),
      el('h2', {}, '間違えた問題の解説'),
      reviewList(items),
    );
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
