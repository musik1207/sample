/**
 * レッスン内の ```mermaid コードブロックを図に変換する。
 * mermaid は大きいので、図があるページでだけ読み込む。
 */

// Astro は除外した言語を <pre><code class="language-mermaid"> として出力する
const SELECTOR = 'code.language-mermaid';

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export async function renderDiagrams(root: ParentNode = document): Promise<void> {
  const blocks = [...root.querySelectorAll<HTMLElement>(SELECTOR)].map((code) => code.closest('pre') ?? code);
  if (!blocks.length) return;

  const { default: mermaid } = await import('mermaid');
  // テーマは設定で固定されている場合があるので、OS ではなく実際の表示から判断する
  const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: getComputedStyle(document.body).fontFamily,
    themeVariables: {
      darkMode: dark,
      background: token('--surface'),
      primaryColor: token('--accent-soft'),
      primaryBorderColor: token('--accent'),
      primaryTextColor: token('--text'),
      secondaryColor: token('--success-soft'),
      secondaryBorderColor: token('--success'),
      secondaryTextColor: token('--text'),
      tertiaryColor: token('--surface-2'),
      tertiaryBorderColor: token('--border'),
      tertiaryTextColor: token('--text'),
      lineColor: token('--text-muted'),
      textColor: token('--text'),
      mainBkg: token('--accent-soft'),
      nodeBorder: token('--accent'),
      clusterBkg: token('--surface-2'),
      clusterBorder: token('--border'),
      edgeLabelBackground: token('--surface'),
      actorBkg: token('--accent-soft'),
      actorBorder: token('--accent'),
      actorTextColor: token('--text'),
      signalColor: token('--text'),
      signalTextColor: token('--text'),
      noteBkgColor: token('--warning-soft'),
      noteBorderColor: token('--warning'),
      noteTextColor: token('--text'),
      fontSize: '15px',
      // 折れ線グラフ: 1 本目（理想・計画）は灰色、2 本目（実績）はアクセント色
      xyChart: {
        plotColorPalette: `${token('--text-muted')}, ${token('--accent')}, ${token('--danger')}`,
        backgroundColor: token('--surface'),
        titleColor: token('--text'),
        xAxisLabelColor: token('--text-muted'),
        yAxisLabelColor: token('--text-muted'),
        xAxisTitleColor: token('--text-muted'),
        yAxisTitleColor: token('--text-muted'),
        xAxisLineColor: token('--border-strong'),
        yAxisLineColor: token('--border-strong'),
        xAxisTickColor: token('--border-strong'),
        yAxisTickColor: token('--border-strong'),
      },
    },
    flowchart: { htmlLabels: true, curve: 'basis', useMaxWidth: true },
    sequence: { useMaxWidth: true },
  });

  for (const [i, pre] of blocks.entries()) {
    const source = pre.textContent ?? '';
    const figure = document.createElement('figure');
    figure.className = 'diagram';
    try {
      const { svg } = await mermaid.render(`diagram-${i}-${Date.now()}`, source);
      figure.innerHTML = svg;
      // スマホで縮みすぎて読めなくならないよう、最小幅を決めて横スクロールさせる
      const el = figure.querySelector('svg');
      const width = el?.viewBox.baseVal?.width ?? 0;
      if (el && width) el.style.minWidth = `${Math.min(width, 640)}px`;
    } catch {
      // 描画に失敗したら元のテキストを残す
      figure.append(pre.cloneNode(true));
    }
    pre.replaceWith(figure);
    if (figure.scrollWidth > figure.clientWidth + 4) {
      const hint = document.createElement('figcaption');
      hint.className = 'diagram-hint';
      hint.textContent = '← 図は横にスクロールできます →';
      figure.append(hint);
    }
  }
}
