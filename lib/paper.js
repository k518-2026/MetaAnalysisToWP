/**
 * 論文の体裁（HTML。render.js が Chrome で PDF にする）
 *
 *   日本語版 … 日本教育工学会論文誌のテンプレート（jset_template_20230907.docx）の体裁
 *              B5・2段組・本文 明朝 8.5pt（行送り 13.5pt、1行24字）・見出し ゴシック
 *              左上の論文種別の枠は「生成AI論文」。抄録（400字以内）・キーワード（5〜6語）、
 *              章「1．」節「1.1.」、図の題は図の下・表の題は表の上、参考文献は JSET の形、最後に Summary と KEYWORDS
 *   英語版   … ITEL の Translation 用テンプレート（itel_translation_template_JAN2023.docx）の体裁
 *              A4・2段組・本文 Times 9pt・題名 Arial 14pt・見出し Arial 太字
 *              左上の論文種別は「Generative AI paper」。Abstract（150語以内）・Keywords、
 *              参考文献は IEEE の形（引用順の番号）、Author notes
 *
 * テンプレートにある学会誌名・巻号・著作権表示・CC のマークは**使わない**。
 * その雑誌に載った論文だと誤解されないよう、柱と欄外は教育情報分析研究会（SEDA）の表記にしてある。
 *
 * 方法・結果・表の中身は content.js。序論・考察・まとめの文章はモデル（write.js）が書く。
 */
const config = require('../config');
const { back, magnitude } = require('./meta');
const c = require('./content');
const cite = require('./cite');

const GOTHIC = "'MS Gothic', 'ＭＳ ゴシック', 'Yu Gothic', 'Noto Sans CJK JP', 'Noto Sans JP', sans-serif";
const MINCHO = "'MS Mincho', 'ＭＳ 明朝', 'Yu Mincho', 'Noto Serif CJK JP', 'Noto Serif JP', serif";
const TIMES = "'Times New Roman', 'Liberation Serif', 'Nimbus Roman', 'Noto Serif', serif";
const ARIAL = "Arial, 'Liberation Sans', 'Nimbus Sans', Helvetica, sans-serif";

const CJK = '[\\u301c\\u3040-\\u30ff\\u4e00-\\u9fff]';
const ZEN = '０１２３４５６７８９';

/** JSET の表記: 句読点は「，」「．」、括弧は半角、1桁の数字は全角（日本語に接するもの） */
function jsetText(html) {
  return html
    .replace(/、/g, '，').replace(/。/g, '．')
    .replace(/（/g, ' (').replace(/）/g, ') ')
    .replace(/ \(\s*/g, ' (').replace(/\s*\) ([，．])/g, ')$1').replace(/^ \(/, '(')
    .replace(new RegExp('(?<=' + CJK + ')(\\d)(?![\\d.,])', 'g'), (d) => ZEN[d])
    .replace(new RegExp('(?<![\\d.,])(\\d)(?=' + CJK + ')', 'g'), (d) => ZEN[d]);
}

function series(report, lang) {
  const y = report.date.slice(0, 4);
  return lang === 'ja' ? `${config.author.nameJa}　生成AI論文　${y}` : `${config.author.shortEn} GENERATIVE AI PAPERS, ${y}`;
}

function paperTitle(theme, lang) {
  return lang === 'ja' ? theme.titleJa + '：メタ分析' : theme.titleEn + ': A Meta-Analysis';
}

/** 段落。引用を解決 → HTML → et al. と統計記号をイタリック → （日本語版は）JSET の表記 */
function para(bib, text, lang, cls) {
  let h = c.italicStats(c.etal(c.escapeHtml(bib.resolve(text))));
  if (lang === 'ja') h = jsetText(h);
  h = h.replace(/⟦/g, '<span class="q" lang="en">').replace(/⟧/g, '</span>')
    .replace(/https?:\/\/[^\s)（）<]+?(?=[.,)]?(?:\s|$|<|\)))/g, (u) => `<span class="q">${u}</span>`);
  return `<p${cls ? ` class="${cls}"` : ''}>${h}</p>`;
}

function headCell(h) {
  return c.escapeHtml(h).replace(/^(k|N|g|r|p)(?=$|\s)/, '<i>$1</i>').replace(/I²/, '<i>I</i>²').replace(/τ²/, '<i>τ</i>²');
}

function tableHtml(t, lang) {
  const ja = lang === 'ja';
  const cap = ja
    ? `<p class="cap">表${ZEN[t.number] || t.number}　${c.escapeHtml(t.title)}</p>`
    : `<p class="cap"><b>Table ${t.number}.</b> ${c.escapeHtml(t.title)}</p>`;
  const cell = (x) => c.etal(c.escapeHtml(x));
  return `<div class="wide table-block">${cap}` +
    '<table><thead><tr>' + t.head.map((h) => '<th>' + headCell(h) + '</th>').join('') + '</tr></thead><tbody>' +
    t.rows.map((r) => '<tr>' + r.map((x, i) => `<td${(t.wrap || []).includes(i) ? '' : ' class="nw"'}>` + cell(x) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table>' +
    `<p class="tnote">${ja ? '注：' : '<i>Note.</i> '}${c.italicStats(c.escapeHtml(t.note))}</p></div>`;
}

function figureHtml(svg, lang) {
  const ja = lang === 'ja';
  return `<div class="wide figure-block">${svg}` +
    (ja
      ? '<p class="cap">図１　フォレストプロット</p><p class="tnote">注：四角は各研究の効果量 (大きさは重み)，横線は95%信頼区間，ひし形は統合値，点線は予測区間を表す．</p>'
      : '<p class="cap"><b>Figure 1.</b> Forest plot of individual and pooled effect sizes</p><p class="tnote">Squares show study effect sizes (size proportional to weight), lines show 95% confidence intervals, the diamond shows the pooled estimate, and the dashed line shows the prediction interval.</p>') +
    '</div>';
}

/** 抄録・Abstract（引用は入れない）。結果の文はコードが書く */
function abstractText(report, lang, text, bib) {
  const et = report.theme.effect;
  const o = report.analysis.overall;
  const m = c.measureName(et);
  const pooled = `${m} = ${c.fe(et, back(et, o.est))}`;
  const pci = c.ci(et, back(et, o.ci[0]), back(et, o.ci[1]));
  if (lang === 'ja') {
    return [bib.strip(text.background),
      `国内外のオープンアクセス論文から条件に合う${o.k}本 (参加者${report.analysis.totalN}人) を自動で選別・抽出し，数値を本文と照合したうえでランダム効果モデルにより統合した．`,
      `統合値は ${pooled}，95%信頼区間 ${pci}，I² = ${c.f(o.I2, 1)}% であった．`,
      bib.strip(text.conclusionAbstract)].join('');
  }
  return [bib.strip(text.background),
    `Using an automated workflow in which every extracted number was verified against the full text, ${o.k} open-access studies (N = ${report.analysis.totalN}) were pooled with a random-effects model.`,
    `The pooled effect was ${pooled}, 95% CI ${pci}, with I² = ${c.f(o.I2, 1)}%.`,
    bib.strip(text.conclusionAbstract)].join(' ');
}

function keywordList(lang, text) {
  const base = lang === 'ja' ? ['メタ分析'] : ['meta-analysis'];
  return base.concat(text.keywords.filter((k) => k.toLowerCase() !== base[0])).slice(0, 6);
}

// ============================================================
// 日本語版（JSET の体裁）
// ============================================================

function jsetCss() {
  return `
@page { size: 182mm 257mm; margin: 24.5mm 16mm 22.5mm 16mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: ${MINCHO}; font-size: 8.5pt; line-height: 13.5pt; color: #000; }
p { margin: 0; text-indent: 1em; text-align: justify; }
.head { display: flex; justify-content: space-between; align-items: center; }
.type-box { border: 0.75pt solid #000; width: 62mm; text-align: center; font-family: ${GOTHIC}; font-size: 9pt; line-height: 16pt; }
.series { font-size: 8pt; }
h1.title { font-family: ${GOTHIC}; font-size: 13pt; line-height: 20pt; font-weight: bold; text-align: center; margin: 14pt 0 10pt; }
.authors { text-align: right; font-size: 10pt; line-height: 15pt; font-weight: bold; margin-right: 4mm; }
.abstract { margin: 10pt 6mm 0; }
.kw { margin: 0 6mm 0; text-indent: 1em; }
.kw b { font-family: ${GOTHIC}; }
.tfoot { width: 72mm; margin: 8pt 0 10pt; padding-top: 3pt; border-top: 0.5pt solid #000; font-size: 7.5pt; line-height: 11pt; }
.tfoot p { text-indent: 0; text-align: left; }
.cols { column-count: 2; column-gap: 6.1mm; column-fill: balance; }
h2 { font-family: ${GOTHIC}; font-size: 8.5pt; font-weight: bold; text-align: center; margin: 13.5pt 0 0; line-height: 13.5pt; break-after: avoid; }
h3 { font-family: ${GOTHIC}; font-size: 8.5pt; font-weight: bold; text-align: left; margin: 0; line-height: 13.5pt; break-after: avoid; }
h2.spaced { letter-spacing: 1em; }
.wide { column-span: all; margin: 8pt 0; break-inside: avoid; }
.cap { font-family: ${GOTHIC}; text-align: center; text-indent: 0; margin: 2pt 0; }
table { border-collapse: collapse; width: 100%; font-size: 7.5pt; line-height: 10.5pt; }
th { border-top: 0.75pt solid #000; border-bottom: 0.5pt solid #000; font-weight: normal; text-align: left; padding: 1.5pt 3pt; }
td { padding: 1.5pt 3pt; vertical-align: top; }
tbody tr:last-child td { border-bottom: 0.75pt solid #000; }
.tnote { font-size: 7.5pt; line-height: 10.5pt; text-indent: 0; margin-top: 2pt; }
.figure-block svg { width: 100%; height: auto; }
.ref { text-indent: -2em; padding-left: 2em; text-align: left; overflow-wrap: anywhere; }
.ref[lang="en"], .summary { hyphens: auto; }
.q { overflow-wrap: anywhere; word-break: break-all; }
td.nw, th.nw { white-space: nowrap; }
.vol { font-family: ${GOTHIC}; }
.summary p { text-indent: 1em; font-family: ${MINCHO}; }
a { color: #000; text-decoration: none; }
i { font-style: italic; }
`;
}

function buildJsetHtml(report, text, enText, svg, bib, links) {
  const theme = report.theme;
  const title = paperTitle(theme, 'ja');
  const out = [];
  out.push(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>${c.escapeHtml(title)}</title><style>${jsetCss()}</style></head><body>`);

  out.push('<div class="head"><div class="type-box">生成AI論文</div>' +
    `<div class="series">${c.escapeHtml(series(report, 'ja'))}</div></div>`);
  out.push(`<h1 class="title">${c.escapeHtml(title)}<sup>†</sup></h1>`);
  out.push(`<p class="authors">${c.escapeHtml(config.author.nameJa)}</p>`);
  out.push(`<div class="abstract"><p>${jsetText(c.italicStats(c.escapeHtml(abstractText(report, 'ja', text, bib))))}</p></div>`);
  out.push(`<p class="kw"><b>キーワード</b>：${c.escapeHtml(keywordList('ja', text).join('，'))}</p>`);
  out.push(`<div class="tfoot"><p>${c.escapeHtml(report.dateJa)}公開</p>` +
    `<p><sup>†</sup>${c.escapeHtml(config.author.nameEn)}：${c.escapeHtml(paperTitle(theme, 'en'))}</p></div>`);

  out.push('<div class="cols">');
  let ch = 0;
  const chapter = (t) => { ch++; sec = 0; return `<h2>${ch}．${c.escapeHtml(t)}</h2>`; };
  let sec = 0;
  const block = (b) => {
    if (typeof b === 'string') return para(bib, b, 'ja');
    if (b.h2) { sec++; return `<h3>${ch}.${sec}.　${c.escapeHtml(b.h2)}</h3>`; }
    if (b.table === 1) return tableHtml(c.table1(report, 'ja', bib), 'ja');
    if (b.table === 2) return tableHtml(c.table2(report, 'ja'), 'ja');
    if (b.figure) return figureHtml(svg, 'ja');
    return '';
  };

  out.push(chapter('はじめに'));
  text.introduction.forEach((p) => out.push(para(bib, p, 'ja')));
  out.push(chapter('方法'));
  c.methodBlocks(report, 'ja').forEach((b) => out.push(block(b)));
  out.push(chapter('結果'));
  c.resultsBlocks(report, 'ja').forEach((b) => out.push(block(b)));
  out.push(chapter('考察'));
  text.discussion.forEach((p) => out.push(para(bib, p, 'ja')));
  out.push(chapter('まとめ'));
  text.conclusion.forEach((p) => out.push(para(bib, p, 'ja')));
  text.limitations.forEach((p) => out.push(para(bib, p, 'ja')));
  out.push(para(bib, c.automationLimitation('ja'), 'ja'));

  const models = [...report.models].join(', ');
  out.push('<h2 class="spaced">付記</h2>');
  out.push(para(bib, `本論文は，${config.author.nameJa}が生成AIを用いて自動で作成した「生成AI論文」である．文献の選別，データの抽出，はじめに・考察・まとめの文章の作成には大規模言語モデル（${models}）を用い，統計量はすべてプログラムで計算した．査読は受けていない．`, 'ja'));
  out.push(para(bib, `同じ内容の英語版がある（${links.paperEn}）．抽出したデータとプログラムは https://github.com/${config.repo.owner}/${config.repo.name} で公開している．`, 'ja'));

  out.push('<h2 class="spaced">参考文献</h2>');
  out.push('<p class="ref" style="text-indent:0;padding-left:0">* はメタ分析に含めた研究を示す．</p>');
  bib.references().forEach((r) => {
    const en = !r.segs.some((x) => cite.isJapanese(x.text));
    out.push(`<p class="ref"${en ? ' lang="en"' : ''}>` + c.etal(c.refHtml(r.segs)) + '</p>');
  });

  // Summary（抄録の英訳）と KEYWORDS
  out.push('<h2>Summary</h2>');
  out.push(`<div class="summary" lang="en"><p>${c.italicStats(c.escapeHtml(abstractText(report, 'en', enText, bib)))}</p>` +
    `<p>KEYWORDS: ${c.escapeHtml(keywordList('en', enText).map((k) => k.toUpperCase()).join(', '))}</p></div>`);
  out.push('</div></body></html>');
  return out.join('\n');
}

// ============================================================
// 英語版（ITEL の体裁）
// ============================================================

function itelCss() {
  return `
@page { size: A4; margin: 30mm 30mm 32mm 30mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: ${TIMES}; font-size: 9pt; line-height: 11pt; color: #000; }
p { margin: 0; text-indent: 1.5em; text-align: justify; hyphens: auto; }
.series { text-align: right; font-size: 8pt; letter-spacing: 0.02em; }
.type { font-family: ${ARIAL}; font-weight: bold; font-size: 10pt; margin-top: 16pt; text-indent: 0; }
h1.title { font-family: ${ARIAL}; font-size: 14pt; line-height: 18pt; font-weight: bold; margin: 8pt 0 6pt; }
.authors { font-size: 11pt; line-height: 14pt; font-weight: bold; text-indent: 0; }
.orig { font-style: italic; margin: 8pt 0 8pt; text-indent: 0; }
.abs { font-size: 8pt; line-height: 10pt; text-indent: 0; margin-bottom: 2pt; }
.cols { column-count: 2; column-gap: 7.5mm; margin-top: 14pt; column-fill: balance; }
h2 { font-family: ${ARIAL}; font-size: 11pt; font-weight: bold; margin: 10pt 0 4pt; break-after: avoid; }
h3 { font-family: ${ARIAL}; font-size: 10pt; font-weight: bold; margin: 7pt 0 3pt; break-after: avoid; }
h2 + p, h3 + p, .noind { text-indent: 0; }
.wide { column-span: all; margin: 8pt 0; break-inside: avoid; }
.cap { text-indent: 0; margin: 3pt 0; text-align: left; }
table { border-collapse: collapse; width: 100%; font-size: 8pt; line-height: 10pt; }
th { border-top: 0.75pt solid #000; border-bottom: 0.5pt solid #000; font-weight: normal; text-align: left; padding: 1.5pt 3pt; }
td { padding: 1.5pt 3pt; vertical-align: top; }
tbody tr:last-child td { border-bottom: 0.75pt solid #000; }
.tnote { font-size: 8pt; line-height: 10pt; text-indent: 0; margin-top: 2pt; }
.figure-block svg { width: 100%; height: auto; }
.ref { display: flex; text-indent: 0; text-align: left; margin-bottom: 1.5pt; }
.ref .n { flex: 0 0 2.4em; }
.ref .t { flex: 1; overflow-wrap: anywhere; }
td.nw, th.nw { white-space: nowrap; }
a { color: #000; text-decoration: none; }
`;
}

function buildItelHtml(report, text, svg, bib, links) {
  const theme = report.theme;
  const title = paperTitle(theme, 'en');
  const out = [];
  out.push(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${c.escapeHtml(title)}</title><style>${itelCss()}</style></head><body>`);
  out.push(`<p class="series">${c.escapeHtml(series(report, 'en'))}</p>`);
  out.push('<p class="type">Generative AI paper</p>');
  out.push(`<h1 class="title">${c.escapeHtml(title)}</h1>`);
  out.push(`<p class="authors">${c.escapeHtml(config.author.nameEn)}</p>`);
  out.push(`<p class="orig">(The Japanese version of this paper, with identical content, is available at ${c.escapeHtml(links.paperJa)}. Published ${c.escapeHtml(report.dateEn)}.)</p>`);
  out.push(`<p class="abs"><b><i>Abstract</i></b> ${c.italicStats(c.escapeHtml(abstractText(report, 'en', text, bib)))}</p>`);
  out.push(`<p class="abs"><b><i>Keywords</i></b> ${c.escapeHtml(keywordList('en', text).join(', '))}</p>`);

  out.push('<div class="cols">');
  let ch = 0;
  let sec = 0;
  const chapter = (t) => { ch++; sec = 0; return `<h2>${ch}. ${c.escapeHtml(t)}</h2>`; };
  const block = (b) => {
    if (typeof b === 'string') return para(bib, b, 'en');
    if (b.h2) { sec++; return `<h3>${ch}.${sec} ${c.escapeHtml(b.h2)}</h3>`; }
    if (b.table === 1) return tableHtml(c.table1(report, 'en', bib), 'en');
    if (b.table === 2) return tableHtml(c.table2(report, 'en'), 'en');
    if (b.figure) return figureHtml(svg, 'en');
    return '';
  };

  out.push(chapter('Introduction'));
  text.introduction.forEach((p) => out.push(para(bib, p, 'en')));
  out.push(chapter('Method'));
  c.methodBlocks(report, 'en').forEach((b) => out.push(block(b)));
  out.push(chapter('Results'));
  c.resultsBlocks(report, 'en').forEach((b) => out.push(block(b)));
  out.push(chapter('Discussion'));
  text.discussion.forEach((p) => out.push(para(bib, p, 'en')));
  out.push(chapter('Conclusion'));
  text.conclusion.forEach((p) => out.push(para(bib, p, 'en')));
  text.limitations.forEach((p) => out.push(para(bib, p, 'en')));
  out.push(para(bib, c.automationLimitation('en'), 'en'));

  const models = [...report.models].join(', ');
  out.push('<h2>Author notes</h2>');
  out.push(para(bib, `This is a “Generative AI paper” produced automatically by the ${config.author.nameEn} with generative AI. Large language models (${models}) were used to screen records, extract data, and draft the Introduction, Discussion, and Conclusion; all statistics were computed by software. The paper has not been peer reviewed.`, 'en', 'noind'));
  out.push(para(bib, `Data and code are available at https://github.com/${config.repo.owner}/${config.repo.name}. © ${report.date.slice(0, 4)} ${config.author.nameEn}.`, 'en'));

  out.push('<h2>References</h2>');
  out.push('<p class="noind">References marked with an asterisk indicate studies included in the meta-analysis.</p>');
  bib.references().forEach((r) => out.push(`<p class="ref"><span class="n">${r.label}</span><span class="t">${c.refHtml(r.segs)}</span></p>`));
  out.push('</div></body></html>');
  return out.join('\n');
}

/** Chrome の欄外（ページ番号など）。テンプレートの学会誌名の代わりに研究会の表記 */
function margins(report, lang) {
  if (lang === 'ja') {
    return {
      header: '<div></div>',
      footer: `<div style="width:100%; font-family:${MINCHO}; font-size:7.5pt; padding:0 16mm; display:flex; justify-content:space-between;">` +
        `<span>${c.escapeHtml(series(report, 'ja'))}</span><span class="pageNumber" style="font-size:9pt"></span></div>`
    };
  }
  return {
    header: '<div></div>',
    footer: `<div style="width:100%; font-family:${TIMES}; font-size:9pt; text-align:center;"><span class="pageNumber"></span></div>`
  };
}

/** 文字数・語数の確認（JSET の抄録は400字以内、ITEL の Abstract は150語以内） */
function lengthWarnings(report, texts, bib) {
  const w = [];
  const ja = abstractText(report, 'ja', texts.ja, bib.ja).replace(/\s/g, '').length;
  const en = abstractText(report, 'en', texts.en, bib.en).split(/\s+/).filter(Boolean).length;
  if (ja > 400) w.push(`日本語版の抄録が ${ja} 字（JSET は400字以内）`);
  if (en > 150) w.push(`英語版の Abstract が ${en} 語（ITEL は150語以内）`);
  return w;
}

module.exports = { buildJsetHtml, buildItelHtml, margins, paperTitle, jsetText, abstractText, lengthWarnings, series };
