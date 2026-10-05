/**
 * 週1回のメタ分析
 *
 *   node run.js                    テーマを決めて論文を集め、メタ分析して reports/ に書き出す
 *   node run.js --theme <id>       テーマを指定する（config.js の themes の id）
 *   node run.js --force            前回から日が浅くても作る
 *   node run.js --dry-run          .cache/dry-run/ に書き出し、台帳は更新しない（手元での確認用）
 *
 * 流れ:
 *   テーマを決める → OpenAlex と J-STAGE で検索 → 要旨で選別（言語モデル）
 *   → 本文 PDF → pdftotext → データ抽出（言語モデル）→ 数値を本文と照合 → 効果量（コード）
 *   → 5本以上集まればメタ分析（コード）→ 英語の地の文 → 日本語訳 → 記事
 *   → 論文 PDF（日本語版・英語版）、図、CSV、記事の HTML を書き出す
 *
 * WordPress への送信は send-wp.js（PDF をリポジトリに push したあとで送るため、別にしてある）。
 * 外部とのやり取りは deps にまとめてある（test.js が差し替える）。
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const ledgerLib = require('./lib/ledger');
const meta = require('./lib/meta');

const ROOT = __dirname;

const deps = {
  searchOpenAlex: (theme) => require('./lib/openalex').search(theme),
  searchJstage: (theme) => require('./lib/jstage').search(theme),
  enrichJstage: (papers) => require('./lib/jstage').enrich(papers),
  screen: (theme, papers) => require('./lib/review').screen(theme, papers),
  fetchPdf: (paper) => require('./lib/pdf').fetchPdf(paper),
  extractText: (pdf) => require('./lib/pdf').extractText(pdf),
  extract: (theme, paper, text) => require('./lib/review').extract(theme, paper, text),
  writePaper: (facts) => require('./lib/write').writePaper(facts),
  translatePaper: (en) => require('./lib/write').translatePaper(en),
  writeArticle: (facts) => require('./lib/write').writeArticle(facts),
  usedModel: () => require('./lib/llm').usedModel(),
  render: async (jobs) => {
    const r = require('./lib/render');
    return r.withBrowser(async (browser) => {
      const sizes = {};
      for (const j of jobs) {
        sizes[j.file] = j.type === 'pdf'
          ? await r.htmlToPdf(browser, j.html, j.file, j)
          : await r.svgToPng(browser, j.svg, j.file);
      }
      return sizes;
    });
  },
  now: () => new Date()
};

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const options = {
  dryRun: process.argv.includes('--dry-run'),
  force: process.argv.includes('--force'),
  theme: argValue('--theme'),
  allowRepeat: process.argv.includes('--allow-repeat'),
  root: ROOT
};

// ============================================================
// 論文を集める
// ============================================================

function dedupe(papers) {
  const seen = new Set();
  return papers.filter((p) => {
    const keys = [p.doi ? 'doi:' + p.doi.toLowerCase() : '', String(p.id).toLowerCase(),
      String(p.title).toLowerCase().replace(/[^a-z0-9ぁ-んァ-ン一-龥]/g, '')].filter(Boolean);
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
}

/** 1テーマ分。集まれば report、集まらなければ { failed, reason, search } */
async function collect(theme) {
  console.log(`\n==== テーマ: ${theme.titleJa}（${theme.id}）====`);
  const search = {
    openalex: { total: 0, retrieved: 0 }, jstage: { total: 0, retrieved: 0 },
    merged: 0, screened: 0, passedScreening: 0, fullTextsTried: 0,
    excluded: { noPdf: 0, ineligible: 0, noStats: 0, unverified: 0, implausible: 0, error: 0 }
  };
  const models = new Set();

  let oa = { total: 0, papers: [] };
  try { oa = await deps.searchOpenAlex(theme); } catch (e) { console.warn('  OpenAlex の検索に失敗: ' + e.message); }
  let js = { total: 0, papers: [] };
  try { js = await deps.searchJstage(theme); } catch (e) { console.warn('  J-STAGE の検索に失敗: ' + e.message); }
  search.openalex = { total: oa.total, retrieved: oa.papers.length };
  search.jstage = { total: js.total, retrieved: js.papers.length };
  console.log(`  OpenAlex ${oa.papers.length} 件（該当 ${oa.total} 件）/ J-STAGE ${js.papers.length} 件`);

  const merged = dedupe(oa.papers.concat(js.papers));
  search.merged = merged.length;
  await deps.enrichJstage(merged.filter((p) => p.source === 'jstage'));

  const candidates = merged.filter((p) => String(p.abstract || '').length >= 100).slice(0, config.screening.maxCandidates);
  search.screened = candidates.length;
  const passed = await deps.screen(theme, candidates);
  if (deps.usedModel()) models.add(deps.usedModel());
  search.passedScreening = passed.length;
  console.log(`  選別: ${candidates.length} 件中 ${passed.length} 件が候補`);

  const examined = [];
  const studies = [];
  for (const paper of passed) {
    if (studies.length >= config.studies.max || search.fullTextsTried >= config.studies.maxFullTexts) break;
    search.fullTextsTried++;
    const log = { id: paper.id, title: paper.title, year: paper.year, screenScore: paper.screen.score, outcome: '' };
    examined.push(log);
    console.log(`  [${search.fullTextsTried}] ${paper.title.slice(0, 90)}（${paper.year}）`);

    const pdf = await deps.fetchPdf(paper);
    if (!pdf) { search.excluded.noPdf++; log.outcome = 'PDF を取得できない'; continue; }
    const text = deps.extractText(pdf);
    if (text.length < config.pdfTextMinChars) {
      search.excluded.noPdf++; log.outcome = `本文を読み取れない（${text.length} 字）`; continue;
    }

    let data;
    try {
      data = await deps.extract(theme, paper, text);
    } catch (e) {
      search.excluded.error++; log.outcome = '抽出に失敗: ' + e.message.slice(0, 150);
      console.warn('    ' + log.outcome);
      continue;
    }
    if (data.model) models.add(data.model);
    log.extracted = data;
    if (!data.eligible) { search.excluded.ineligible++; log.outcome = '適格でない: ' + data.reason; console.log('    ' + log.outcome); continue; }
    if (data.unverified.length) {
      search.excluded.unverified++; log.outcome = '本文で確認できない数値: ' + data.unverified.join(', ');
      console.log('    ' + log.outcome); continue;
    }
    const effect = meta.computeEffect(theme.effect, data.stats);
    if (effect.error) { search.excluded.noStats++; log.outcome = '効果量を計算できない: ' + effect.error; console.log('    ' + log.outcome); continue; }
    const bad = meta.plausible(theme.effect, effect);
    if (bad) { search.excluded.implausible++; log.outcome = bad; console.log('    ' + bad); continue; }

    log.outcome = '採用';
    console.log(`    採用: ${theme.effect === 'r' ? 'r' : 'g'} = ${effect.display.toFixed(2)}（${effect.method}、N = ${effect.n}）`);
    studies.push({ paper, data, effect, pdfUrl: pdf.url });
  }
  // 抽出が1本も成功しなかったのは仕組みの故障（AI の呼び出しの失敗など）。テーマのせいにせず止める
  if (search.excluded.error >= 3 && search.excluded.error === search.fullTextsTried - search.excluded.noPdf && !studies.length) {
    const last = examined.filter((x) => /^抽出に失敗/.test(x.outcome)).pop();
    const e = new Error('本文からの抽出がすべて失敗しました: ' + (last ? last.outcome : ''));
    e.systemic = true;
    throw e;
  }
  // 抽出に失敗したものは「適格でない」と区別できるよう、合計に入れて報告する
  search.excluded.ineligible += search.excluded.error;

  if (studies.length < config.studies.min) {
    const reason = `効果量を計算できた研究が ${studies.length} 本（${config.studies.min} 本必要）`;
    console.log('  ' + reason + '。このテーマはあきらめます。');
    return { failed: true, reason, search, examined };
  }
  studies.forEach((s, i) => { s.sid = 'S' + (i + 1); });
  return { theme, search, studies, examined, models };
}

// ============================================================
// 分析と文章
// ============================================================

function dates(now) {
  const iso = ledgerLib.jstDate(now);
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return { date: iso, dateEn: `${months[m - 1]} ${d}, ${y}`, dateJa: `${y}年${m}月${d}日` };
}

async function analyzeAndWrite(report) {
  const { buildFacts } = require('./lib/content');
  const { unknownNumbers } = require('./lib/write');
  const et = report.theme.effect;
  report.analysis = meta.analyze(et, report.studies.map((s) => ({
    id: s.sid, yi: s.effect.yi, vi: s.effect.vi, n: s.effect.n, gradeBand: s.data.gradeBand, comparator: s.data.comparisonType
  })));
  const o = report.analysis.overall;
  console.log(`\n統合: k = ${o.k}, ${et === 'r' ? 'r' : 'g'} = ${meta.back(et, o.est).toFixed(2)} [${meta.back(et, o.ci[0]).toFixed(2)}, ${meta.back(et, o.ci[1]).toFixed(2)}], I2 = ${o.I2.toFixed(1)}%`);

  const facts = buildFacts(report);
  // 効果の大きさの目安（Cohen: g は 0.2 / 0.5 / 0.8、r は .1 / .3 / .5）は、渡した数値でなくても書いてよい
  const factsText = JSON.stringify(facts) + ' 0.1 0.2 0.3 0.5 0.8';
  report.warnings = report.warnings || [];

  console.log('英語の地の文を書いています…');
  const en = await deps.writePaper(facts);
  report.models.add(deps.usedModel());
  console.log('日本語に訳しています…');
  // 適格基準（テーマの定義は英語）も一緒に訳させ、日本語版の方法の節に使う
  const theme = report.theme;
  const { ja, mismatch } = await deps.translatePaper({
    ...en, criteria: { population: theme.population, intervention: theme.intervention, comparison: theme.comparison, outcome: theme.outcome }
  });
  if (!ja.criteria || Object.values(ja.criteria).some((v) => !v)) report.warnings.push('適格基準の日本語訳が無いので英語のまま載せた');
  report.models.add(deps.usedModel());
  if (mismatch.length) report.warnings.push('日本語訳の段落数が英語と違う: ' + mismatch.join(', '));

  console.log('記事を書いています…');
  const factsJa = { ...facts, studies: facts.studies.map((s, i) => ({ ...s, summary: report.studies[i].data.summaryJa || s.summary })) };
  const article = await deps.writeArticle(factsJa);
  report.models.add(deps.usedModel());

  const flat = (t) => [t.background, t.conclusionAbstract].concat(t.introduction, t.discussion, t.limitations, t.conclusion);
  const art = [article.lead, article.question].concat(article.reading, article.hints, article.cautions);
  [['英語版', flat(en)], ['日本語版', flat(ja)], ['記事', art]].forEach(([label, texts]) => {
    const bad = unknownNumbers(texts, factsText);
    if (bad.length) report.warnings.push(`${label}に計算結果に無い数値: ${bad.join(', ')}`);
  });
  report.text = { en, ja, article };
  return report;
}

// ============================================================
// 書き出し
// ============================================================

/** 記事と論文から張るリンク。PDF と CSV は GitHub のプレビューではなくファイルへの直リンク（ユーザー指定 2026-09-29） */
function links(dir) {
  const { owner, name, branch } = config.repo;
  const raw = `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${config.paths.reports}/${dir}`;
  return {
    paperJa: `${raw}/paper-ja.pdf`,
    paperEn: `${raw}/paper-en.pdf`,
    data: `${raw}/studies.csv`,
    figure: `${raw}/forest-ja.png`,
    figureArticle: `${raw}/forest-article.png`,   // 記事用（文字を大きくした図）
    rawPaperJa: `${raw}/paper-ja.pdf`,
    dir,
    repoPath: `github.com/${owner}/${name}`
  };
}

/**
 * report から全ファイルを作る（rebuild.js からも呼ぶ）
 *   日本語版 = JSET の体裁（参考文献は JSET の形）、英語版 = ITEL の体裁（参考文献は IEEE の形）
 */
async function build(report, outDir) {
  const { Bibliography, ETAL } = require('./lib/cite');
  const content = require('./lib/content');
  const paper = require('./lib/paper');
  const { forestSvg } = require('./lib/forest');
  fs.mkdirSync(outDir, { recursive: true });
  const dir = path.basename(outDir);
  const et = report.theme.effect;
  const l = links(dir);
  const bibStudies = report.studies.map((s) => ({ sid: s.sid, paper: s.paper }));
  // 文献の番号（IEEE）は本文で初めて引いた順に振るので、論文ごとに新しく作る
  const newBib = () => ({ en: new Bibliography(bibStudies, 'ieee'), ja: new Bibliography(bibStudies, 'jset') });

  // 図の研究名は様式に合わせる（英語版 Lee et al. [1]、日本語版 LEE et al. (2021)）。
  // 英語版の番号は本文の引用順と一致させるため、本文を組んだあとの文献表から取る
  const bib = newBib();
  const html = {};
  const svg = {};
  const drawForest = (lang, b, large = false) => {
    const rows = report.studies.map((s, i) => ({
      label: b.narrative(s.sid).split(ETAL).join('et al.'), yi: s.effect.yi, vi: s.effect.vi, weight: report.analysis.overall.weights[i]
    }));
    return forestSvg(rows, report.analysis.overall, { effectType: et, lang, large });
  };
  // 英語版: 1回目で引用順を決め、その番号で図を描いて組み直す
  const probe = newBib().en;
  paper.buildItelHtml(report, report.text.en, '', probe, l);
  const ordered = new Bibliography(bibStudies, 'ieee');
  probe.order.forEach((k) => ordered.use(k));
  svg.en = drawForest('en', ordered);
  html.en = paper.buildItelHtml(report, report.text.en, svg.en, bib.en, l);
  svg.ja = drawForest('ja', newBib().ja);
  svg.jaLarge = drawForest('ja', newBib().ja, true);   // 記事用。幅 600px に縮めても読めるよう、文字を大きくしてある
  html.ja = paper.buildJsetHtml(report, report.text.ja, report.text.en, svg.ja, bib.ja, l);
  report.warnings = (report.warnings || []).filter((w) => !/抄録|Abstract/.test(w))
    .concat(paper.lengthWarnings(report, report.text, newBib()));

  ['en', 'ja'].forEach((lang) => {
    fs.writeFileSync(path.join(outDir, `forest-${lang}.svg`), svg[lang], 'utf8');
    fs.writeFileSync(path.join(outDir, `paper-${lang}.html`), html[lang], 'utf8');
  });

  const articleHtml = content.buildArticleHtml(report, report.text.article, newBib().ja, l, false);
  fs.writeFileSync(path.join(outDir, 'article-ja.html'), articleHtml, 'utf8');
  fs.writeFileSync(path.join(outDir, 'studies.csv'), content.buildCsv(report), 'utf8');

  const sizes = await deps.render([
    { type: 'pdf', html: html.en, file: path.join(outDir, 'paper-en.pdf'), ...paper.margins(report, 'en'), lang: 'en' },
    { type: 'pdf', html: html.ja, file: path.join(outDir, 'paper-ja.pdf'), ...paper.margins(report, 'ja'), lang: 'ja' },
    { type: 'png', svg: svg.ja, file: path.join(outDir, 'forest-ja.png') },
    { type: 'png', svg: svg.jaLarge, file: path.join(outDir, 'forest-article.png') }
  ]);

  // 後から作り直せるように、材料をすべて残す（models は Set なので配列にする）
  const data = { ...report, models: [...report.models], dir };
  fs.writeFileSync(path.join(outDir, 'data.json'), JSON.stringify(data, null, 1) + '\n', 'utf8');

  // 中身の確認（「成功」表示ではなく、できたファイルの大きさで判断する）
  const problems = [];
  Object.entries(sizes || {}).forEach(([file, size]) => {
    if (!(size > (file.endsWith('.pdf') ? 20000 : 5000))) problems.push(path.basename(file) + ' が小さすぎる（' + size + ' バイト）');
  });
  if (!articleHtml.includes('<table') || articleHtml.length < 2000) problems.push('記事の HTML が短すぎる（' + articleHtml.length + ' 字）');
  if (problems.length) throw new Error('書き出したファイルがおかしい: ' + problems.join(' / '));
  return { dir, sizes, articleHtml };
}

/** reports/README.md（一覧）を台帳から作り直す */
function writeIndex(root, ledger) {
  const { owner, name, branch } = config.repo;
  const rows = ledger.runs.filter((r) => r.status === ledgerLib.STATUS.DONE).slice().reverse().map((r) => {
    const base = `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${config.paths.reports}/${r.dir}`;
    return `| ${r.date} | ${r.titleJa} | ${r.k} | ${r.pooled} | [日本語](${base}/paper-ja.pdf) / [English](${base}/paper-en.pdf) | ${r.wpSentAt ? (r.wpDraft ? '下書きに送信' : '送信済み') : '未送信'} |`;
  });
  const md = ['# メタ分析の一覧', '', '新しい順。台帳（ledger.json）から自動で作っています。', '',
    '| 日付 | テーマ | 研究数 | 統合値 | 論文 PDF | WordPress |', '|---|---|---|---|---|---|'].concat(rows, ['']).join('\n');
  fs.mkdirSync(path.join(root, config.paths.reports), { recursive: true });
  fs.writeFileSync(path.join(root, config.paths.reports, 'README.md'), md, 'utf8');
}

// ============================================================
// 本体
// ============================================================

async function main() {
  const ledgerFile = path.join(options.root, config.paths.ledger);
  const ledger = ledgerLib.load(ledgerFile);
  const d = dates(deps.now());

  const since = ledgerLib.daysSinceLast(ledger, d.date);
  if (!options.force && !options.dryRun && since < config.minDaysBetweenReports) {
    console.log(`前回の報告から ${since} 日です（${config.minDaysBetweenReports} 日あける）。何もしません。`);
    return null;
  }

  // 過去に記事にしたテーマは二度扱わない（台帳と reports/ のフォルダの両方を見る）
  const used = ledgerLib.usedThemes(ledger, path.join(options.root, config.paths.reports));
  let themes;
  if (options.theme) {
    const t = config.themes.find((x) => x.id === options.theme);
    if (!t) throw new Error('テーマが見つかりません: ' + options.theme + '（config.js の themes の id）');
    if (used.has(t.id) && !options.allowRepeat) {
      throw new Error(`テーマ「${t.titleJa}」（${t.id}）はすでに記事にしています。同じテーマで作り直すときは --allow-repeat を付けてください`);
    }
    themes = [t];
  } else {
    themes = ledgerLib.themeOrder(config.themes, ledger, used).slice(0, config.maxThemesPerRun);
    console.log(`未使用のテーマ: ${config.themes.length - used.size} / ${config.themes.length}（記事にしたもの: ${[...used].join(', ') || 'なし'}）`);
    if (!themes.length) {
      throw new Error('未使用のテーマがありません。config.js の themes に新しいテーマを足してください');
    }
  }

  let report = null;
  for (const theme of themes) {
    const got = await collect(theme);
    if (got.failed) {
      ledger.runs.push({ date: d.date, themeId: theme.id, status: ledgerLib.STATUS.FAILED, note: got.reason,
        searched: got.search.merged, tried: got.search.fullTextsTried });
      continue;
    }
    report = { ...got, ...d };
    break;
  }

  if (!report) {
    if (!options.dryRun) ledgerLib.save(ledgerFile, ledger);
    console.log('\nどのテーマでも研究が集まりませんでした。');
    process.exitCode = 1;
    return null;
  }

  await analyzeAndWrite(report);

  const dirName = `${d.date}-${report.theme.id}`;
  const outDir = options.dryRun
    ? path.join(options.root, '.cache', 'dry-run', dirName)
    : path.join(options.root, config.paths.reports, dirName);
  const built = await build(report, outDir);

  const et = report.theme.effect;
  const o = report.analysis.overall;
  const pooled = `${et === 'r' ? 'r' : 'g'} = ${meta.back(et, o.est).toFixed(2)} [${meta.back(et, o.ci[0]).toFixed(2)}, ${meta.back(et, o.ci[1]).toFixed(2)}]`;
  console.log('\n書き出しました: ' + path.relative(options.root, outDir));
  Object.entries(built.sizes).forEach(([f, s]) => console.log(`  ${path.basename(f)} ${Math.round(s / 1024)}KB`));
  if (report.warnings.length) console.log('注意:\n  ' + report.warnings.join('\n  '));

  if (!options.dryRun) {
    ledger.runs.push({
      date: d.date, themeId: report.theme.id, status: ledgerLib.STATUS.DONE, dir: built.dir,
      titleJa: report.theme.titleJa, k: o.k, pooled, models: [...report.models],
      warnings: report.warnings, wpSentAt: ''
    });
    ledgerLib.save(ledgerFile, ledger);
    writeIndex(options.root, ledger);
  }
  return { report, outDir, built };
}

if (require.main === module) {
  main().catch((e) => {
    console.error('失敗しました: ' + (e.stack || e.message));
    process.exit(1);
  });
}

module.exports = { main, collect, analyzeAndWrite, build, links, writeIndex, dedupe, dates, deps, options };
