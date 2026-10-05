/**
 * 自己検査（GitHub Actions でも毎回実行する）
 *
 *   node test.js            通信と言語モデルを偽物に差し替えて、検索 → 抽出 → 統合 → 論文・記事 → 送信 を通しで動かす
 *   node test.js --render   上に加えて、Chrome で本物の PDF と PNG を作る（.cache/test-render/ に残す。見た目の確認用）
 *   node test.js --live     OpenAlex と J-STAGE だけ本物に当てる（言語モデルは呼ばない）
 *
 * 統計の値は R（pnorm, qt, pchisq, pt）と metafor の BCG ワクチンのデータ（dat.bcg）で確かめている。
 * 確かめていないこと: 言語モデルの出力の質、WordPress での見え方（実物で確かめる）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const RENDER = process.argv.includes('--render');
const LIVE = process.argv.includes('--live');
const checks = [];
function check(name, ok, detail) {
  checks.push([name, !!ok]);
  if (!ok) console.log('  NG ' + name + (detail !== undefined ? '  → ' + String(detail).slice(0, 400) : ''));
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const config = require('./config');
const stats = require('./lib/stats');
const meta = require('./lib/meta');
const cite = require('./lib/cite');
const review = require('./lib/review');
const ledgerLib = require('./lib/ledger');
const content = require('./lib/content');
const paper = require('./lib/paper');
const wordpress = require('./lib/wordpress');
const write = require('./lib/write');

async function unitTests() {
  // ---- 分布関数（R の値）----
  check('pnorm(1.96)', near(stats.normalCdf(1.96), 0.9750021, 1e-6), stats.normalCdf(1.96));
  check('qt(.975, 4)', near(stats.tQuantile(0.975, 4), 2.776445, 1e-5), stats.tQuantile(0.975, 4));
  check('qt(.975, 10)', near(stats.tQuantile(0.975, 10), 2.228139, 1e-5), stats.tQuantile(0.975, 10));
  check('pt(2, 5)', near(stats.tCdf(2, 5), 0.9490303, 1e-6), stats.tCdf(2, 5));
  check('pchisq(3.84, 1, upper)', near(stats.chiSquareSf(3.84, 1), 0.05004352, 1e-6), stats.chiSquareSf(3.84, 1));
  check('pchisq(10, 5, upper)', near(stats.chiSquareSf(10, 5), 0.07523525, 1e-6), stats.chiSquareSf(10, 5));
  check('pchisq(152.233, 12, upper) ほぼ 0', stats.chiSquareSf(152.233, 12) < 1e-20);

  // ---- 効果量 ----
  const g1 = meta.computeEffect('smd', { nTreatment: '20', nControl: '20', meanTreatment: '10', meanControl: '8', sdTreatment: '2', sdControl: '2', direction: 'treatment_higher' });
  check('Hedges g（平均・SD）', near(g1.yi, 0.980132, 1e-5), g1.yi);
  check('Hedges g の分散', near(g1.vi, 0.108079, 1e-5), g1.vi);
  const g2 = meta.computeEffect('smd', { nTreatment: '20', nControl: '20', t: '2.5', direction: 'treatment_higher' });
  check('t から g', near(g2.yi, 0.790569 * (1 - 3 / 151), 1e-5), g2.yi);
  const g3 = meta.computeEffect('smd', { nTreatment: '20', nControl: '20', t: '2.5', direction: 'control_higher' });
  check('t から g（比較群が上なら負）', g3.yi < 0);
  const g4 = meta.computeEffect('smd', { nTreatment: '20', nControl: '20', F: '6.25', direction: 'treatment_higher' });
  check('F(1,·) から g は t と同じ', near(g4.yi, g2.yi, 1e-9));
  check('t の向きが不明なら計算しない', meta.computeEffect('smd', { nTreatment: '20', nControl: '20', t: '2.5', direction: 'unclear' }).error);
  check('人数が無ければ計算しない', meta.computeEffect('smd', { meanTreatment: '1', meanControl: '2', sdTreatment: '1', sdControl: '1' }).error);
  const r1 = meta.computeEffect('r', { r: '-.34', nTotal: '103' });
  check('r → Fisher z', near(r1.yi, Math.atanh(-0.34), 1e-12) && near(r1.vi, 0.01, 1e-12), r1);
  check('ありえない g は外す', meta.plausible('smd', { yi: 4.2, n: 50 }));
  check('人数が少なすぎれば外す', meta.plausible('smd', { yi: 0.3, n: 6 }));

  // ---- 統合（metafor の dat.bcg、log RR、DL 法）----
  const bcg = [[4, 119, 11, 128], [6, 300, 29, 274], [3, 228, 11, 209], [62, 13536, 248, 12619], [33, 5036, 47, 5761],
    [180, 1361, 372, 1079], [8, 2537, 10, 619], [505, 87886, 499, 87892], [29, 7470, 45, 7232], [17, 1699, 65, 1600],
    [186, 50448, 141, 27197], [5, 2493, 3, 2338], [27, 16886, 29, 17825]];
  const ys = bcg.map(([a, b, c, d]) => ({
    yi: Math.log((a / (a + b)) / (c / (c + d))),
    vi: 1 / a - 1 / (a + b) + 1 / c - 1 / (c + d), n: a + b + c + d, gradeBand: 'elementary'
  }));
  const p = meta.pool(ys);
  check('dat.bcg: Q = 152.23', near(p.Q, 152.233, 0.01), p.Q);
  check('dat.bcg: τ²(DL) = 0.3088', near(p.tau2, 0.3088, 0.0005), p.tau2);
  check('dat.bcg: 推定値 = −0.7141', near(p.est, -0.7141, 0.0005), p.est);
  check('dat.bcg: I² = 92.12%', near(p.I2, 92.12, 0.05), p.I2);
  check('重みの合計は 100%', near(p.weights.reduce((a, b) => a + b, 0), 100, 1e-9));
  check('HK の区間は t(12) を使う', near((p.ci[1] - p.est) / p.se, stats.tQuantile(0.975, 12), 1e-9));
  check('Egger は 10 研究以上で計算', meta.egger(ys) && meta.egger(ys.slice(0, 9)) === null);
  const same = meta.pool([{ yi: 0.5, vi: 0.04 }, { yi: 0.5, vi: 0.04 }, { yi: 0.5, vi: 0.04 }]);
  check('同じ値だけなら τ² = 0・I² = 0', same.tau2 === 0 && same.I2 === 0 && near(same.est, 0.5, 1e-12));
  const sg = meta.subgroups([{ yi: 0.2, vi: 0.02, gradeBand: 'elementary' }, { yi: 0.3, vi: 0.02, gradeBand: 'elementary' },
    { yi: 0.8, vi: 0.02, gradeBand: 'middle' }, { yi: 0.9, vi: 0.02, gradeBand: 'middle' }, { yi: 0.5, vi: 0.02, gradeBand: 'mixed' }]);
  check('下位集団は 2 研究以上の段階だけ', sg && sg.groups.length === 2 && sg.p < 0.05, sg && sg.groups.map((x) => x.band));

  // ---- 数値の照合 ----
  const text = 'The experimental group (n = 25, M = 14.32, SD = 3.1) outperformed controls (n = 27, M = 12.05, SD = 2.9), t(50) = 2.74. r = .45. 平均は１２．５０点';
  check('本文にある数値は通る', review.verifyStats({ nTreatment: '25', meanTreatment: '14.32', sdTreatment: '3.1', t: '2.74', r: '0.45' }, text).length === 0,
    review.verifyStats({ nTreatment: '25', meanTreatment: '14.32', sdTreatment: '3.1', t: '2.74', r: '0.45' }, text));
  check('全角数字の本文も照合できる', review.verifyStats({ meanControl: '12.50' }, text).length === 0);
  check('本文に無い数値は見つからない', review.verifyStats({ meanControl: '12.5', sdControl: '2.95' }, text).length === 2);
  check('数字の一部だけの一致は認めない（14.3 と 14.32）', review.verifyStats({ meanTreatment: '14.3' }, text).length === 1);
  // 小数点がカンマの論文（インドネシア語など）。2026-10-04 の実行で、本文に「79,8」「86,3」「-5,160」とある有効な研究が
  // 「本文で確認できない数値」として捨てられた
  const comma = 'rata-rata 79,8 dan 86,3 (n = 1.234; SD 2,5). Hasil uji t = -5,160 dengan p < 0,001. 平均 8,40';
  check('小数点がカンマの本文: 抽出が「.」でも通る', review.verifyStats({ meanTreatment: '79.8', meanControl: '86.3', t: '-5.160', sdTreatment: '2.5' }, comma).length === 0,
    review.verifyStats({ meanTreatment: '79.8', meanControl: '86.3', t: '-5.160', sdTreatment: '2.5' }, comma));
  check('小数点がカンマの本文: 抽出が「,」のままでも通る', review.verifyStats({ meanTreatment: '79,8', t: '-5,160', meanControl: '8,40' }, comma).length === 0);
  check('桁区切りの人数（本文 1.234 / 抽出 1234）', review.verifyStats({ nTreatment: '1234' }, comma).length === 0);
  check('カンマ表記でも、ずれた値は落とす', review.verifyStats({ meanTreatment: '79.9', t: '5.16' }, comma).length === 2, review.verifyStats({ meanTreatment: '79.9', t: '5.16' }, comma));
  check('長い数の一部には一致しない（15,160 の中の 5,160）', review.verifyStats({ t: '5.160' }, 'nilai 15,160 saja').length === 1);
  check('読み取り: 平均のカンマは小数点', review.parseNumber('8,40', 'meanTreatment') === 8.4 && review.parseNumber('-5,160', 't') === -5.16);
  check('読み取り: 人数のカンマは桁区切り', review.parseNumber('1,234', 'nTreatment') === 1234 && review.parseNumber('2.500', 'nTotal') === 2500);
  const ec = meta.computeEffect('smd', { nTreatment: '25', nControl: '25', meanTreatment: '8,40', meanControl: '7,97', sdTreatment: '1,2', sdControl: '1,3', direction: 'treatment_higher' });
  check('効果量: カンマ表記の平均・SD から計算できる', Number.isFinite(ec.yi) && ec.yi > 0.3 && ec.yi < 0.4, ec.yi);
  check('数値でない値は照合に落ちる', review.verifyStats({ nControl: 'about 30' }, text).length === 1);

  // ---- 比較条件の種類（受動／能動）----
  const passiveActive = (arr) => arr.map(([yi, c]) => ({ yi, vi: 0.04, n: 40, gradeBand: 'elementary', comparator: c }));
  const cs = meta.analyze('smd', passiveActive([[0.8, 'passive'], [0.9, 'passive'], [0.1, 'active'], [0.0, 'active'], [0.5, 'unclear']]));
  check('比較の種類: 受動と能動の2群に分かれる（受動が先）', cs.comparatorSubgroups && cs.comparatorSubgroups.groups.map((g) => g.key).join() === 'passive,active', cs.comparatorSubgroups);
  check('比較の種類: 群ごとの k と、差の Q 検定', cs.comparatorSubgroups.groups.every((g) => g.k === 2) && cs.comparatorSubgroups.df === 1 && cs.comparatorSubgroups.p < 0.05, cs.comparatorSubgroups.p);
  check('比較の種類: 不明の研究は分析から除き、数える', cs.comparatorUnclear === 1 && cs.overall.k === 5);
  check('比較の種類: 片方が1研究だけなら行わない', meta.analyze('smd', passiveActive([[0.8, 'passive'], [0.9, 'passive'], [0.1, 'active']])).comparatorSubgroups === null);
  check('比較の種類: 相関のテーマでは行わない', meta.analyze('r', passiveActive([[0.2, 'passive'], [0.3, 'passive'], [0.1, 'active'], [0.2, 'active']])).comparatorSubgroups === null);
  check('学年別の分析は従来どおり', meta.subgroups([{ yi: 0.2, vi: 0.02, gradeBand: 'elementary' }, { yi: 0.3, vi: 0.02, gradeBand: 'elementary' }, { yi: 0.8, vi: 0.02, gradeBand: 'middle' }, { yi: 0.9, vi: 0.02, gradeBand: 'middle' }]).groups[0].band === 'elementary');

  // 分類の根拠の引用は本文で確かめる（数値と違い、文字列では確かめられない）
  const body = 'In the control group, the students were taught with the regular logical and mathematics curriculum, without any pro-\ngramming activities during the semester.';
  check('引用: 本文にある（ハイフンで切れた語・大文字小文字の違いを許す）', review.quoteSupported('the students were taught with the Regular logical and mathematics curriculum, without any programming activities', body));
  check('引用: 本文に無い作文は通らない', !review.quoteSupported('the control group played plugged-in coding games on tablets every week', body));
  check('引用: 短すぎるものは通らない', !review.quoteSupported('regular curriculum', body));
  check('引用: 日本語の本文でも照合できる', review.quoteSupported('統制群は通常の算数の授業を受けた', '対象は小学5年生であった。 統制群は 通常の 算数の授業を 受けた。 授業は週3回であった。'));
  const th = config.themes.find((x) => x.id === 'info-unplugged-ct');
  const rawC = (over) => ({ comparisonType: 'active', comparisonEvidence: 'the students were taught with the regular logical and mathematics curriculum', ...over });
  check('分類: 引用が本文にあれば採用', review.classifyComparison(th, rawC(), body).comparisonType === 'active');
  const dg = review.classifyComparison(th, rawC({ comparisonEvidence: 'they played tablet games for two hours every single day' }), body);
  check('分類: 引用が本文に無ければ unclear に落とし、理由を残す', dg.comparisonType === 'unclear' && /見つからない/.test(dg.comparisonNote), dg);
  check('分類: 想定外の値は unclear', review.classifyComparison(th, rawC({ comparisonType: 'sham' }), body).comparisonType === 'unclear');
  check('分類: 相関のテーマでは使わない', review.classifyComparison(config.themes.find((x) => x.id === 'math-anxiety-achievement'), rawC(), body).comparisonType === 'unclear');

  // ---- 引用と参考文献（日本語版 = JSET、英語版 = IEEE）----
  check('名前の分解', cite.splitName('John A. Smith').initials === 'J. A.' && cite.splitName('Jean-Paul Sartre').initials === 'J.-P.');
  check('姓の前置詞', cite.splitName('Ludwig van Beethoven').family === 'van Beethoven');
  check('日本語の名前は空白を詰める', cite.splitName('山田 太郎').full === '山田太郎' && cite.splitName('山田 太郎').family === '山田');
  const pa = { title: 'Fractions for all', authors: ['Ann Lee', 'Bo Kim', 'Cy Park'], year: '2021', venue: 'J Math Ed', volume: '5', issue: '2', pages: '1–10', doi: '10.1/x' };
  const pb = { title: 'Fraction talk', authors: ['Dana White'], year: '2019', venue: 'Educ Stud', volume: '9', issue: '', pages: '', doi: '', url: 'https://example.org/b' };
  const pc = { title: '分数の授業', titleEn: 'Fraction lessons', authors: ['山田 太郎', '佐藤 花子'], authorsEn: ['Taro Yamada', 'Hanako Sato'], year: '2020', venue: '数学教育学会誌', venueEn: 'Journal of JSME', volume: '3', issue: '1', pages: '5–9', doi: '10.2/y' };
  const studies = [pa, pb, pc].map((x, i) => ({ sid: 'S' + (i + 1), paper: x }));
  const plain = (segs) => segs.map((s) => (s.italic ? '_' + s.text + '_' : s.bold ? '#' + s.text + '#' : s.text)).join('');

  const J = new cite.Bibliography(studies, 'jset');
  const cj = J.resolve('先行研究 [S3]，[S1, S2]．See [S9].');
  check('JSET: 本文の引用', cj === '先行研究 (山田・佐藤 2020)，(LEE ' + cite.ETAL + ' 2021，WHITE 2019)．See.', cj);
  check('JSET: 表の研究名', J.narrative('S1') === 'LEE ' + cite.ETAL + ' (2021)' && J.narrative('S2') === 'WHITE (2019)');
  J.resolve('[M:dl1986]');
  const rj = J.references().map((r) => plain(r.segs));
  check('JSET: 苗字のアルファベット順（和文はローマ字の読み）', rj.map((r) => r.replace('*', '').slice(0, 3)).join('|') === 'DER|LEE|WHI|山田太', rj.map((r) => r.slice(0, 12)));
  check('JSET: 欧文の形', rj.includes('*LEE, A., KIM, B. and PARK, C. (2021) Fractions for all. _J Math Ed_, #5# (2)：1-10. https://doi.org/10.1/x'), rj);
  check('JSET: 和文の形', rj.includes('*山田太郎, 佐藤花子 (2020) 分数の授業. 数学教育学会誌, #3# (1)：5-9. https://doi.org/10.2/y'), rj);
  const six = { ...pa, authors: ['A One', 'B Two', 'C Three', 'D Four', 'E Five', 'F Six'] };
  check('JSET: 6名以上は5名＋ et al.', plain(cite.jsetRef(six, '2021')).startsWith('ONE, A., TWO, B., THREE, C., FOUR, D., FIVE, E. _et al._ (2021)'), plain(cite.jsetRef(six, '2021')));
  const dup = new cite.Bibliography([{ sid: 'S1', paper: { ...pb, title: 'A' } }, { sid: 'S2', paper: { ...pb, title: 'B' } }], 'jset');
  check('JSET: 同じ著者・年には a, b', dup.resolve('[S1, S2]') === '(WHITE 2019a，WHITE 2019b)', dup.resolve('[S1, S2]'));

  const I = new cite.Bibliography(studies, 'ieee');
  const ci1 = I.resolve('Prior work [S2] and later [S3, S1]. Method [M:dl1986]. Again [S2].');
  check('IEEE: 引用した順の番号', ci1 === 'Prior work [1] and later [2], [3]. Method [4]. Again [1].', ci1);
  check('IEEE: 表の研究名', I.narrative('S1') === 'Lee et al. [3]');
  const ri = I.references().map((r) => r.label + ' ' + plain(r.segs));
  check('IEEE: 番号順のリスト', ri.length === 4 && ri[0].startsWith('[1] *D. White'), ri);
  check('IEEE: 欧文の形', ri[2] === '[3] *A. Lee, B. Kim, and C. Park, “Fractions for all,” _J Math Ed_, vol. 5, no. 2, pp. 1–10, 2021, doi: 10.1/x.', ri[2]);
  check('IEEE: 和文の論文は英語表記と (in Japanese)', ri[1] === '[2] *T. Yamada and H. Sato, “Fraction lessons,” _Journal of JSME_, vol. 3, no. 1, pp. 5–9, 2020 (in Japanese), doi: 10.2/y.', ri[1]);
  check('IEEE: 方法の文献（2名）', ri[3] === '[4] R. DerSimonian and N. Laird, “Meta-analysis in clinical trials,” _Controlled Clinical Trials_, vol. 7, no. 3, pp. 177–188, 1986, doi: 10.1016/0197-2456(86)90046-2.', ri[3]);
  check('IEEE: 7名以上は et al.', plain(cite.ieeeRef({ ...pa, authors: ['A One', 'B Two', 'C Three', 'D Four', 'E Five', 'F Six', 'G Seven'] })).startsWith('A. One et al., '));
  check('引用の印を消す（抄録用）', J.strip('背景である [S1, S2]．') === '背景である．');

  // ---- WordPress 向け: リンクの除去 ----
  const sz = content.sanitizeForWordPress;
  check('リンク除去: DOI の URL → 「DOI: 10.xxxx/...」', sz('<a href="https://doi.org/10.1016/0197-2456(86)90046-2" target="_blank" rel="noopener">https://doi.org/10.1016/0197-2456(86)90046-2</a>') === 'DOI: 10.1016/0197-2456(86)90046-2', sz('<a href="https://doi.org/10.1016/0197-2456(86)90046-2">https://doi.org/10.1016/0197-2456(86)90046-2</a>'));
  check('リンク除去: 表示の文字があれば「文字 (URL)」', sz('<a href="https://example.org/a?x=1&amp;y=2">日本語版（PDF）</a>') === '日本語版（PDF） (example.org/a?x=1&amp;y=2)', sz('<a href="https://example.org/a?x=1&amp;y=2">日本語版（PDF）</a>'));
  check('リンク除去: 表示の文字が URL そのものなら、頭の https:// を落とした文字だけ', sz('<a href="https://example.org/p.pdf">https://example.org/p.pdf</a>') === 'example.org/p.pdf');
  check('リンク除去: 文字だけの URL も頭の https:// を落とす（WordPress の自動リンク化を避ける）。タグの中の src は残す', sz('<li>PDF: https://example.org/p.pdf</li><img src="https://example.org/f.png" />') === '<li>PDF: example.org/p.pdf</li><img src="https://example.org/f.png" />');
  check('findLinks: <a>・URL・www. を見つける。画像の src は見ない', content.findLinks('<a href="x">a</a>').length > 0 && content.findLinks('見て https://e.org').length > 0 && content.findLinks('www.e.org').length > 0 && content.findLinks('<img src="https://e.org/f.png" /> DOI: 10.1/x').length === 0);
  check('記事の組み立て結果にリンクも URL も残らない（実際の記事ファイルで）', (() => { const d = path.join(__dirname, config.paths.reports); return fs.readdirSync(d).filter((n) => fs.existsSync(path.join(d, n, 'article-ja.html'))).every((n) => content.findLinks(sz(fs.readFileSync(path.join(d, n, 'article-ja.html'), 'utf8'))).length === 0); })());
  check('リンク除去: 中の書式を残し、DOI を添える', sz("<a href='https://doi.org/10.1/x'><i>Title</i></a>") === '<i>Title</i> (DOI: 10.1/x)', sz("<a href='https://doi.org/10.1/x'><i>Title</i></a>"));
  check('リンク除去: 大文字の <A HREF>・属性の順が違うものも', sz('<A HREF="https://doi.org/10.2/y">x</A> と <a target="_blank" href="https://doi.org/10.3/z">https://doi.org/10.3/z</a>') === 'x (DOI: 10.2/y) と DOI: 10.3/z');
  check('リンク除去: href の無い <a> も外す', sz('<a name="t">本文</a>') === '本文');
  check('リンク除去: リンクでない本文中の DOI の URL も文字に（末尾の句点は含めない）', sz('詳細は https://doi.org/10.1/abc. を参照') === '詳細は DOI: 10.1/abc. を参照', sz('詳細は https://doi.org/10.1/abc. を参照'));
  check('リンク除去: 画像・ショートコード・ふつうの本文は変えない', (() => { const s = '<p>本文 <i>g</i> = 0.5</p><img src="https://raw.githubusercontent.com/x/f.png" alt="図" />\n[category 教育メタ分析]\n[end]'; return sz(s) === s; })());
  check('リンク除去: 何度通しても同じ', (() => { const s = '<a href="https://doi.org/10.1/x">a</a> <a href="https://e.org/">b</a>'; return sz(sz(s)) === sz(s); })());
  check('リンク除去: 送る前の結果に <a> が残らない（雑多な入力）', !/<a\b/i.test(sz('<p><a href="https://a.org">1</a><a\nhref="https://b.org"\n>2</a><a href=https://c.org>3</a></p>')));

  // ---- 表記 ----
  check('p の表記', content.fp(0.0004) === '< .001' && content.fp(0.0234) === '= .023');
  check('r は先頭の 0 を省く', /^−\.3[45]$/.test(content.fe('r', -0.345)), content.fe('r', -0.345));
  check('g は先頭の 0 を残す', content.fe('smd', 0.456) === '0.46');
  check('統計記号はイタリック', content.italicStats('g = 0.4, p < .001, t(4) = 2.1, I² = 3') === '<i>g</i> = 0.4, <i>p</i> < .001, <i>t</i>(4) = 2.1, <i>I</i>² = 3', content.italicStats('g = 0.4, p < .001, t(4) = 2.1, I² = 3'));
  check('JSET の表記（，．・半角括弧・1桁は全角）', paper.jsetText('研究は5本、参加者は120人（小学4年）。') === '研究は５本，参加者は120人 (小学４年)．', paper.jsetText('研究は5本、参加者は120人（小学4年）。'));
  check('WordPress 用: "--" と絵文字を落とす', content.stripAstral('a--b 😀 <hr/>c') === 'a−−b  c', content.stripAstral('a--b 😀 <hr/>c'));
  check('知らない数値を見つける', write.unknownNumbers(['g = 0.45 and 0.99'], '{"x":"0.45"}').join() === '0.99');

  // ---- 台帳とテーマの順番 ----
  const L = { runs: [{ date: '2026-09-20', themeId: 'math-fraction-instruction', status: 'done' }] };
  const order = ledgerLib.themeOrder(config.themes, L);
  check('前回が数学なら次は情報', order[0].domain === 'info', order[0].id);
  check('数学と情報を交互に並べる（片方が全部失敗しても、もう片方を同じ実行で試せる）', order.slice(0, 6).every((x, i) => x.domain === (i % 2 === 0 ? 'info' : 'math')), order.slice(0, 6).map((x) => x.domain));
  const Lf = { runs: ['info-unplugged-ct', 'info-block-programming-ct', 'info-educational-robotics'].map((id) => ({ date: '2026-10-04', themeId: id, status: 'failed' }))
    .concat([{ date: '2026-09-29', themeId: 'math-fraction-instruction', status: 'done' }]) };
  const orderF = ledgerLib.themeOrder(config.themes, Lf).slice(0, config.maxThemesPerRun);
  check('情報が3つ失敗していても、同じ実行で数学も試す', orderF.length === config.maxThemesPerRun && orderF.some((x) => x.domain === 'math') && orderF.filter((x) => x.domain === 'info').length === 2 && !orderF.some((x) => /unplugged|block-programming|educational-robotics/.test(x.id)), orderF.map((x) => x.id));
  check('記事にしたテーマは選ばない', !order.some((t) => t.id === 'math-fraction-instruction') && order.length === config.themes.length - 1);
  const tmpRep = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-rep-'));
  fs.mkdirSync(path.join(tmpRep, '2026-10-11-info-unplugged-ct'));
  fs.writeFileSync(path.join(tmpRep, 'README.md'), '');
  const usedSet = ledgerLib.usedThemes(L, tmpRep);
  check('過去の記事のフォルダからも使用済みを拾う', usedSet.has('info-unplugged-ct') && usedSet.has('math-fraction-instruction') && usedSet.size === 2, [...usedSet]);
  check('フォルダだけにあるテーマも選ばない', !ledgerLib.themeOrder(config.themes, L, usedSet).some((t) => t.id === 'info-unplugged-ct'));
  const allUsed = { runs: config.themes.map((t) => ({ date: '2026-01-01', themeId: t.id, status: 'done' })) };
  check('全部使ったら候補は空', ledgerLib.themeOrder(config.themes, allUsed).length === 0);
  fs.rmSync(tmpRep, { recursive: true, force: true });
  const L2 = { runs: [{ date: '2026-09-20', themeId: 'info-unplugged-ct', status: 'failed' }, { date: '2026-09-20', themeId: 'math-fraction-instruction', status: 'done' }] };
  check('失敗したテーマは後回し', ledgerLib.themeOrder(config.themes, L2)[0].id !== 'info-unplugged-ct');
  check('日数の計算', ledgerLib.daysSinceLast(L, '2026-09-27') === 7 && ledgerLib.daysSinceLast({ runs: [] }, '2026-09-27') === Infinity);
  check('日本時間の日付（朝6時でも当日）', ledgerLib.jstDate(new Date('2026-09-27T21:00:00Z')) === '2026-09-28');

  // ---- 検索する分野（情報教育の論文は教育以外に分類されているものが多い）----
  const sub = (id) => config.themes.find((x) => x.id === id).subfields;
  check('情報のテーマはコンピュータ科学応用と情報システムも検索', config.themes.filter((x) => x.domain === 'info').every((x) => x.subfields.includes('1706') && x.subfields.includes('1710') && x.subfields.includes('3304')));
  check('相関のテーマは心理学も検索', ['math-anxiety-achievement', 'math-self-efficacy-achievement', 'info-ct-math-correlation'].every((id) => sub(id).includes('3205') && sub(id).includes('3207')));
  check('分数のテーマは医学が混ざらない分野のまま', sub('math-fraction-instruction').join() === '3304,3204', sub('math-fraction-instruction'));
  check('分野の指定が検索式に入る', require('./lib/openalex').buildFilter(config.themes.find((x) => x.id === 'info-unplugged-ct')).includes('primary_topic.subfield.id:3304|3204|1706|1710'));
  const htmlMeta = '<head><meta name="citation_title" content="x"><meta name="citation_pdf_url" content="/article/download/12/34?a=1&amp;b=2"></head>';
  check('論文のページから PDF の URL を探す', require('./lib/pdf').pdfLinkFromHtml(htmlMeta, 'https://journal.example.org/index.php/x/article/view/12') === 'https://journal.example.org/article/download/12/34?a=1&b=2');
  check('PDF の URL が無いページは空', require('./lib/pdf').pdfLinkFromHtml('<head></head>', 'https://x.org/') === '');

  // ---- テーマ定義 ----
  const ids = new Set();
  config.themes.forEach((t) => {
    check('テーマ ' + t.id + ' の項目', t.titleJa && t.titleEn && t.query && ['smd', 'r'].includes(t.effect) && ['math', 'info'].includes(t.domain));
    check('テーマ ' + t.id + ' の検索式にカンマが無い', !t.query.includes(','));
    check('テーマ id が重複しない ' + t.id, !ids.has(t.id));
    ids.add(t.id);
  });
  check('数学のテーマは小中学校に限定', config.themes.filter((t) => t.domain === 'math').every((t) => /grades 1-9/.test(t.population)));
}

// ============================================================
// 言語モデルの切り替え（Gemini が全部混雑 → Claude、以後はずっと Claude）
// ============================================================

async function llmTest() {
  const http = require('./lib/http');
  const llm = require('./lib/llm');
  const claude = require('./lib/claude');
  const saved = { fetch: global.fetch, env: { ...process.env }, wait: config.geminiRoundWaitMs, base: http.retry.baseMs, client: claude.createClient };
  let geminiCalls = 0;
  let claudeCalls = 0;
  global.fetch = async () => { geminiCalls++; return { ok: false, status: 503, headers: { get: () => null }, text: async () => 'overloaded', clone() { return this; } }; };
  claude.createClient = () => ({ messages: { create: async () => { claudeCalls++; return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"ok":true}' }] }; } } });
  process.env.GEMINI_API_KEY = 'x';
  process.env.ANTHROPIC_API_KEY = 'y';
  delete process.env.LLM_PRIMARY;
  config.geminiRoundWaitMs = 0;
  http.retry.baseMs = 0;
  const warn = console.warn;
  console.warn = () => {};
  try {
    llm._reset();
    const a = await llm.generateJson('p', null);
    const first = geminiCalls;
    const claudeAfterFirst = claudeCalls;
    const b = await llm.generateJson('p', null);
    check('LLM: 全部混雑なら Claude で書く', a.ok && claudeAfterFirst === 1 && first === config.geminiModels.length * 2 * config.geminiRounds, JSON.stringify({ a, claudeCalls, first }));
    check('LLM: 一度尽きたら以後は Gemini を呼ばない', b.ok && geminiCalls === first && claudeCalls === 2, geminiCalls);
    llm._reset();
    process.env.LLM_PRIMARY = 'claude';
    geminiCalls = 0;
    await llm.generateJson('p', null);
    check('LLM: LLM_PRIMARY=claude なら最初から Claude', geminiCalls === 0 && claudeCalls === 3);
    llm._reset();
    delete process.env.LLM_PRIMARY;
    global.fetch = async () => { geminiCalls++; throw new Error('The operation was aborted due to timeout'); };
    await llm.generateJson('p', null);
    check('LLM: 時間切れも混雑と同じに扱い Claude に回る', claudeCalls === 4);
    // Claude には構造化出力でスキーマを渡す
    let sent = null;
    claude.createClient = () => ({ messages: { create: async (p) => { sent = p; return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"decisions":[]}' }] }; } } });
    process.env.LLM_PRIMARY = 'claude';
    await llm.generateJson('p', { type: 'OBJECT', properties: { decisions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { n: { type: 'INTEGER' }, band: { type: 'STRING', enum: ['a', 'b'] } } } } } });
    const f = sent && sent.output_config && sent.output_config.format;
    check('LLM: Claude は json_schema の構造化出力', f && f.type === 'json_schema' && f.schema.type === 'object' && f.schema.additionalProperties === false &&
      f.schema.properties.decisions.items.properties.n.type === 'integer' && f.schema.properties.decisions.items.properties.band.enum.length === 2 &&
      f.schema.properties.decisions.items.required.join() === 'n,band' && sent.output_config.effort === config.claude.effort, JSON.stringify(f));
    // 選別がすべて失敗したら「0件」ではなく止める
    claude.createClient = () => ({ messages: { create: async () => { throw new Error('400 invalid_request_error'); } } });
    let threw = null;
    try { await review.screen(config.themes[0], [{ title: 'a', abstract: 'x', year: '2020', venue: 'v' }]); } catch (e) { threw = e; }
    check('選別: 全部失敗なら止めて原因を見せる', threw && threw.systemic && /400 invalid_request_error/.test(threw.message), threw && threw.message);
    claude.createClient = () => ({ messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"decisions":[{"n":1,"include":"false","score":9,"reason":"r"},{"n":2,"include":true,"score":7,"reason":"ok"}]}' }] }) } });
    const got = await review.screen(config.themes[0], [{ title: 'a', abstract: 'x' }, { title: 'b', abstract: 'y' }]);
    check('選別: include が文字列 "false" なら不採用', got.length === 1 && got[0].title === 'b');
  } finally {
    console.warn = warn;
    global.fetch = saved.fetch;
    claude.createClient = saved.client;
    config.geminiRoundWaitMs = saved.wait;
    http.retry.baseMs = saved.base;
    ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'LLM_PRIMARY'].forEach((k) => { if (saved.env[k] === undefined) delete process.env[k]; else process.env[k] = saved.env[k]; });
    llm._reset();
  }
}

// ============================================================
// 通しの検査（偽物）
// ============================================================

function fakePaper(i, over = {}) {
  return {
    source: 'openalex', id: 'W' + (1000 + i), doi: '10.9999/test.' + i,
    title: 'Fraction intervention study number ' + i, titleEn: '',
    authors: i % 3 === 0 ? ['Ann Lee'] : ['Ann Lee' + i, 'Bo Kim', 'Cy Park'],
    venue: 'Journal of Testing', volume: String(10 + i), issue: '2', pages: '1–20', year: String(2015 + i),
    language: 'en', citedBy: 0, url: 'https://doi.org/10.9999/test.' + i, landing: '', pdfUrls: ['https://x/p' + i + '.pdf'],
    abstract: 'A quasi-experimental study with grade 4 students comparing fraction instruction with business as usual. '.repeat(2),
    ...over
  };
}

function fakeData(i) {
  const n1 = 20 + i; const n2 = 22 + i;
  const m1 = (12 + i * 0.3).toFixed(2); const m2 = '11.20';
  return {
    eligible: i !== 2, reason: i === 2 ? 'Teacher sample.' : 'Meets criteria.',
    comparisonType: i === 7 ? 'unclear' : i % 3 === 0 ? 'active' : 'passive', comparisonEvidence: 'the control group received regular lessons',
    country: i % 2 ? 'Turkey' : 'Japan', gradeLevel: i % 2 ? 'Grade 7' : 'Grade 4', gradeBand: i % 2 ? 'middle' : 'elementary',
    design: 'quasi-experimental', intervention: 'number line fraction instruction', comparison: 'business as usual',
    outcomeMeasure: 'fraction test', summaryEn: 'Students learned fractions. The intervention helped.',
    summaryJa: '分数の授業を行いました。効果がありました。',
    ja: { country: i % 2 ? 'トルコ' : '日本', gradeLevel: i % 2 ? '中学1年' : '小学4年', design: '準実験', intervention: '数直線による分数指導', comparison: '通常の授業', outcomeMeasure: '分数テスト' },
    evidence: 'M = ' + m1,
    stats: { nTreatment: String(n1), nControl: String(n2), meanTreatment: m1, meanControl: m2, sdTreatment: '2.5', sdControl: '2.4',
      t: '', F: '', d: '', g: '', r: '', nTotal: '', direction: 'treatment_higher' },
    unverified: i === 4 ? ['sdControl=2.4'] : [],
    model: 'fake-model'
  };
}

const fakeEn = {
  background: 'Fractions are hard for many students [S1].',
  conclusionAbstract: 'Fraction instruction appears beneficial in grades 1-9.',
  introduction: ['Fractions matter [S1, S3].', 'Interventions vary widely [S2].', 'This meta-analysis asks whether fraction instruction improves learning.'],
  discussion: ['The pooled effect was positive [S1].', 'Teachers can use number lines [S3].', 'Studies differed in design.'],
  limitations: ['Few studies were available.'],
  conclusion: ['More research is needed.'],
  keywords: ['fractions', 'elementary school', 'mathematics instruction', 'intervention']
};
const fakeJa = {
  background: '分数は多くの児童生徒にとって難しい [S1]。', conclusionAbstract: '分数指導は1〜9年生に有益と考えられる。',
  introduction: ['分数は重要である [S1, S3]。', '介入はさまざまである [S2]。', '本メタ分析は分数指導の効果を問う。'],
  discussion: ['統合値は正であった [S1]。', '教師は数直線を使える [S3]。', '研究のデザインは異なっていた。'],
  limitations: ['研究数が少なかった。'], conclusion: ['さらなる研究が必要である。'],
  keywords: ['分数', '小学校', '算数指導', '介入']
};
const fakeArticle = {
  lead: '分数の指導法の効果を、国内外の研究をまとめて調べました。'.repeat(3),
  question: '分数の指導はどれくらい効果があるのでしょうか。'.repeat(4),
  reading: ['全体として効果は正でした [S1]。'.repeat(5), '研究によってばらつきがありました。'.repeat(5)],
  hints: ['数直線を使って分数の大きさを考えさせる [S3]。'.repeat(2), '具体物から始める。'.repeat(4)],
  cautions: ['研究の数は多くありません。'.repeat(3), '学年によって結果が違うかもしれません。'.repeat(2)],
  sns: '分数の指導のメタ分析。'
};

async function pipelineTest() {
  const run = require('./run');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-test-'));
  const papers = Array.from({ length: 9 }, (_, i) => fakePaper(i + 1));
  papers.push(fakePaper(99, { source: 'jstage', id: 'doi:10.2/jp', doi: '10.2/jp', title: '分数の授業に関する研究', titleEn: 'A study on fraction lessons',
    authors: ['山田 太郎', '佐藤 花子'], authorsEn: ['Taro Yamada', 'Hanako Sato'], venue: '数学教育学会誌', venueEn: 'Journal of JSME', language: 'ja', year: '2020' }));
  // 重複（同じ DOI）
  papers.push(fakePaper(1, { id: 'W-dup' }));
  const rendered = [];
  let screenedCount = 0;

  Object.assign(run.deps, {
    searchOpenAlex: async () => ({ total: 402, papers: papers.filter((p) => p.source === 'openalex') }),
    searchJstage: async () => ({ total: 12, papers: papers.filter((p) => p.source === 'jstage') }),
    enrichJstage: async (list) => list,
    screen: async (theme, list) => { screenedCount = list.length; return list.map((p, i) => ({ ...p, screen: { include: true, score: 9 - (i % 3), reason: 'ok' } })); },
    fetchPdf: async (p) => (p.id === 'W1005' ? null : { buf: Buffer.from('%PDF'), url: p.pdfUrls[0], bytes: 4 }),
    extractText: () => 'x'.repeat(5000),
    extract: async (theme, p) => {
      if (p.source === 'jstage') return { ...fakeData(6), gradeBand: 'elementary' };
      return fakeData(Number(p.id.slice(1)) - 1000);
    },
    writePaper: async () => fakeEn,
    translatePaper: async (en) => ({ ja: { ...fakeJa, criteria: en.criteria && { population: '1〜9年生の児童生徒', intervention: '分数の指導', comparison: '通常の授業', outcome: '分数テスト' } }, mismatch: [] }),
    writeArticle: async () => fakeArticle,
    usedModel: () => 'fake-model',
    render: RENDER ? run.deps.render : async (jobs) => {
      const sizes = {};
      jobs.forEach((j) => { fs.writeFileSync(j.file, Buffer.alloc(30000)); sizes[j.file] = 30000; rendered.push(j); });
      return sizes;
    },
    now: () => new Date('2026-10-03T22:00:00Z')
  });
  run.options.root = tmp;
  run.options.force = false;
  run.options.dryRun = false;
  run.options.theme = 'math-fraction-instruction';

  const logs = [];
  const origLog = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  let result;
  try {
    result = await run.main();
  } finally {
    console.log = origLog;
  }
  check('通し: 報告ができる', result && result.report, logs.slice(-5).join(' / '));
  if (!result) return;
  const { report, outDir } = result;
  check('通し: 重複を除く', report.search.merged === 10, report.search.merged);
  check('通し: 選別に回すのは要旨のあるもの', screenedCount === 10, screenedCount);
  check('通し: 最大 10 本で止める', report.studies.length <= config.studies.max);
  check('通し: 適格でない研究は外す', !report.studies.some((s) => s.paper.id === 'W1002'));
  check('通し: 照合できない数値の研究は外す', !report.studies.some((s) => s.paper.id === 'W1004') && report.search.excluded.unverified === 1);
  check('通し: PDF が取れない研究は外す', report.search.excluded.noPdf === 1);
  check('通し: 番号は S1 から', report.studies[0].sid === 'S1');
  check('通し: 日付は日本時間', report.date === '2026-10-04', report.date);

  const files = ['paper-en.pdf', 'paper-ja.pdf', 'forest-ja.png', 'forest-en.svg', 'forest-ja.svg', 'paper-en.html', 'paper-ja.html', 'article-ja.html', 'studies.csv', 'data.json'];
  files.forEach((f) => check('通し: ' + f + ' がある', fs.existsSync(path.join(outDir, f)) && fs.statSync(path.join(outDir, f)).size > 500));
  const en = fs.readFileSync(path.join(outDir, 'paper-en.html'), 'utf8');
  const ja = fs.readFileSync(path.join(outDir, 'paper-ja.html'), 'utf8');
  const art = fs.readFileSync(path.join(outDir, 'article-ja.html'), 'utf8');
  check('英語版: 著者は SEDA', en.includes('Society for Educational Data Analysis (SEDA)') && !en.includes('教育情報分析研究会'));
  check('日本語版: 著者は教育情報分析研究会', /<p class="authors">教育情報分析研究会<\/p>/.test(ja));
  check('記事: 著者は教育情報分析研究会', art.includes('著者: 教育情報分析研究会'));
  check('日本語版: 左上の論文種別は「生成AI論文」', ja.includes('<div class="type-box">生成AI論文</div>'));
  check('英語版: 左上の論文種別は「Generative AI paper」', en.includes('<p class="type">Generative AI paper</p>'));
  check('学会誌の名前や著作権表示を使わない', ![en, ja].some((h) => /日本教育工学会論文誌|INFORMATION AND TECHNOLOGY IN EDUCATION|Japan Society for Educational Technology|JSiSE|creativecommons/i.test(h)));
  check('日本語版: B5・2段組', ja.includes('size: 182mm 257mm') && ja.includes('column-count: 2'));
  check('英語版: A4・2段組', en.includes('size: A4') && en.includes('column-count: 2'));
  check('英語版: 引用が解決されている', !/\[S\d/.test(en) && !/\[M:/.test(en), (en.match(/\[(S\d|M:)[^\]]*\]/) || [])[0]);
  check('日本語版: 引用が解決されている', !/\[S\d/.test(ja) && !/\[M:/.test(ja));
  check('記事: 引用が解決されている', !/\[S\d/.test(art) && !art.includes('@@ETAL'));
  check('et al. の印が残らない', ![en, ja, art, fs.readFileSync(path.join(outDir, 'forest-ja.svg'), 'utf8')].some((h) => h.includes('@@ETAL')));
  check('英語版: 章と節の番号（ITEL の形）', ['<h2>1. Introduction</h2>', '<h2>2. Method</h2>', '<h3>2.1 Literature Search</h3>', '<h2>3. Results</h2>', '<h2>4. Discussion</h2>', '<h2>5. Conclusion</h2>', '<h2>Author notes</h2>', '<h2>References</h2>', '<b>Table 1.</b>', '<b>Figure 1.</b>'].every((h) => en.includes(h)),
    ['<h2>1. Introduction</h2>', '<h3>2.1 Literature Search</h3>', '<b>Table 1.</b>'].filter((h) => !en.includes(h)));
  check('日本語版: 章と節の番号（JSET の形）', ['<h2>1．はじめに</h2>', '<h2>2．方法</h2>', '<h3>2.1.　文献の検索</h3>', '<h2>5．まとめ</h2>', '付記', '参考文献', '表１　', '図１　', '<h2>Summary</h2>', 'KEYWORDS: META-ANALYSIS'].every((h) => ja.includes(h)),
    ['<h2>1．はじめに</h2>', '<h3>2.1.　文献の検索</h3>', '表１　', 'KEYWORDS: META-ANALYSIS'].filter((h) => !ja.includes(h)));
  check('英語版: IEEE の番号で引用し、番号つきの文献', /\[\d+\]/.test(en) && en.includes('<span class="n">[1]</span>') && en.includes('R. DerSimonian and N. Laird'));
  check('日本語版: JSET の引用 (DERSIMONIAN and LAIRD 1986)', ja.includes('(DERSIMONIAN and LAIRD 1986)') && ja.includes('DERSIMONIAN, R. and LAIRD, N. (1986)'));
  check('日本語版: 和文の論文は日本語の著者名', ja.includes('山田太郎, 佐藤花子 (2020)') && ja.includes('山田・佐藤 (2020)'));
  check('英語版: 和文の論文は英語表記の著者', en.includes('T. Yamada and H. Sato'));
  check('英語版: 図の研究名の番号が文献表と一致', (() => {
    const svgEn = fs.readFileSync(path.join(outDir, 'forest-en.svg'), 'utf8');
    const m = en.match(/<span class="n">\[(\d+)\]<\/span><span class="t">\*T\. Yamada/);
    return m && svgEn.includes('Yamada and Sato [' + m[1] + ']');
  })());
  check('日本語版: 表は日本語', ja.includes('小学4年'));
  check('日本語版: 適格基準は訳したもの（1桁の数字は全角）', ja.includes('対象者：１〜９年生の児童生徒'), (ja.match(/対象者：[^；]*/) || [])[0]);
  check('英語版: 適格基準は英語', en.includes('sampled students in grades 1-9'));
  check('日本語版: 句読点は「，」「．」', !/[、。]/.test(ja.replace(/<style>[\s\S]*?<\/style>/, '')));
  check('同じ数値が日英に出る', (() => {
    const g = content.fe('smd', meta.back('smd', report.analysis.overall.est));
    return en.includes('<i>g</i> = ' + g) && ja.includes('<i>g</i> = ' + g);
  })());
  check('英語版: 数値は計算結果から（HKSJ の t 値）', en.includes('<i>t</i>(' + report.analysis.overall.df + ')'));
  check('日本語版: 表1〜3と図1があり、本文で説明している', ['表１　対象とした研究の概要', '表２　各研究の介入・比較の条件・成果指標', '表３　メタ分析の結果', '図１　フォレストプロット', 'を表１に示す', 'を表２に示す', '図１に各研究の効果量', '表３にまとめる'].every((x) => ja.includes(x)),
    ['表１　対象とした研究の概要', '表２　各研究の介入', '表３　メタ分析の結果', '図１に各研究の効果量', '表３にまとめる'].filter((x) => !ja.includes(x)));
  check('英語版: Table 1〜3 と Fig. 1 があり、本文で説明している', ['<b>Table 1.</b>', '<b>Table 2.</b>', '<b>Table 3.</b>', '<b>Figure 1.</b>', 'Table 2 lists', 'Fig. 1 shows the forest plot', 'Table 3 summarizes'].every((x) => en.includes(x)));
  check('図表は参照する文の後に置く（日本語版）', ja.indexOf('を表１に示す') < ja.indexOf('表１　対象とした研究の概要') && ja.indexOf('図１に各研究の効果量') < ja.indexOf('図１　フォレストプロット') && ja.indexOf('表３にまとめる') < ja.indexOf('表３　メタ分析の結果'));
  check('本文の集計（正の効果量の本数）', /10本のうち|本のうちd+本で効果量が正/.test(ja.replace(/<[^>]+>/g, '')) || /本のうち[０-９d]+本で効果量が正/.test(ja.replace(/<[^>]+>/g, '')));
  // 有意な結果では従来どおり、有意でない結果では「効果にあたる」と言い切らない
  const rSig = { ...report, analysis: { ...report.analysis, overall: { ...report.analysis.overall, p: 0.2, ci: [-0.2, 0.9], est: 0.3 } } };
  const blocksJa = content.resultsBlocks(rSig, 'ja', new cite.Bibliography(report.studies.map((s) => ({ sid: s.sid, paper: s.paper })), 'jset')).filter((b) => typeof b === 'string').join('');
  const blocksEn = content.resultsBlocks(rSig, 'en', new cite.Bibliography(report.studies.map((s) => ({ sid: s.sid, paper: s.paper })), 'ieee')).filter((b) => typeof b === 'string').join('');
  check('有意でない統合値（日本語版）: 有意でないと書く', /統計的に有意ではなく（信頼区間が0を含む）/.test(blocksJa), blocksJa.slice(0, 200));
  check('有意でない統合値（英語版）: not statistically significant と書く', /not statistically significant: the confidence interval includes zero/.test(blocksEn));
  check('有意な統合値では従来の文のまま', !/統計的に有意ではなく（信頼区間/.test(content.resultsBlocks(report, 'ja', new cite.Bibliography(report.studies.map((s) => ({ sid: s.sid, paper: s.paper })), 'jset')).filter((b) => typeof b === 'string').join('')));
  const artNS = content.buildArticleHtml(rSig, report.text.article, new cite.Bibliography(report.studies.map((s) => ({ sid: s.sid, paper: s.paper })), 'jset'), { paperJa: 'a', paperEn: 'b', data: 'c', figure: '' }, false);
  check('有意でない統合値（記事）: 信頼区間が0をまたぐと書く', artNS.includes('95% 信頼区間が0をまたいでおり、統計的に有意ではありません'));
  // ---- 比較条件の種類の分析が、論文・表・CSV に出る ----
  const cgr = report.analysis.comparatorSubgroups;
  check('通し: 比較の種類の分析ができる', cgr && cgr.groups.length === 2 && report.analysis.comparatorUnclear === 1, cgr && cgr.groups.map((g) => g.key + ':' + g.k));
  check('日本語版: 方法に比較の種類の分類と分析を書く', ja.includes('比較群の条件が') && ja.includes('根拠となる本文の箇所を引用させた') && ja.includes('引用が本文に見つからない分類は「不明」とした') && ja.includes('による下位集団分析も') && ja.includes('比較の種類が不明な研究は'));
  check('日本語版: 結果に比較の種類別の推定値・差の検定・不明の除外を書く', ja.includes('比較条件の種類別では') && ja.includes('受動的な比較') && ja.includes('能動的な比較') && ja.includes('比較の種類による差は統計的に有意') && ja.includes('比較の種類が不明だった') && ja.includes('探索的'),
    ['比較条件の種類別では', '受動的な比較', '能動的な比較', '比較の種類による差は統計的に有意', '比較の種類が不明だった', '探索的'].filter((x) => !ja.includes(x)));
  check('英語版: 結果に比較の種類別の推定値・差の検定・不明の除外を書く', en.includes('By type of comparison condition') && en.includes('passive comparison (no intervention or regular lessons)') && en.includes('active comparison (an alternative intervention)') && en.includes('difference between comparison types') && en.includes('whose comparison type was unclear was left out') && en.includes('exploratory'));
  check('表3に比較の種類の行がある（日英）', ja.includes('受動的な比較（介入なし・通常授業など）') && en.includes('passive comparison (no intervention or regular lessons)') && (ja.match(/能動的な比較/g) || []).length >= 2);
  check('表2の比較条件に [受動]／[能動] の印（不明は付けない）', ja.includes('[受動]') && ja.includes('[能動]') && en.includes('[passive]') && en.includes('[active]') && (ja.match(/\[(受動|能動)\]/g) || []).length >= 6);
  const csvText = fs.readFileSync(path.join(outDir, 'studies.csv'), 'utf8');
  check('CSV に comparison_type の列', csvText.split('\r\n')[0].includes('comparison_type') && /,(passive|active|unclear),/.test(csvText));
  // この機能より前の報告（分類なし）は文面が変わらない
  const legacy = { ...report, studies: report.studies.map((s) => ({ ...s, data: { ...s.data, comparisonType: undefined } })), analysis: { ...report.analysis, comparatorSubgroups: undefined, comparatorUnclear: undefined } };
  const legacyText = content.resultsBlocks(legacy, 'ja', new cite.Bibliography(report.studies.map((s) => ({ sid: s.sid, paper: s.paper })), 'jset')).filter((b) => typeof b === 'string').join('') +
    content.methodBlocks(legacy, 'ja').filter((b) => typeof b === 'string').join('') + content.methodBlocks(legacy, 'en').filter((b) => typeof b === 'string').join('');
  check('分類のない過去の報告には、比較の種類のことを書かない', !/比較条件の種類|受動的|passive|comparison type/.test(legacyText) && !content.table2(legacy, 'en', new cite.Bibliography(report.studies.map((s) => ({ sid: s.sid, paper: s.paper })), 'ieee')).note.includes('passive'));
  check('事実に比較の種類の分析が入る（AI が書けるように）', JSON.stringify(content.buildFacts(report)).includes('difference between comparison types'));
  check('英語版: 日本語版へのリンク', en.includes('paper-ja.pdf') && ja.includes('paper-en.pdf'));
  const rawBase = 'https://raw.githubusercontent.com/k518-2026/MetaAnalysisToWP/main/reports/2026-10-04-math-fraction-instruction';
  const bare = rawBase.replace('https://', '');
  check('記事: 図は幅を指定して載せる（原画像 1800px のままだと記事からはみ出す）', /<img [^>]*forest-ja\.png"[^>]* width="450"/.test(art) && content.FIGURE_WIDTH === 450, (art.match(/<img [^>]*>/) || [])[0]);
  check('記事: PDF と CSV は頭の https:// を省いた文字（WordPress の自動リンク化を避ける）', art.includes('<li>日本語版（PDF）: ' + bare + '/paper-ja.pdf</li>') && art.includes('<li>English version (PDF): ' + bare + '/paper-en.pdf</li>') && art.includes('<li>抽出データ（CSV）: ' + bare + '/studies.csv</li>') && content.findLinks(art).length === 0 && !art.includes('/blob/'));
  check('記事: <a> も href も無い', !/<a\b/i.test(art) && !/href\s*=/i.test(art), (art.match(/<a\b[^>]*>/i) || [])[0]);
  check('記事: 参考文献の DOI は「DOI: 10.xxxx/...」', /DOI: 10\.9999\/test\.\d/.test(art) && !/https?:\/\/doi\.org/.test(art), (art.match(/.{20}doi\.org.{20}/) || [])[0]);
  check('記事: 図（img）は残す', /<img src="https:\/\/raw\.githubusercontent\.com\/[^"]+forest-ja\.png"/.test(art));
  check('論文 PDF は変えない（日本語版は DOI の URL のリンク、英語版は「doi: 10.xxxx/...」の文字）', /<a href="https:\/\/doi\.org\/10\.9999\/test\.\d"/.test(ja) && /doi: 10\.9999\/test\.\d/.test(en) && !/<a href="https:\/\/doi/.test(en));
  check('記事: 図は raw の URL', art.includes('https://raw.githubusercontent.com/k518-2026/MetaAnalysisToWP/main/reports/2026-10-04-math-fraction-instruction/forest-ja.png'));
  check('記事: "--" と <hr> が無い', !art.includes('--') && !/<hr/i.test(art));
  check('記事: 表がある', art.includes('<table>'));
  const csv = fs.readFileSync(path.join(outDir, 'studies.csv'), 'utf8');
  check('CSV: BOM と行数', csv.charCodeAt(0) === 0xFEFF && csv.trim().split('\r\n').length === report.studies.length + 1);
  const svg = fs.readFileSync(path.join(outDir, 'forest-en.svg'), 'utf8');
  check('図: 研究の数だけ四角', (svg.match(/<rect x=/g) || []).length === report.studies.length);
  if (!RENDER) {
    check('PDF の欄外は研究会の表記', rendered.some((j) => j.lang === 'ja' && j.footer.includes('教育情報分析研究会　生成AI論文')));
  }

  const ledger = JSON.parse(fs.readFileSync(path.join(tmp, 'ledger.json'), 'utf8'));
  check('台帳: 記録された', ledger.runs.length === 1 && ledger.runs[0].status === 'done' && ledger.runs[0].wpSentAt === '');
  check('一覧: reports/README.md', fs.readFileSync(path.join(tmp, 'reports', 'README.md'), 'utf8').includes('分数の指導法'));

  // 2回目は間隔があいていないので何もしない
  console.log = () => {};
  run.deps.now = () => new Date('2026-10-05T22:00:00Z');   // 日本時間 10-06（前回 10-04 から2日）
  run.options.theme = null;
  const again = await run.main();
  console.log = origLog;
  check('週1回: 2日後は作らない', again === null);

  // 同じテーマを指定しても、記事にしたテーマは作らない（--allow-repeat が無ければ）
  run.options.force = true;
  run.options.theme = 'math-fraction-instruction';
  let repeatErr = null;
  console.log = () => {};
  try { await run.main(); } catch (e) { repeatErr = e; } finally { console.log = origLog; }
  check('重複: 記事にしたテーマは指定しても止める', repeatErr && /すでに記事にしています/.test(repeatErr.message), repeatErr && repeatErr.message);
  run.options.force = false;
  run.options.theme = null;

  // ---- 送信（wordpress.js: 送る直前にリンクを外す）----
  {
    const envSaved = { ...process.env };
    const transportSaved = wordpress.createTransport;
    let mail = null;
    Object.assign(process.env, { WP_POST_EMAIL: 'post@example.wordpress.com', SMTP_USER: 'u@example.com', SMTP_PASSWORD: 'x' });
    wordpress.createTransport = () => ({ sendMail: async (m) => { mail = m; return { messageId: 'id' }; } });
    const warn = console.warn;
    let warned = '';
    console.warn = (...a) => { warned += a.join(' '); };
    try {
      await wordpress.send('【メタ分析】題', '<p>参考 <a href="https://doi.org/10.1/x">https://doi.org/10.1/x</a> と <a href="https://e.org/f.pdf">日本語版</a></p>\n[category 教育メタ分析]\n[end]');
    } finally {
      console.warn = warn;
      wordpress.createTransport = transportSaved;
      ['WP_POST_EMAIL', 'SMTP_USER', 'SMTP_PASSWORD'].forEach((k) => { if (envSaved[k] === undefined) delete process.env[k]; else process.env[k] = envSaved[k]; });
    }
    check('送信: メールの本文から <a> を外す（DOI は文字に）', mail && !/<a\b/i.test(mail.html) && mail.html.includes('DOI: 10.1/x') && mail.html.includes('日本語版 (e.org/f.pdf)'), mail && mail.html);
    check('送信: ショートコードは残る', mail && /\[category 教育メタ分析\]\n\[end\]$/.test(mail.html));
    check('送信: リンクを外したことを知らせる', /2 件残っていたので/.test(warned), warned);
  }

  // ---- 送信 ----
  const sendWp = require('./send-wp');
  const sent = [];
  sendWp.deps.send = async (subject, html) => { sent.push({ subject, html }); return { subject }; };
  sendWp.deps.urlOk = async () => true;
  sendWp.deps.sleep = async () => {};
  const cwdRoot = path.join(__dirname);
  // send-wp.js は自分の置き場所を root にするので、一時フォルダの中身を差し替えて呼ぶ
  const realLedger = path.join(cwdRoot, config.paths.ledger);
  const hadLedger = fs.existsSync(realLedger) ? fs.readFileSync(realLedger) : null;
  const realReports = path.join(cwdRoot, config.paths.reports, '2026-10-04-math-fraction-instruction');
  try {
    fs.copyFileSync(path.join(tmp, 'ledger.json'), realLedger);
    fs.mkdirSync(realReports, { recursive: true });
    fs.copyFileSync(path.join(outDir, 'article-ja.html'), path.join(realReports, 'article-ja.html'));
    // 過去の報告の記事ファイルのように、リンクが残っているもの
    fs.appendFileSync(path.join(realReports, 'article-ja.html'), '\n<p><a href="https://doi.org/10.1/legacy">https://doi.org/10.1/legacy</a></p>');
    console.log = () => {};
    await sendWp.main(['node', 'send-wp.js']);
    console.log = origLog;
    check('送信: 1通送る', sent.length === 1);
    check('送信: 記事ファイルに残るリンクも、送る前に外す', sent[0] && !/<a\b/i.test(sent[0].html) && sent[0].html.includes('DOI: 10.1/legacy'), sent[0] && (sent[0].html.match(/.{30}legacy.{20}/) || [])[0]);
    check('送信: 件名', sent[0] && sent[0].subject === '【メタ分析】' + report.theme.titleJa, sent[0] && sent[0].subject);
    check('送信: 末尾にショートコード', sent[0] && /\[category 教育メタ分析\][\s\S]*\[publicize off\]\n\[end\]$/.test(sent[0].html));
    const after = JSON.parse(fs.readFileSync(realLedger, 'utf8'));
    check('送信: 台帳に送信日時', !!after.runs[0].wpSentAt);
    console.log = () => {};
    const none = await sendWp.main(['node', 'send-wp.js']);
    console.log = origLog;
    check('送信: 送ったものは二度送らない', none === null && sent.length === 1);
    // 何も送らずに「成功」で終わらない（Actions で送ったつもりになる事故があった）
    const failOf = async (args) => { try { console.log = () => {}; await sendWp.main(args); return false; } catch (e) { return !!e.nothingToSend; } finally { console.log = origLog; } };
    check('送信: --dir が台帳に無ければ失敗', await failOf(['node', 'send-wp.js', '--dir', 'no-such-report']));
    check('送信: --draft で送るものが無ければ失敗', await failOf(['node', 'send-wp.js', '--draft']));
    check('送信: 指定なしで送るものが無いのは失敗にしない（定例の実行）', !(await failOf(['node', 'send-wp.js'])));
    sendWp.deps.urlOk = async () => false;
    after.runs[0].wpSentAt = '';
    fs.writeFileSync(realLedger, JSON.stringify(after));
    let threw = false;
    try { console.log = () => {}; await sendWp.main(['node', 'send-wp.js']); } catch { threw = true; } finally { console.log = origLog; }
    check('送信: PDF がリポジトリに無ければ送らない', threw && sent.length === 1);
  } finally {
    console.log = origLog;
    if (hadLedger) fs.writeFileSync(realLedger, hadLedger); else fs.rmSync(realLedger, { force: true });
    fs.rmSync(realReports, { recursive: true, force: true });
    const reportsDir = path.join(cwdRoot, config.paths.reports);
    if (fs.existsSync(reportsDir) && !fs.readdirSync(reportsDir).length) fs.rmdirSync(reportsDir);
    const idx = path.join(reportsDir, 'README.md');
    if (!hadLedger && fs.existsSync(idx) && fs.readdirSync(reportsDir).length === 1) fs.rmSync(reportsDir, { recursive: true, force: true });
  }

  if (RENDER) {
    const keep = path.join(__dirname, '.cache', 'test-render');
    fs.rmSync(keep, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(keep), { recursive: true });
    fs.cpSync(outDir, keep, { recursive: true });
    console.log('  見た目の確認用に残しました: ' + keep);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function liveTest() {
  const theme = config.themes[0];
  const oa = await require('./lib/openalex').search(theme);
  check('live: OpenAlex で候補が取れる', oa.papers.length > 20, oa.papers.length);
  check('live: OpenAlex の要旨が戻せる', oa.papers.filter((p) => p.abstract.length > 200).length > 10);
  console.log('  OpenAlex 上位: ' + oa.papers.slice(0, 3).map((p) => p.title.slice(0, 60)).join(' / '));
  const js = await require('./lib/jstage').search(theme);
  check('live: J-STAGE で候補が取れる', js.papers.length > 0, js.total);
  await require('./lib/jstage').enrich(js.papers.slice(0, 2));
  check('live: J-STAGE の要旨と PDF の URL', js.papers.slice(0, 2).some((p) => p.abstract && p.pdfUrls.length), JSON.stringify(js.papers.slice(0, 2).map((p) => [p.abstract.slice(0, 40), p.pdfUrls])));
}

(async () => {
  await unitTests();
  await llmTest();
  await pipelineTest();
  if (LIVE) await liveTest();
  const ng = checks.filter((c) => !c[1]);
  console.log(`\n${checks.length - ng.length} / ${checks.length} 項目 OK`);
  if (ng.length) {
    console.log('NG: ' + ng.map((c) => c[0]).join(' / '));
    process.exit(1);
  }
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
