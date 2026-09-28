/**
 * 論文と記事の中身（言語をまたいで共通の部分）
 *
 *   ・数値の書き方
 *   ・モデルに渡す「事実」
 *   ・方法と結果の文（コードが書く。数値をモデルに書かせない）
 *   ・表1（研究の特徴）と表2（メタ分析の結果）
 *   ・記事（WordPress）、CSV
 *
 * 論文の体裁（日本語版 = JSET、英語版 = ITEL）は paper.js。
 * WordPress のメール投稿では <hr> と "--" が署名の区切りとみなされ、以降が消えるので使わない。
 */
const config = require('../config');
const { back, magnitude } = require('./meta');
const { ETAL, jsetRef, ieeeShort } = require('./cite');

// ============================================================
// 数値の書き方（1 を超えない値は先頭の 0 を省く）
// ============================================================

const MINUS = '−';
function f(x, digits = 2) {
  if (!Number.isFinite(x)) return 'NA';
  const s = Math.abs(x).toFixed(digits);
  return (x < 0 && Number(s) !== 0 ? MINUS : '') + s;
}
function noZero(s) {
  return s.replace(/^(−?)0\./, '$1.');
}
function fp(p) {
  if (!Number.isFinite(p)) return '= NA';
  return p < 0.001 ? '< .001' : '= ' + noZero(p.toFixed(3));
}
/** 効果量の表記（r は先頭の 0 を省く） */
function fe(effectType, x) {
  const s = f(x);
  return effectType === 'r' ? noZero(s) : s;
}
function ci(effectType, lo, hi) {
  return '[' + fe(effectType, lo) + ', ' + fe(effectType, hi) + ']';
}
function measureName(et) {
  return et === 'r' ? 'r' : 'g';
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 統計記号をイタリックにする（JSET・ITEL とも。p, t, F, SD, M, N, n, g, r, k, Q, z, I², τ²） */
function italicStats(html) {
  return html
    .replace(/(^|[\s(（\[，,;：:])(p|t|F|SD|M|N|n|g|r|k|Q|z|d)(?=\s?(?:[=<>＝]|\(\d))/g, '$1<i>$2</i>')
    .replace(/I²/g, '<i>I</i>²')
    .replace(/τ²/g, '<i>τ</i>²');
}

/** 引用の印を HTML にする */
function etal(html) {
  return html.split(ETAL).join('<i>et al.</i>');
}

function refHtml(segs) {
  return segs.map((s) => {
    let t = escapeHtml(s.text);
    t = t.replace(/(https:\/\/doi\.org\/\S+?|https?:\/\/\S+?)(?=[.,]?$|[.,]?\s)/g, (u) => `<a href="${u}">${u}</a>`);
    if (s.italic) t = '<i>' + t + '</i>';
    if (s.bold) t = '<span class="vol">' + t + '</span>';
    return t;
  }).join('');
}

// ============================================================
// 事実（モデルに渡す）
// ============================================================

function studyEffect(et, s) {
  const z = 1.959963984540054;
  const se = Math.sqrt(s.effect.vi);
  return { est: back(et, s.effect.yi), lo: back(et, s.effect.yi - z * se), hi: back(et, s.effect.yi + z * se) };
}

function buildFacts(report) {
  const { theme, studies, analysis } = report;
  const et = theme.effect;
  const o = analysis.overall;
  const m = measureName(et);
  return {
    researchQuestion: theme.titleEn,
    population: theme.population,
    interventionOrPredictor: theme.intervention,
    comparison: theme.comparison,
    outcome: theme.outcome,
    effectSize: et === 'r' ? 'Pearson r (pooled via Fisher z)' : 'Hedges g (positive = favors intervention)',
    numberOfStudies: o.k,
    totalN: analysis.totalN,
    pooled: `${m} = ${fe(et, back(et, o.est))}, 95% CI ${ci(et, back(et, o.ci[0]), back(et, o.ci[1]))}, p ${fp(o.p)}`,
    magnitude: magnitude(et, back(et, o.est)).en,
    heterogeneity: `Q(${o.df}) = ${f(o.Q)}, p ${fp(o.pQ)}, I2 = ${f(o.I2, 1)}%, tau2 = ${f(o.tau2, 3)}`,
    predictionInterval: o.pi ? ci(et, back(et, o.pi[0]), back(et, o.pi[1])) : 'not computed (fewer than 3 studies)',
    leaveOneOutRange: analysis.looRange ? `${fe(et, back(et, analysis.looRange[0]))} to ${fe(et, back(et, analysis.looRange[1]))}` : 'not computed',
    subgroups: analysis.subgroups
      ? analysis.subgroups.groups.map((g) => `${g.band}: k = ${g.k}, ${m} = ${fe(et, back(et, g.est))}, 95% CI ${ci(et, back(et, g.ci[0]), back(et, g.ci[1]))}`)
        .concat([`difference between school levels: Q(${analysis.subgroups.df}) = ${f(analysis.subgroups.Qbetween)}, p ${fp(analysis.subgroups.p)}`])
      : 'not conducted (fewer than 2 studies per school level)',
    publicationBias: analysis.egger
      ? `Egger test intercept = ${f(analysis.egger.intercept)}, p ${fp(analysis.egger.p)}`
      : 'not assessed (fewer than 10 studies)',
    studies: studies.map((s) => {
      const e = studyEffect(et, s);
      return {
        id: s.sid, language: s.paper.language, country: s.data.country, grade: s.data.gradeLevel,
        schoolLevel: s.data.gradeBand, design: s.data.design, N: s.effect.n,
        intervention: s.data.intervention, comparison: s.data.comparison, outcome: s.data.outcomeMeasure,
        effect: `${m} = ${fe(et, e.est)} ${ci(et, e.lo, e.hi)}`, summary: s.data.summaryEn
      };
    })
  };
}

// ============================================================
// 方法と結果（コードが書く）。返り値は [{ h2 }, '段落', { table }, { figure }] の並び
// ============================================================

const BAND = {
  en: { elementary: 'elementary (grades 1–6)', middle: 'lower secondary (grades 7–9)', mixed: 'mixed grades', other: 'other' },
  ja: { elementary: '小学校（1〜6年）', middle: '中学校（7〜9年）', mixed: '学年混合', other: 'その他' }
};

function methodBlocks(report, lang) {
  const { theme, models } = report;
  const et = theme.effect;
  const oa = config.openalex;
  const modelList = [...models].join(', ');
  const js = theme.jstage && theme.jstage.length && config.jstage.enabled;
  const repo = `https://github.com/${config.repo.owner}/${config.repo.name}`;
  if (lang === 'en') {
    return [
      { h2: 'Literature Search' },
      `Searches were run on ${report.dateEn} in two open bibliographic sources. OpenAlex was searched in the title and abstract fields with the query “${theme.query}”, ` +
        `restricted to open-access journal articles published in ${oa.fromYear} or later and classified in the Education or Developmental and Educational Psychology subfields.` +
        (js ? ` J-STAGE, the Japanese journal platform, was searched in the abstract field with the keywords ${theme.jstage.map((k) => '“' + k + '”').join(', ')} (${config.jstage.fromYear} or later) to include studies published in Japan.` : ''),
      { h2: 'Eligibility Criteria' },
      `Studies were eligible if they (a) sampled ${theme.population.replace(/\.$/, '').replace(/\. /g, '; ')}; (b) examined ${theme.intervention}; ` +
        (et === 'r'
          ? `(c) reported the correlation with ${theme.outcome.replace(/; report the correlation r$/, '')}; and (d) reported the sample size.`
          : `(c) compared it with ${theme.comparison}; (d) measured ${theme.outcome}; and (e) reported statistics sufficient to compute a standardized mean difference.`) +
        ' Reviews, qualitative studies, single-case designs, and single-group pre-post designs were excluded.',
      { h2: 'Screening and Data Extraction' },
      `Screening and data extraction were automated. A large language model (${modelList}) rated each title and abstract against the eligibility criteria. ` +
        'Full texts (PDF) of the highest-rated records were retrieved and converted to plain text, and the model extracted study characteristics and summary statistics from them. ' +
        'Every extracted number was then checked by software against the full text, and a study was excluded from the synthesis if any extracted number could not be found verbatim. ' +
        `No human reviewer verified the screening or the extraction. When more than ${config.studies.max} studies qualified, the ${config.studies.max} with the highest screening ratings were retained.`,
      { h2: 'Effect Sizes' },
      et === 'r'
        ? 'Pearson correlations were transformed to Fisher’s z for analysis, with sampling variance 1/(N − 3), and back-transformed to r for reporting.'
        : 'Standardized mean differences were computed as Hedges’ g [M:hedges1981] from post-test means, standard deviations, and group sizes; when these were unavailable, from independent-samples t statistics, from F statistics with one numerator degree of freedom, or from reported d or g values. Positive values indicate higher scores in the intervention group. One effect size per study was used.',
      { h2: 'Statistical Analysis' },
      'Effect sizes were pooled with a random-effects model in which the between-study variance (τ²) was estimated with the DerSimonian–Laird method [M:dl1986]. ' +
        'Confidence intervals and tests of the pooled effect used the Hartung–Knapp–Sidik–Jonkman (HKSJ) adjustment, which is recommended when the number of studies is small [M:hk2001, M:inthout2014]. ' +
        'Heterogeneity was assessed with Q, I² [M:higgins2002], τ², and a 95% prediction interval. ' +
        'Subgroup analyses by school level (elementary: grades 1–6; lower secondary: grades 7–9) were conducted when each level included at least two studies. ' +
        'Robustness was examined with leave-one-out analysis, and Egger’s regression test [M:egger1997] was planned only when at least 10 studies were available. ' +
        `Effect magnitudes were interpreted with conventional benchmarks [M:cohen1988]. Analyses followed standard formulas [M:borenstein2009] implemented in open-source JavaScript code (${repo}).`
    ];
  }
  // 適格基準はモデルが訳したもの（無ければ英語のまま）
  const cr = Object.assign({ population: theme.population, intervention: theme.intervention, comparison: theme.comparison, outcome: theme.outcome },
    Object.fromEntries(Object.entries(((report.text || {}).ja || {}).criteria || {}).filter(([, v]) => v)));
  return [
    { h2: '文献の検索' },
    // 検索式は英語の長い1語が多い。⟦ ⟧ で囲んだ部分は paper.js が途中で折り返せるようにする
    `${report.dateJa}に，公開されている2つの書誌データベースを検索した．OpenAlex では題名と要旨を対象に次の検索式を用いた：「⟦${theme.query}⟧」．` +
      `対象は${oa.fromYear}年以降に刊行されたオープンアクセスの学術誌論文で，分野が教育学（Education）または発達・教育心理学（Developmental and Educational Psychology）に分類されたものに限った．` +
      (js ? `国内の研究を含めるため，J-STAGE でも要旨を対象に${theme.jstage.map((k) => '「' + k + '」').join('，')}のキーワードで検索した（${config.jstage.fromYear}年以降）．` : ''),
    { h2: '適格基準' },
    `次の条件をすべて満たす研究を対象とした：(a) 対象者：${cr.population.replace(/[．.]$/, '')}；(b) 扱う要因：${cr.intervention}；` +
      (et === 'r'
        ? `(c) 成果指標：${cr.outcome}（相関係数を報告していること）；(d) 標本の大きさを報告していること．`
        : `(c) 比較の対象：${cr.comparison}；(d) 成果指標：${cr.outcome}；(e) 標準化平均差を計算できる統計量を報告していること．`) +
      'レビュー，質的研究，一事例実験，比較群のない前後比較のみの研究は除外した．',
    { h2: '選別とデータの抽出' },
    `選別とデータの抽出は自動で行った．大規模言語モデル（${modelList}）が，各論文の題名と要旨を適格基準に照らして評価した．` +
      '評価の高い論文から本文（PDF）を取得してテキストに変換し，同じモデルが研究の特徴と要約統計量を抽出した．' +
      '抽出したすべての数値は，本文にその数字が実際に書かれているかをプログラムで照合し，1つでも見つからない研究は統合から除外した．' +
      `選別と抽出を人が確認する工程はない．条件を満たす研究が${config.studies.max}本を超えた場合は，評価の高い${config.studies.max}本を用いた．`,
    { h2: '効果量' },
    et === 'r'
      ? 'ピアソンの相関係数 r をフィッシャーの z に変換して分析し（標本分散 1/(N − 3)），報告の際に r に戻した．'
      : '標準化平均差として Hedges の g を求めた [M:hedges1981]．事後テストの平均・標準偏差・人数から計算し，それらが報告されていない場合は独立な2群の t 値，分子の自由度が1の F 値，報告された d または g の順に用いた．正の値は介入群の得点が高いことを表す．1研究につき1つの効果量を用いた．',
    { h2: '統計解析' },
    '効果量はランダム効果モデルで統合し，研究間分散（τ²）は DerSimonian–Laird 法で推定した [M:dl1986]．' +
      '統合値の信頼区間と検定には，研究数が少ない場合に推奨される Hartung–Knapp–Sidik–Jonkman 法（HKSJ 法）を用いた [M:hk2001, M:inthout2014]．' +
      '異質性は Q，I² [M:higgins2002]，τ²，95% 予測区間で評価した．' +
      '学校段階（小学校：1〜6年，中学校：7〜9年）ごとに2研究以上ある場合は下位集団分析を行った．' +
      '頑健性は1研究ずつ除いた分析で確かめ，Egger の回帰検定 [M:egger1997] は研究数が10以上の場合にのみ行うこととした．' +
      `効果の大きさは慣例的な目安で解釈した [M:cohen1988]．計算は標準的な式 [M:borenstein2009] に従い，公開した JavaScript のプログラム（${repo}）で行った．`
  ];
}

function resultsBlocks(report, lang) {
  const { theme, search, studies, analysis } = report;
  const et = theme.effect;
  const o = analysis.overall;
  const m = measureName(et);
  const mag = magnitude(et, back(et, o.est));
  const allIds = '[' + studies.map((s) => s.sid).join(', ') + ']';
  const bands = {};
  studies.forEach((s) => { bands[s.data.gradeBand] = (bands[s.data.gradeBand] || 0) + 1; });
  const countries = [...new Set(studies.map((s) => (lang === 'ja' ? (s.data.ja.country || s.data.country) : s.data.country)).filter(Boolean))];
  const ex = search.excluded;
  const df = o.df;
  const sg = analysis.subgroups;
  const pooled = `${m} = ${fe(et, back(et, o.est))}`;
  const pooledCi = ci(et, back(et, o.ci[0]), back(et, o.ci[1]));
  const tTest = o.k > 1 ? `t(${df}) = ${f(o.test)}, ` : '';

  if (lang === 'en') {
    return [
      { h2: 'Study Selection' },
      `The searches returned ${search.openalex.retrieved} records from OpenAlex (of ${search.openalex.total} matching the query) and ${search.jstage.retrieved} from J-STAGE, ` +
        `for ${search.merged} unique records. Of the ${search.screened} records with abstracts that were screened, ${search.passedScreening} were rated as potentially eligible. ` +
        `Full texts of ${search.fullTextsTried} records were examined: ${ex.noPdf} could not be retrieved or read, ${ex.ineligible} did not meet the eligibility criteria, ` +
        `${ex.noStats} did not report sufficient statistics, ${ex.unverified} contained extracted numbers that could not be verified in the text, and ${ex.implausible} yielded implausible values. ` +
        `In total, ${o.k} studies were included in the meta-analysis.`,
      { h2: 'Study Characteristics' },
      `Table 1 summarizes the included studies ${allIds}. They comprised ${analysis.totalN} participants in total and were conducted in ${countries.join(', ') || 'unreported countries'}. ` +
        `By school level, ${Object.keys(bands).map((b) => `${bands[b]} ${bands[b] === 1 ? 'study' : 'studies'} sampled ${BAND.en[b]} students`).join(', ')}.`,
      { table: 1 },
      { h2: 'Overall Effect' },
      `The random-effects model yielded a pooled effect of ${pooled}, 95% CI ${pooledCi}, ${tTest}p ${fp(o.p)} (Fig. 1 and Table 2), ` +
        `which corresponds to a ${mag.en} effect by conventional benchmarks. The fixed-effect estimate was ${m} = ${fe(et, back(et, o.fixed.est))}.`,
      { figure: 1 },
      { h2: 'Heterogeneity' },
      `Heterogeneity was ${o.I2 < 25 ? 'low' : o.I2 < 50 ? 'moderate' : o.I2 < 75 ? 'substantial' : 'considerable'}, Q(${df}) = ${f(o.Q)}, p ${fp(o.pQ)}, I² = ${f(o.I2, 1)}%, τ² = ${f(o.tau2, 3)}.` +
        (o.pi ? ` The 95% prediction interval ranged from ${fe(et, back(et, o.pi[0]))} to ${fe(et, back(et, o.pi[1]))}.` : ''),
      { h2: 'Subgroup and Sensitivity Analyses' },
      (sg
        ? sg.groups.map((g) => `For ${BAND.en[g.band]} samples, ${m} = ${fe(et, back(et, g.est))}, 95% CI ${ci(et, back(et, g.ci[0]), back(et, g.ci[1]))} (k = ${g.k})`).join('; ') +
          `. The difference between school levels was ${sg.p < 0.05 ? '' : 'not '}statistically significant, Q(${sg.df}) = ${f(sg.Qbetween)}, p ${fp(sg.p)}. `
        : 'A subgroup analysis by school level was not conducted because fewer than two studies were available for at least one level. ') +
        (analysis.looRange ? `Leave-one-out estimates ranged from ${fe(et, back(et, analysis.looRange[0]))} to ${fe(et, back(et, analysis.looRange[1]))}. ` : '') +
        (analysis.egger
          ? `Egger’s test ${analysis.egger.p < 0.05 ? 'indicated' : 'did not indicate'} funnel plot asymmetry (intercept = ${f(analysis.egger.intercept)}, p ${fp(analysis.egger.p)}).`
          : 'Publication bias was not tested because fewer than 10 studies were included.'),
      { table: 2 }
    ];
  }
  return [
    { h2: '研究の選定' },
    `検索の結果，OpenAlex から${search.openalex.retrieved}件（検索式に合う${search.openalex.total}件のうち上位），J-STAGE から${search.jstage.retrieved}件を得た．` +
      `重複を除くと${search.merged}件であった．要旨のある${search.screened}件を選別し，${search.passedScreening}件を適格の可能性ありと判定した．` +
      `本文を調べた${search.fullTextsTried}件のうち，取得または読み取りができなかったものが${ex.noPdf}件，適格基準を満たさなかったものが${ex.ineligible}件，` +
      `統計量が不足していたものが${ex.noStats}件，抽出した数値を本文で確認できなかったものが${ex.unverified}件，効果量が現実的でない値になったものが${ex.implausible}件であった．` +
      `最終的に${o.k}本の研究をメタ分析に含めた．`,
    { h2: '研究の特徴' },
    `対象とした研究 ${allIds} の概要を表1に示す．参加者は合計${analysis.totalN}人で，実施国は${countries.join('，') || '不明'}であった．` +
      `学校段階別では，${Object.keys(bands).map((b) => `${BAND.ja[b]}が${bands[b]}本`).join('，')}であった．`,
    { table: 1 },
    { h2: '全体の効果' },
    `ランダム効果モデルによる統合値は ${pooled}，95% 信頼区間 ${pooledCi}，${tTest.replace(', ', '，')}p ${fp(o.p)} であった（図1，表2）．` +
      `慣例的な目安では${mag.ja}効果にあたる．固定効果モデルによる推定値は ${m} = ${fe(et, back(et, o.fixed.est))} であった．`,
    { figure: 1 },
    { h2: '異質性' },
    `研究間の異質性は${o.I2 < 25 ? '小さかった' : o.I2 < 50 ? '中程度であった' : o.I2 < 75 ? '大きかった' : '非常に大きかった'}（Q(${df}) = ${f(o.Q)}，p ${fp(o.pQ)}，I² = ${f(o.I2, 1)}%，τ² = ${f(o.tau2, 3)}）．` +
      (o.pi ? `95% 予測区間は ${fe(et, back(et, o.pi[0]))} から ${fe(et, back(et, o.pi[1]))} であった．` : ''),
    { h2: '下位集団分析と感度分析' },
    (sg
      ? sg.groups.map((g) => `${BAND.ja[g.band]}では ${m} = ${fe(et, back(et, g.est))}，95% 信頼区間 ${ci(et, back(et, g.ci[0]), back(et, g.ci[1]))}（k = ${g.k}）`).join('，') +
        `であり，学校段階間の差は統計的に有意${sg.p < 0.05 ? 'であった' : 'ではなかった'}（Q(${sg.df}) = ${f(sg.Qbetween)}，p ${fp(sg.p)}）．`
      : '少なくとも一方の学校段階で研究が2本未満だったため，学校段階別の下位集団分析は行わなかった．') +
      (analysis.looRange ? `1研究ずつ除いた推定値は ${fe(et, back(et, analysis.looRange[0]))} から ${fe(et, back(et, analysis.looRange[1]))} の範囲であった．` : '') +
      (analysis.egger
        ? `Egger の検定ではファンネルプロットの非対称性が${analysis.egger.p < 0.05 ? '示された' : '示されなかった'}（切片 = ${f(analysis.egger.intercept)}，p ${fp(analysis.egger.p)}）．`
        : '研究数が10未満のため，出版バイアスの検定は行わなかった．'),
    { table: 2 }
  ];
}

/** 自動化に伴う限界（両言語とも必ず載せる） */
function automationLimitation(lang) {
  return lang === 'ja'
    ? '加えて，本分析は選別とデータ抽出を言語モデルで自動化しており，抽出した数値は本文との文字列の照合でしか確認していない．数値が本文に存在しても，別の群や別の測定の値を取り違えている可能性は残る．対象はオープンアクセスで本文を取得できた論文に限られ，有料の論文や未刊行の研究は含まれていない．'
    : 'In addition, screening and data extraction were automated with a language model, and extracted numbers were verified only by matching them against the full text. A number can be present in the text yet belong to a different group or measure. Only open-access studies whose full texts could be retrieved were included; subscription-only and unpublished studies were not.';
}

// ============================================================
// 表（中身だけ。体裁は paper.js と記事で付ける）
// ============================================================

/** bib.narrative で研究の見出しを作る（jset: LEE @@ETAL@@ (2021)、ieee: Lee et al. [1]） */
function table1(report, lang, bib) {
  const et = report.theme.effect;
  const m = measureName(et);
  const ja = lang === 'ja';
  const head = ja
    ? ['研究', '国', '学年', 'デザイン', 'N', et === 'r' ? '予測変数' : '介入／比較', '成果指標', `${m} [95% CI]`]
    : ['Study', 'Country', 'Grade', 'Design', 'N', et === 'r' ? 'Predictor' : 'Intervention / Comparison', 'Outcome', `${m} [95% CI]`];
  const rows = report.studies.map((s) => {
    const d = s.data;
    const t = ja ? { ...d, ...Object.fromEntries(Object.entries(d.ja || {}).filter(([, v]) => v)) } : d;
    const e = studyEffect(et, s);
    return [
      bib.narrative(s.sid), t.country, t.gradeLevel, t.design, String(s.effect.n),
      et === 'r' ? t.intervention : t.intervention + (ja ? '／' : ' / ') + t.comparison,
      t.outcomeMeasure, fe(et, e.est) + ' ' + ci(et, e.lo, e.hi)
    ];
  });
  return {
    number: 1,
    title: ja ? '対象とした研究の特徴' : 'Characteristics of the Included Studies',
    head, rows, wrap: [5, 6],
    note: ja
      ? `CI＝信頼区間．${et === 'r' ? 'r はピアソンの相関係数．' : 'g は Hedges の g（正の値は介入群が高い）．'}学年・デザイン等は論文の本文から自動で抽出した．`
      : `CI = confidence interval. ${et === 'r' ? 'r = Pearson correlation.' : 'g = Hedges’ g (positive values favor the intervention).'} Study characteristics were extracted automatically from the full texts.`
  };
}

function table2(report, lang) {
  const et = report.theme.effect;
  const a = report.analysis;
  const o = a.overall;
  const m = measureName(et);
  const ja = lang === 'ja';
  const nOf = (band) => report.studies.filter((s) => !band || s.data.gradeBand === band).reduce((x, s) => x + s.effect.n, 0);
  const row = (label, r, n, het = true) => [
    label, String(r.k), String(n), fe(et, back(et, r.est)), ci(et, back(et, r.ci[0]), back(et, r.ci[1])),
    fp(r.p).replace('= ', ''), het && r.k > 1 ? f(r.I2, 1) : '—', het && r.k > 1 ? f(r.tau2, 3) : '—'
  ];
  const z = 1.959963984540054;
  const rows = [row(ja ? 'ランダム効果（HKSJ）' : 'Random effects (HKSJ)', o, a.totalN)];
  rows.push(row(ja ? '固定効果' : 'Fixed effect', {
    k: o.k, est: o.fixed.est, ci: [o.fixed.est - z * o.fixed.se, o.fixed.est + z * o.fixed.se],
    p: require('./stats').pFromZ(o.fixed.est / o.fixed.se)
  }, a.totalN, false));
  if (a.subgroups) a.subgroups.groups.forEach((g) => rows.push(row('　' + BAND[lang][g.band], g, nOf(g.band))));
  return {
    number: 2,
    title: ja ? 'メタ分析の結果' : 'Results of the Meta-Analysis',
    head: [ja ? 'モデル' : 'Model', 'k', 'N', m, '95% CI', 'p', 'I² (%)', 'τ²'],
    rows,
    note: ja
      ? `k＝研究数．HKSJ＝Hartung–Knapp–Sidik–Jonkman 法による信頼区間．${o.pi ? `95% 予測区間 ${ci(et, back(et, o.pi[0]), back(et, o.pi[1]))}．` : ''}`
      : `k = number of studies. HKSJ = Hartung–Knapp–Sidik–Jonkman confidence interval.${o.pi ? ` 95% prediction interval ${ci(et, back(et, o.pi[0]), back(et, o.pi[1]))}.` : ''}`
  };
}

// ============================================================
// 記事（WordPress）
// ============================================================

function articleTitle(theme) {
  return config.wordpress.titlePrefix + theme.titleJa;
}

function shortcodes(wp) {
  const out = [];
  if (wp.category) out.push('[category ' + wp.category + ']');
  if (wp.tags) out.push('[tags ' + wp.tags + ']');
  if (wp.draft) out.push('[status draft]');
  if (!wp.publicize) out.push('[publicize off]');
  out.push('[end]');   // これ以降（メールの署名など）を本文に含めない
  return out.join('\n');
}

/**
 * 記事の HTML（日本語）。bib は jset 様式。links = { paperJa, paperEn, data, figure }
 * withShortcodes = true のとき末尾に WordPress の指定を付ける（メール用）
 */
function buildArticleHtml(report, art, bib, links, withShortcodes) {
  const et = report.theme.effect;
  const o = report.analysis.overall;
  const m = measureName(et);
  const mag = magnitude(et, back(et, o.est));
  const t = (s) => etal(escapeHtml(bib.resolve(s)));
  const out = [];

  out.push('<p>' + t(art.lead) + '</p>');
  out.push(`<p>著者: ${escapeHtml(config.author.nameJa)}（${escapeHtml(report.dateJa)}）</p>`);

  out.push('<h2>このメタ分析の問い</h2>');
  out.push('<p>' + t(art.question) + '</p>');

  out.push('<h2>分析した論文</h2>');
  out.push(`<p>国内外のオープンアクセス論文を検索し（${report.search.merged}件），条件に合い効果量を計算できた${o.k}本（参加者 合計${report.analysis.totalN}人）を統合しました。</p>`);
  const t1 = table1(report, 'ja', bib);
  out.push('<table><thead><tr>' + t1.head.map((h) => '<th>' + escapeHtml(h) + '</th>').join('') + '</tr></thead><tbody>' +
    t1.rows.map((r) => '<tr>' + r.map((c) => '<td>' + etal(escapeHtml(c)) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');

  out.push('<h2>結果</h2>');
  out.push(`<p>全体の効果量は <strong>${m} = ${fe(et, back(et, o.est))}</strong>（95% 信頼区間 ${ci(et, back(et, o.ci[0]), back(et, o.ci[1]))}）で，慣例的な目安では「${mag.ja}」効果にあたります。研究間のばらつきは I² = ${f(o.I2, 1)}% でした。</p>`);
  if (links.figure) out.push(`<p><img src="${links.figure}" alt="フォレストプロット" /></p>`);
  art.reading.forEach((s) => out.push('<p>' + t(s) + '</p>'));

  out.push('<h2>小学校・中学校の授業へのヒント</h2>');
  out.push('<ul>' + art.hints.map((s) => '<li>' + t(s) + '</li>').join('') + '</ul>');

  out.push('<h2>読むときの注意</h2>');
  out.push('<ul>' + art.cautions.map((s) => '<li>' + t(s) + '</li>').join('') +
    '<li>論文の選別と数値の抽出は生成 AI で自動化しています。抽出した数値は論文の本文と照合していますが，人による確認は経ていません。</li></ul>');

  out.push('<h2>論文（PDF）</h2>');
  out.push('<p>方法・結果の詳細と参考文献は，同じ内容の日本語版と英語版の論文にまとめています。</p>');
  out.push('<ul>' +
    `<li><a href="${links.paperJa}" target="_blank" rel="noopener">日本語版（PDF）</a></li>` +
    `<li><a href="${links.paperEn}" target="_blank" rel="noopener">English version (PDF)</a></li>` +
    (links.data ? `<li><a href="${links.data}" target="_blank" rel="noopener">抽出データ（CSV）</a></li>` : '') +
    '</ul>');

  out.push('<h2>分析した論文</h2>');
  out.push('<ul>' + report.studies.map((s) => '<li>' + etal(refHtml(jsetRef({ ...s.paper, included: false }, bib.years[s.sid]))) + '</li>').join('') + '</ul>');

  // 記事はふつうの句読点（論文の「，」は JSET の書式なので、記事では「、」に戻す）
  let html = out.join('\n').replace(/，/g, '、');
  if (withShortcodes) html += '\n' + shortcodes(config.wordpress);
  return stripAstral(html);
}

// 異体字セレクタとゼロ幅接合子。**正規表現リテラルに直接書かない**（編集ツールが見えない文字に変えてしまう）
const INVISIBLE = new RegExp('[\\uFE00-\\uFE0F\\u200D]', 'g');
const SURROGATE_PAIR = new RegExp('[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]', 'g');

/** WordPress は4バイト文字（絵文字）が化けるので落とす。"--" は署名の区切りとみなされるので崩す */
function stripAstral(text) {
  return String(text == null ? '' : text)
    .replace(SURROGATE_PAIR, '')
    .replace(INVISIBLE, '')
    .replace(/--/g, '−−')
    .replace(/<hr\s*\/?>/gi, '');
}

// ============================================================
// CSV（抽出データ）
// ============================================================

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function buildCsv(report) {
  const et = report.theme.effect;
  const statKeys = et === 'r' ? ['r', 'nTotal'] : ['nTreatment', 'nControl', 'meanTreatment', 'meanControl', 'sdTreatment', 'sdControl', 't', 'F', 'd', 'g', 'direction'];
  const head = ['id', 'study', 'title', 'year', 'venue', 'doi', 'country', 'grade', 'school_level', 'design', 'intervention', 'comparison', 'outcome']
    .concat(statKeys, ['effect_method', 'yi', 'vi', 'n', 'weight_percent']);
  const rows = report.studies.map((s, i) => [
    s.sid, ieeeShort(s.paper) + ' (' + s.paper.year + ')', s.paper.title, s.paper.year, s.paper.venue, s.paper.doi,
    s.data.country, s.data.gradeLevel, s.data.gradeBand, s.data.design, s.data.intervention, s.data.comparison, s.data.outcomeMeasure
  ].concat(statKeys.map((k) => s.data.stats[k]), [s.effect.method, s.effect.yi.toFixed(4), s.effect.vi.toFixed(5), s.effect.n,
    report.analysis.overall.weights[i].toFixed(2)]));
  // Excel で文字化けしないよう BOM を付ける
  return String.fromCharCode(0xFEFF) + [head].concat(rows).map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

module.exports = {
  f, fp, fe, ci, noZero, measureName, escapeHtml, italicStats, etal, refHtml, studyEffect,
  buildFacts, methodBlocks, resultsBlocks, automationLimitation, table1, table2, BAND,
  articleTitle, shortcodes, buildArticleHtml, stripAstral, buildCsv
};
