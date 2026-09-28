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
  check('数値でない値は照合に落ちる', review.verifyStats({ nControl: 'about 30' }, text).length === 1);

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
  check('扱ったテーマは後ろへ', order[order.length - 1].id === 'math-fraction-instruction', order.map((t) => t.id).slice(-2));
  const L2 = { runs: [{ date: '2026-09-20', themeId: 'info-unplugged-ct', status: 'failed' }, { date: '2026-09-20', themeId: 'math-fraction-instruction', status: 'done' }] };
  check('失敗したテーマは後回し', ledgerLib.themeOrder(config.themes, L2)[0].id !== 'info-unplugged-ct');
  check('日数の計算', ledgerLib.daysSinceLast(L, '2026-09-27') === 7 && ledgerLib.daysSinceLast({ runs: [] }, '2026-09-27') === Infinity);
  check('日本時間の日付（朝6時でも当日）', ledgerLib.jstDate(new Date('2026-09-27T21:00:00Z')) === '2026-09-28');

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
  check('英語版: 日本語版へのリンク', en.includes('paper-ja.pdf') && ja.includes('paper-en.pdf'));
  check('記事: PDF へのリンク', art.includes('/blob/main/reports/2026-10-04-math-fraction-instruction/paper-ja.pdf') && art.includes('paper-en.pdf'));
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
  run.deps.now = () => new Date('2026-10-06T22:00:00Z');
  run.options.theme = null;
  const again = await run.main();
  console.log = origLog;
  check('週1回: 3日後は作らない', again === null);

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
    console.log = () => {};
    await sendWp.main(['node', 'send-wp.js']);
    console.log = origLog;
    check('送信: 1通送る', sent.length === 1);
    check('送信: 件名', sent[0] && sent[0].subject === '【メタ分析】' + report.theme.titleJa, sent[0] && sent[0].subject);
    check('送信: 末尾にショートコード', sent[0] && /\[category 教育メタ分析\][\s\S]*\[publicize off\]\n\[end\]$/.test(sent[0].html));
    const after = JSON.parse(fs.readFileSync(realLedger, 'utf8'));
    check('送信: 台帳に送信日時', !!after.runs[0].wpSentAt);
    console.log = () => {};
    const none = await sendWp.main(['node', 'send-wp.js']);
    console.log = origLog;
    check('送信: 送ったものは二度送らない', none === null && sent.length === 1);
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
