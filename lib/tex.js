/**
 * 論文を LuaLaTeX で組む（paper.js の HTML 版と同じ内容・同じ体裁を .tex にする）
 *
 *   日本語版 … 日本教育工学会論文誌のテンプレートの体裁。B5・2段組・本文 明朝 8.5pt（行送り 13.5pt）・見出し ゴシック
 *   英語版   … ITEL のテンプレートの体裁。A4・2段組・本文 Times 9pt・題名 Arial 14pt
 *
 * 文章・表・引用は HTML 版と同じ関数（content.js・cite.js）から取り、HTML の小さな部品（<i> <b> <sup> <a>）を TeX にする。
 * 図は Chrome で SVG を PDF にしたもの（ベクター）を読み込む。
 * 学会誌名・巻号・著作権表示は使わない（paper.js と同じ。その雑誌に載った論文だと誤解されないように）。
 *
 * コンパイルは lualatex を2回。log に「Missing character」があれば、その文字を挙げて失敗にする。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('../config');
const c = require('./content');
const cite = require('./cite');
const paper = require('./paper');

const ZEN = '０１２３４５６７８９';
const jsetText = paper.jsetText;

// ============================================================
// HTML の部品 → TeX
// ============================================================

function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

// 英語版の本文に日本語（J-STAGE の検索語など）が出るとき、その部分だけ別の書体にする
let cjkWrap = false;
const CJK_RUN = /[、-ヿ一-鿿＀-￯]+/g;

/** 文字を TeX 用にする。書体に無い文字は、近い文字か命令にする */
function escText(s) {
  const body = s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/　/g, '\\hspace{1em}')
    .replace(/[‐‑]/g, '-')
    .replace(/ /g, '~')
    // 負号 U+2212 は和文の字幅で広がるので、数式の負号にする。直線の二重引用符は対にして “ ” にする
    .replace(/−/g, '\\ensuremath{-}')
    .replace(/"([^"]*)"/g, '“$1”');
  return cjkWrap ? body.replace(CJK_RUN, (m) => '{\\cjkfont ' + m + '}') : body;
}

/** <i> <b> <sup> <span> <a> だけを持つ小さな HTML を TeX にする */
function htmlToTex(html) {
  const out = [];
  const stack = [];
  let skip = 0;
  const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] != null) { if (!skip) out.push(escText(decode(m[4]))); continue; }
    const close = !!m[1];
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    if (!close) {
      if (tag === 'i') { out.push('\\textit{'); stack.push('}'); }
      else if (tag === 'b') { out.push('\\textbf{'); stack.push('}'); }
      else if (tag === 'sup') { out.push('\\textsuperscript{'); stack.push('}'); }
      else if (tag === 'span') {
        if (/class="vol"/.test(attrs)) { out.push('\\textbf{'); stack.push('}'); } else stack.push('');
      } else if (tag === 'a') {
        const href = decode((attrs.match(/href="([^"]*)"/) || [])[1] || '');
        out.push(href ? '\\url{' + href + '}' : '');
        stack.push('');
        skip++;
      } else if (tag === 'br') out.push('\\\\ ');
      else stack.push('');
    } else if (tag !== 'br') {
      const closer = stack.pop();
      if (tag === 'a') skip = Math.max(0, skip - 1);
      if (closer) out.push(closer);
    }
  }
  return out.join('');
}

/** 段落。paper.js の para と同じ手順（引用 → 統計記号のイタリック → JSET の表記）で、HTML の代わりに TeX にする */
function texPara(bib, text, lang) {
  let h = c.italicStats(c.etal(c.escapeHtml(bib.resolve(text))));
  if (lang === 'ja') h = jsetText(h);
  h = h.replace(/⟦/g, '').replace(/⟧/g, '')
    .replace(/https?:\/\/[^\s)（）<]+?(?=[.,)]?(?:\s|$|<|\)))/g, (u) => `<a href="${u}">${u}</a>`);
  return htmlToTex(h);
}

function headCell(h) {
  return c.escapeHtml(h).replace(/^(k|N|g|r|p)(?=$|\s)/, '<i>$1</i>').replace(/I²/, '<i>I</i>²').replace(/τ²/, '<i>τ</i>²');
}

function texTable(t, lang) {
  const ja = lang === 'ja';
  const n = t.head.length;
  const cap = ja
    ? `表${ZEN[t.number] || t.number}\\hspace{1em}${htmlToTex(c.escapeHtml(t.title))}`
    : `\\textbf{Table ${t.number}.} ${htmlToTex(c.escapeHtml(t.title))}`;
  let spec;
  if (t.widths) {
    const total = t.widths.reduce((a, b) => a + b, 0);
    spec = t.widths.map((w, i) => {
      const frac = (w / total).toFixed(4);
      return (t.nowrap || []).includes(i)
        ? `>{\\raggedright\\arraybackslash}p{${frac}\\dimexpr\\textwidth-${2 * n}\\tabcolsep\\relax}`
        : `>{\\raggedright\\arraybackslash}p{${frac}\\dimexpr\\textwidth-${2 * n}\\tabcolsep\\relax}`;
    }).join('');
  } else {
    spec = 'l' + 'r'.repeat(n - 1);
  }
  const cell = (x) => htmlToTex(c.etal(c.escapeHtml(x)));
  const rows = t.rows.map((r) => r.map(cell).join(' & ') + ' \\\\').join('\n');
  const note = (ja ? '注：' : '\\textit{Note.} ') + htmlToTex(c.italicStats(c.escapeHtml(t.note)));
  return [
    '\\begin{table*}[tb]',
    '\\centering',
    `{\\tablefont ${ja ? '\\gtfamily ' : ''}${cap}\\par}\\vspace{2pt}`,
    '{\\tablefont\\renewcommand{\\arraystretch}{1.12}',
    `\\begin{tabular}{${spec}}`,
    '\\toprule',
    t.head.map((h) => htmlToTex(headCell(h))).join(' & ') + ' \\\\',
    '\\midrule',
    rows,
    '\\bottomrule',
    '\\end{tabular}\\par}',
    `\\vspace{2pt}{\\tablefont\\noindent ${note}\\par}`,
    '\\end{table*}'
  ].join('\n');
}

function texFigure(file, lang) {
  const ja = lang === 'ja';
  return [
    '\\begin{figure*}[tb]',
    '\\centering',
    `\\includegraphics[width=\\textwidth]{${file}}\\par\\vspace{2pt}`,
    ja
      ? '{\\tablefont\\gtfamily 図１\\hspace{1em}フォレストプロット\\par}{\\tablefont 注：四角は各研究の効果量 (大きさは重み)，横線は95\\%信頼区間，ひし形は統合値，点線は予測区間を表す．\\par}'
      : '{\\tablefont\\textbf{Figure 1.} Forest plot of individual and pooled effect sizes\\par}{\\tablefont Squares show study effect sizes (size proportional to weight), lines show 95\\% confidence intervals, the diamond shows the pooled estimate, and the dashed line shows the prediction interval.\\par}',
    '\\end{figure*}'
  ].join('\n');
}

// ============================================================
// 日本語版（JSET の体裁）
// ============================================================

function jaPreamble() {
  return String.raw`\documentclass[
  lualatex, ja=standard, paper={182mm,257mm}, twocolumn, fontsize=8.5pt, baselineskip=13.5pt,
  line_length=24zw, column_gap=6.1mm, number_of_lines=45, head_space=24.5mm, gutter=16.25mm
]{jlreq}
\usepackage[haranoaji]{luatexja-preset}
\usepackage{luatexja-fontspec}
\setmainfont{TeX Gyre Termes}
\setsansfont{TeX Gyre Heros}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{array}
\usepackage{xurl}
\urlstyle{same}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage{microtype}
\usepackage{needspace}
\setlength{\parindent}{1\zw}
\setlength{\columnsep}{6.1mm}
\newcommand{\tablefont}{\fontsize{7.5pt}{10.5pt}\selectfont}
\renewcommand{\floatpagefraction}{0.7}
\renewcommand{\topfraction}{0.9}
\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\fancyfoot[L]{\fontsize{7.5pt}{9pt}\selectfont SERIES}
\fancyfoot[R]{\fontsize{9pt}{11pt}\selectfont\thepage}
\fancypagestyle{plain}{\fancyhf{}\renewcommand{\headrulewidth}{0pt}%
  \fancyfoot[L]{\fontsize{7.5pt}{9pt}\selectfont SERIES}\fancyfoot[R]{\fontsize{9pt}{11pt}\selectfont\thepage}}
\newcommand{\chap}[2]{\par\vspace{13.5pt}\needspace{4\baselineskip}{\centering\gtfamily\bfseries #1．#2\par}\nopagebreak}
\newcommand{\secn}[3]{\par\needspace{3\baselineskip}{\noindent\gtfamily\bfseries #1.#2.\hspace{1\zw}#3\par}\nopagebreak}
\newcommand{\chapspaced}[1]{\par\vspace{13.5pt}\needspace{4\baselineskip}{\centering\gtfamily\bfseries #1\par}\nopagebreak}
`;
}

function buildJsetTex(report, text, enText, bib, links, figFile) {
  const theme = report.theme;
  const title = paper.paperTitle(theme, 'ja');
  const o = [];
  o.push(jaPreamble().split('SERIES').join(escText(paper.series(report, 'ja'))));
  o.push('\\begin{document}');
  const absJa = htmlToTex(jsetText(c.italicStats(c.escapeHtml(paper.abstractText(report, 'ja', text, bib)))));
  const kw = escText(paperKeywords('ja', text).join('，'));
  o.push('\\twocolumn[{%');
  o.push('\\noindent\\fbox{\\parbox[c][16pt][c]{62mm}{\\centering\\gtfamily\\fontsize{9pt}{16pt}\\selectfont 生成AI論文}}\\hfill{\\fontsize{8pt}{12pt}\\selectfont ' + escText(paper.series(report, 'ja')) + '}\\par');
  o.push('\\vspace{14pt}{\\centering\\gtfamily\\bfseries\\fontsize{13pt}{20pt}\\selectfont ' + escText(title) + '\\textsuperscript{†}\\par}\\vspace{10pt}');
  o.push('{\\raggedleft\\gtfamily\\bfseries\\fontsize{10pt}{15pt}\\selectfont ' + escText(config.author.nameJa) + '\\hspace{4mm}\\par}\\vspace{10pt}');
  o.push('\\begin{center}\\parbox{\\dimexpr\\textwidth-12mm\\relax}{\\setlength{\\parindent}{1\\zw}' + absJa + '\\par');
  o.push('{\\gtfamily キーワード}：' + kw + '\\par}\\end{center}\\vspace{4pt}');
  o.push('}]');
  o.push('{\\makeatletter\\renewcommand{\\thefootnote}{}\\let\\@makefnmark\\@empty\\footnotetext{\\fontsize{7.5pt}{11pt}\\selectfont ' + escText(report.dateJa) + '公開}\\makeatother}');
  o.push('\\renewcommand{\\thefootnote}{†}\\footnotetext{\\fontsize{7.5pt}{11pt}\\selectfont ' +
    escText(config.author.nameEn) + '：' + escText(paper.paperTitle(theme, 'en')) + '}');

  let ch = 0;
  let sec = 0;
  const chapter = (t) => { ch++; sec = 0; return `\\chap{${ch}}{${escText(t)}}`; };
  const block = (b) => {
    if (typeof b === 'string') return texPara(bib, b, 'ja') + '\n';
    if (b.h2) { sec++; return `\\secn{${ch}}{${sec}}{${escText(b.h2)}}`; }
    if (b.table === 1) return texTable(c.table1(report, 'ja', bib), 'ja');
    if (b.table === 2) return texTable(c.table2(report, 'ja', bib), 'ja');
    if (b.table === 3) return texTable(c.table3(report, 'ja'), 'ja');
    if (b.figure) return texFigure(figFile, 'ja');
    return '';
  };
  const para = (t) => texPara(bib, t, 'ja') + '\n';

  o.push(chapter('はじめに'));
  text.introduction.forEach((p) => o.push(para(p)));
  o.push(chapter('方法'));
  c.methodBlocks(report, 'ja').forEach((b) => o.push(block(b)));
  o.push(chapter('結果'));
  c.resultsBlocks(report, 'ja', bib).forEach((b) => o.push(block(b)));
  o.push(chapter('考察'));
  text.discussion.forEach((p) => o.push(para(p)));
  o.push(chapter('まとめ'));
  text.conclusion.forEach((p) => o.push(para(p)));
  text.limitations.forEach((p) => o.push(para(p)));
  o.push(para(c.automationLimitation('ja')));

  const models = [...report.models].join(', ');
  o.push('\\chapspaced{付\\hspace{1\\zw}記}');
  o.push(para(`本論文は，${config.author.nameJa}が生成AIを用いて自動で作成した「生成AI論文」である．文献の選別，データの抽出，はじめに・考察・まとめの文章の作成には大規模言語モデル（${models}）を用い，統計量はすべてプログラムで計算した．査読は受けていない．`));
  o.push(para(`同じ内容の英語版がある（${links.paperEn}）．抽出したデータとプログラムは https://github.com/${config.repo.owner}/${config.repo.name} で公開している．`));

  o.push('\\chapspaced{参考文献}');
  o.push('{\\noindent * はメタ分析に含めた研究を示す．\\par}');
  o.push('{\\small');
  bib.references().forEach((r) => {
    o.push('\\par\\noindent\\hangindent=2\\zw\\hangafter=1 ' + htmlToTex(c.etal(c.refHtml(r.segs))) + '\\par');
  });
  o.push('}');

  o.push('\\chapspaced{Summary}');
  o.push('{\\setlength{\\parindent}{1\\zw}\\noindent ' + htmlToTex(c.italicStats(c.escapeHtml(paper.abstractText(report, 'en', enText, bib)))) + '\\par');
  o.push('KEYWORDS: ' + escText(paperKeywords('en', enText).map((k) => k.toUpperCase()).join(', ')) + '\\par}');
  o.push('\\end{document}');
  return o.join('\n') + '\n';
}

function paperKeywords(lang, text) {
  const base = lang === 'ja' ? ['メタ分析'] : ['meta-analysis'];
  return base.concat(text.keywords.filter((k) => k.toLowerCase() !== base[0])).slice(0, 6);
}

// ============================================================
// 英語版（APA 第7版の原稿形式）
// ============================================================
// apa7 クラスの man（原稿）形式: 余白1インチ・Times 12pt・2倍行間・見出しは5水準（番号なし）・
// タイトルページ（題名・著者・Author Note）・Abstract・Keywords・表と図は本文中（floatsintext）。
// 本文は「著者, 年」の引用、参考文献は著者の姓のアルファベット順（ぶら下げ字下げ）。
// 表の題は「Table 1」（太字）の次の行に斜体の題名、注は表の下に Note. で始める（threeparttable）。

function apaPreamble() {
  return String.raw`\documentclass[man,a4paper,12pt,floatsintext,nolmodern,notab]{apa7}
\usepackage[american]{babel}
\usepackage{fontspec}
\setmainfont{TeX Gyre Termes}
\setsansfont{TeX Gyre Heros}
\newfontfamily\cjkfont{HaranoAjiMincho-Regular.otf}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{array}
\usepackage{xurl}
\urlstyle{same}
\hypersetup{hidelinks}
\usepackage{longtable}
\usepackage{needspace}
\usepackage{setspace}
\usepackage{microtype}
\newcommand{\tablefont}{\small}
`;
}

/** 走り書きの見出し（Running head）。APA は 50 字以内の大文字 */
function runningHead(title) {
  const words = String(title).replace(/:.*$/, '').toUpperCase().split(/\s+/);
  let out = '';
  for (const w of words) {
    if ((out + ' ' + w).trim().length > 50) break;
    out = (out + ' ' + w).trim();
  }
  // 「…AND」「…OF」で終わらないようにする
  return out.replace(/(\s+(AND|OF|THE|IN|ON|FOR|TO|BY|WITH|A|AN|OR|BETWEEN))+$/, '');
}

/** 段落（APA）。引用は「著者, 年」、Fig. は Figure、et al. はイタリックにしない */
function texParaApa(bib, text) {
  let h = c.italicStats(c.escapeHtml(bib.resolve(text)));
  h = h.replace(/\bFig\. (\d)/g, 'Figure $1')
    .replace(/https?:\/\/[^\s)（）<]+?(?=[.,)]?(?:\s|$|<|\)))/g, (u) => `<a href="${u}">${u}</a>`);
  return htmlToTex(h);
}

function texTableApa(t) {
  const n = t.head.length;
  let spec;
  if (t.widths) {
    const total = t.widths.reduce((a, b) => a + b, 0);
    spec = t.widths.map((w) => `>{\\raggedright\\arraybackslash}p{${(w / total).toFixed(4)}\\dimexpr\\linewidth-${2 * n}\\tabcolsep\\relax}`).join('');
  } else {
    spec = 'l' + 'r'.repeat(n - 1);
  }
  const cell = (x) => htmlToTex(c.escapeHtml(x));
  const rows = t.rows.map((r) => r.map(cell).join(' & ') + ' \\\\').join('\n');
  const note = '\\textit{Note.} ' + htmlToTex(c.italicStats(c.escapeHtml(t.note)));
  const head = t.head.map((h) => htmlToTex(headCell(h))).join(' & ') + ' \\\\';
  // apa7 の表は浮動体で、1ページに収まらないと下の行が消える（2026-10-10 に9/29の表2で発生）。
  // そこで、ページをまたげる longtable で組み、APA の題（Table N を太字、次の行に斜体の題名）と注は手で書く。
  // 見出し行は各ページに繰り返す
  // 題（Table N と斜体の題名）は最初の見出しの中に入れ、表と別のページに離れないようにする
  const caption = `\\multicolumn{${n}}{@{}l@{}}{\\textbf{Table ${t.number}}} \\\\\n` +
    `\\multicolumn{${n}}{@{}p{\\linewidth}@{}}{\\textit{${htmlToTex(c.escapeHtml(t.title))}}} \\\\[3pt]`;
  return [
    '\\par\\vspace{4pt}',
    '{\\tablefont\\singlespacing\\setlength{\\LTpre}{6pt}\\setlength{\\LTpost}{2pt}',
    `\\begin{longtable}{${spec}}`,
    caption,
    '\\toprule',
    head,
    '\\midrule',
    '\\endfirsthead',
    '\\toprule',
    head,
    '\\midrule',
    '\\endhead',
    rows,
    '\\bottomrule',
    '\\end{longtable}',
    `\\noindent ${note}\\par}`,
    '\\vspace{6pt}'
  ].join('\n');
}

function texFigureApa(file) {
  return [
    '\\begin{figure}[!htbp]',
    '\\caption{Forest Plot of Individual and Pooled Effect Sizes}',
    `\\includegraphics[width=\\linewidth]{${file}}`,
    '\\figurenote{Squares show study effect sizes (size proportional to weight), lines show 95\\% confidence intervals, the diamond shows the pooled estimate, and the dashed line shows the prediction interval.}',
    '\\end{figure}'
  ].join('\n');
}

function buildApaTex(report, text, bib, links, figFile) {
  cjkWrap = true;
  try {
    return apaTexBody(report, text, bib, links, figFile);
  } finally {
    cjkWrap = false;
  }
}

function apaTexBody(report, text, bib, links, figFile) {
  const theme = report.theme;
  const title = paper.paperTitle(theme, 'en');
  const models = [...report.models].join(', ');
  const o = [];
  o.push(apaPreamble());
  o.push('\\title{' + escText(title) + '}');
  o.push('\\shorttitle{' + escText(runningHead(title)) + '}');
  o.push('\\authorsnames{' + escText(config.author.nameEn) + '}');
  o.push('\\authorsaffiliations{Generative AI paper}');
  o.push('\\abstract{' + htmlToTex(c.italicStats(c.escapeHtml(paper.abstractText(report, 'en', text, bib).replace(/\s+/g, ' ')))) + '}');
  o.push('\\keywords{' + escText(paperKeywords('en', text).join(', ')) + '}');
  const authorNote = [
    `This is a “Generative AI paper” produced automatically by the ${config.author.nameEn} with generative AI. Large language models (${models}) were used to screen records, extract data, and draft the Introduction, Discussion, and Conclusion; all statistics were computed by software. The paper has not been peer reviewed.`,
    `The Japanese version of this paper, with identical content, is available at ${links.paperJa}. Published ${report.dateEn}.`,
    `Data and code are available at https://github.com/${config.repo.owner}/${config.repo.name}. © ${report.date.slice(0, 4)} ${config.author.nameEn}.`
  ].map((s) => texParaApa(bib, s)).join('\n\n');
  o.push('\\authornote{' + authorNote + '}');
  o.push('\\begin{document}');
  o.push('\\maketitle');

  const para = (t) => texParaApa(bib, t) + '\n';
  const block = (b) => {
    if (typeof b === 'string') return para(b);
    if (b.h2) return `\\subsection{${escText(b.h2)}}`;
    if (b.table === 1) return texTableApa(c.table1(report, 'en', bib));
    if (b.table === 2) return texTableApa(c.table2(report, 'en', bib));
    if (b.table === 3) return texTableApa(c.table3(report, 'en'));
    if (b.figure) return texFigureApa(figFile);
    return '';
  };

  // 序論には見出しを付けない（APA 第7版。本文の頭に題名をもう一度書く）
  // （apa7 が本文の頭に題名を自動で入れるので、ここでは書かない）
  text.introduction.forEach((p) => o.push(para(p)));
  o.push('\\section{Method}');
  c.methodBlocks(report, 'en').forEach((b) => o.push(block(b)));
  o.push('\\section{Results}');
  c.resultsBlocks(report, 'en', bib).forEach((b) => o.push(block(b)));
  o.push('\\section{Discussion}');
  text.discussion.forEach((p) => o.push(para(p)));
  o.push('\\section{Conclusion}');
  text.conclusion.forEach((p) => o.push(para(p)));
  text.limitations.forEach((p) => o.push(para(p)));
  o.push(para(c.automationLimitation('en')));

  o.push('\\section{References}');
  o.push('\\noindent References marked with an asterisk indicate studies included in the meta-analysis.\\par');
  bib.references().forEach((r) => {
    o.push('\\par\\noindent\\hangindent=0.5in\\hangafter=1 ' + htmlToTex(c.refHtml(r.segs)) + '\\par');
  });
  o.push('\\end{document}');
  return o.join('\n') + '\n';
}


// ============================================================
// コンパイル
// ============================================================

/** lualatex があるか */
function available() {
  const r = spawnSync('lualatex', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  return r.status === 0;
}

/** .tex を2回コンパイルして PDF を作る。log の「Missing character」は失敗にする。補助ファイルは消す */
function compile(texFile) {
  const dir = path.dirname(texFile);
  const base = path.basename(texFile, '.tex');
  let log = '';
  for (let pass = 1; pass <= 2; pass++) {
    const r = spawnSync('lualatex', ['-interaction=nonstopmode', '-halt-on-error', '-file-line-error', base + '.tex'],
      { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
    log = (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0) {
      const logFile = path.join(dir, base + '.log');
      const tail = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => /^!|^\S+:\d+:/.test(l)).slice(0, 8).join('\n') : log.slice(-800);
      throw new Error(`${base}.tex の LuaLaTeX が失敗しました（${pass}回目）\n${tail}`);
    }
  }
  const logText = fs.readFileSync(path.join(dir, base + '.log'), 'utf8');
  const missing = [...new Set((logText.match(/Missing character: There is no [^\n]*/g) || []))];
  const overfull = (logText.match(/Overfull \\hbox \((\d+(\.\d+)?)pt too wide\)/g) || [])
    .filter((x) => Number(x.match(/\((\d+(\.\d+)?)/)[1]) > 8).length;
  ['aux', 'log', 'out', 'fls', 'fdb_latexmk'].forEach((ext) => { try { fs.unlinkSync(path.join(dir, base + '.' + ext)); } catch (e) { /* なければよい */ } });
  return { pdf: path.join(dir, base + '.pdf'), missing, overfull };
}

module.exports = { buildJsetTex, buildApaTex, compile, available, htmlToTex, escText, texPara };
