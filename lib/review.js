/**
 * 文献の選別（要旨）とデータの抽出（本文）
 *
 * 抽出した数値は**本文に実際にその数字が書かれているか**をコードで照合する。
 * 1つでも見つからない研究は「未確認」として統合から外す（モデルの読み違い・作り話を入れないため）。
 */
const llm = require('./llm');
const config = require('../config');
const { dropReferenceList } = require('./pdf');

// ============================================================
// 要旨による選別
// ============================================================

function criteria(theme) {
  const design = theme.effect === 'r'
    ? 'a quantitative study that reports (or is likely to report) a Pearson correlation between the predictor and the outcome'
    : 'an experimental or quasi-experimental study comparing an intervention group with a comparison/control group on a quantitative post-test';
  return [
    'Population: ' + theme.population,
    'Intervention / predictor: ' + theme.intervention,
    'Comparison: ' + theme.comparison,
    'Outcome: ' + theme.outcome,
    'Design: ' + design + '.',
    'Exclude: reviews, meta-analyses, qualitative-only studies, single-case designs, single-group pre-post studies without a comparison group' +
      (theme.effect === 'r' ? ' (not relevant for correlational themes)' : '') +
      ', conference abstracts, and studies whose main sample is outside the population.'
  ].join('\n');
}

const screenSchema = {
  type: 'OBJECT',
  properties: {
    decisions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          n: { type: 'INTEGER' },
          include: { type: 'BOOLEAN' },
          score: { type: 'INTEGER' },
          reason: { type: 'STRING' }
        },
        required: ['n', 'include', 'score', 'reason']
      }
    }
  },
  required: ['decisions']
};

function screenPrompt(theme, batch) {
  const list = batch.map((p, i) => {
    const abs = String(p.abstract || '').slice(0, config.screening.abstractMaxChars) || '(no abstract)';
    return `[${i + 1}] ${p.title}${p.titleEn ? ' / ' + p.titleEn : ''} (${p.year}; ${p.venue})\n${abs}`;
  }).join('\n\n');

  return [
    'You are screening studies for a meta-analysis in education research.',
    'Research question: ' + theme.titleEn,
    '',
    'Inclusion criteria:',
    criteria(theme),
    '',
    'For EVERY record below, return {n, include, score, reason}.',
    'score: 0-10, how likely the full text will meet all criteria AND report enough statistics',
    '(means, SDs and group sizes; or t/F with group sizes; or Cohen\'s d / Hedges\' g' +
      (theme.effect === 'r' ? '; or a correlation r with N' : '') + ').',
    'include = true only when score >= 6. reason: one short English sentence.',
    'Records may be in Japanese; judge them by the same criteria.',
    '',
    list
  ].join('\n');
}

/** 候補を要旨で選別し、採用したものを見込みの高い順に返す */
async function screen(theme, candidates) {
  const size = config.screening.batchSize;
  const errors = [];
  let batches = 0;
  for (let i = 0; i < candidates.length; i += size) {
    const batch = candidates.slice(i, i + size);
    batches++;
    let res;
    try {
      res = await llm.generateJson(screenPrompt(theme, batch), screenSchema);
    } catch (e) {
      errors.push(e.message);
      console.warn('  選別に失敗（この束は飛ばします）: ' + e.message.slice(0, 300));
      continue;
    }
    if (!Array.isArray((res || {}).decisions) || !res.decisions.length) {
      errors.push('判定が空: ' + JSON.stringify(res).slice(0, 200));
      console.warn('  選別の応答に判定がありません: ' + JSON.stringify(res).slice(0, 200));
      continue;
    }
    (res.decisions || []).forEach((d) => {
      const p = batch[Number(d.n) - 1];
      if (!p) return;
      // include が文字列 "false" で返っても真にしない
      const include = d.include === true || String(d.include).toLowerCase() === 'true';
      p.screen = { include, score: Number(d.score) || 0, reason: String(d.reason || '') };
    });
  }
  // 全部の束が失敗したのは「候補が0件」ではなく仕組みの故障。テーマのせいにせず、実行を止めて原因を見せる
  if (batches && errors.length === batches) {
    const e = new Error('要旨の選別がすべて失敗しました: ' + errors[errors.length - 1].slice(0, 400));
    e.systemic = true;
    throw e;
  }
  const scored = candidates.filter((p) => p.screen);
  const counts = { include: scored.filter((p) => p.screen.include).length, scored: scored.length };
  console.log(`  選別の内訳: 判定 ${counts.scored} 件（採用 ${counts.include}）` +
    (scored.length ? '、却下の理由の例: ' + scored.filter((p) => !p.screen.include).slice(0, 3).map((p) => p.screen.reason).join(' / ') : ''));
  return candidates
    .filter((p) => p.screen && p.screen.include)
    .sort((a, b) => b.screen.score - a.screen.score);
}

// ============================================================
// 本文からの抽出
// ============================================================

const STAT_KEYS_SMD = ['nTreatment', 'nControl', 'meanTreatment', 'meanControl', 'sdTreatment', 'sdControl', 't', 'F', 'd', 'g'];
const STAT_KEYS_R = ['r', 'nTotal'];
// 日本語版の表に使う訳（英語版と同じ内容にするため、抽出のときに一緒に作らせる）
const JA_KEYS = ['country', 'gradeLevel', 'design', 'intervention', 'comparison', 'outcomeMeasure'];

const extractSchema = {
  type: 'OBJECT',
  properties: {
    eligible: { type: 'BOOLEAN' },
    reason: { type: 'STRING' },
    country: { type: 'STRING' },
    gradeLevel: { type: 'STRING' },
    gradeBand: { type: 'STRING', enum: ['elementary', 'middle', 'mixed', 'other'] },
    design: { type: 'STRING' },
    intervention: { type: 'STRING' },
    comparison: { type: 'STRING' },
    comparisonType: { type: 'STRING', enum: ['passive', 'active', 'unclear'] },
    comparisonEvidence: { type: 'STRING' },
    outcomeMeasure: { type: 'STRING' },
    summaryEn: { type: 'STRING' },
    summaryJa: { type: 'STRING' },
    ja: {
      type: 'OBJECT',
      properties: Object.fromEntries(JA_KEYS.map((k) => [k, { type: 'STRING' }])),
      required: JA_KEYS
    },
    stats: {
      type: 'OBJECT',
      properties: Object.fromEntries(STAT_KEYS_SMD.concat(STAT_KEYS_R, ['direction']).map((k) => [k, { type: 'STRING' }]))
    },
    evidence: { type: 'STRING' }
  },
  required: ['eligible', 'reason', 'country', 'gradeLevel', 'gradeBand', 'design', 'intervention',
             'comparison', 'comparisonType', 'comparisonEvidence', 'outcomeMeasure', 'summaryEn', 'summaryJa', 'ja', 'stats', 'evidence']
};

function extractPrompt(theme, paper, text) {
  const statsGuide = theme.effect === 'r'
    ? [
      'stats.r: the Pearson correlation between the predictor and the outcome for the whole sample, exactly as printed (e.g. "-.34").',
      'stats.nTotal: the sample size for that correlation, exactly as printed.',
      'If only several correlations are reported (e.g. per subscale), use the one for the total/overall scores.'
    ]
    : [
      'Prefer the post-test (or the gain score only if post-test values are not reported) of the primary outcome.',
      'Fill as many as the paper reports, each EXACTLY as printed in the text (same digits and decimals):',
      '  nTreatment, nControl, meanTreatment, meanControl, sdTreatment, sdControl,',
      '  t (independent-samples t for the group difference), F (ANOVA/ANCOVA F with 1 numerator df for the group effect),',
      '  d (Cohen\'s d reported by the authors), g (Hedges\' g reported by the authors).',
      'stats.direction: "treatment_higher", "control_higher", or "unclear" (which group scored higher on the outcome).',
      'If there are several intervention groups, use the one that best matches the intervention and the comparison group that best matches the comparison.'
    ];

  return [
    'You are extracting data for a meta-analysis. The full text below was converted from PDF; tables may be garbled.',
    'Research question: ' + theme.titleEn,
    '',
    'Inclusion criteria:',
    criteria(theme),
    '',
    'eligible: true only if the study meets ALL criteria. reason: one English sentence.',
    'country, gradeLevel (e.g. "Grade 4", "Grades 7-8"), gradeBand (elementary = grades 1-6, middle = grades 7-9, mixed, other),',
    'design (e.g. "randomized controlled trial", "quasi-experimental", "correlational"),',
    'intervention, comparison, outcomeMeasure: short English phrases (max 15 words each).',
    ...(theme.effect === 'r'
      ? ['comparisonType: "unclear" and comparisonEvidence: "" (this is a correlational theme).']
      : [
        'comparisonType: what the COMPARISON group received.',
        '  "passive" = nothing aimed at the same outcome: no treatment, a waitlist, business-as-usual, regular lessons, or the regular curriculum.',
        '  "active"  = a different intervention or teaching approach aimed at the same outcome (e.g. plugged-in coding versus unplugged activities, another teaching method, an attention-placebo activity).',
        '  "unclear" = the paper does not say.',
        'comparisonEvidence: a short VERBATIM quote (max 30 words) from the text that describes what the comparison group received. "" when comparisonType is "unclear".'
      ]),
    'summaryEn: 2 sentences in English describing what was done and found. summaryJa: the same in natural Japanese (です・ます調).',
    'ja: Japanese translations of country, gradeLevel (e.g. "小学4年", "中学1〜2年"), design (e.g. "準実験"), intervention, comparison, outcomeMeasure.',
    '',
    'Statistics (strings; use "" when not reported; never compute or estimate numbers yourself):',
    ...statsGuide,
    'evidence: a short verbatim quote (max 40 words) from the text containing the key numbers.',
    'Leave every stats field "" if the numbers cannot be read reliably.',
    '',
    'Bibliographic record (for reference): ' + paper.title + ' (' + paper.year + '), ' + paper.venue,
    '',
    '=== FULL TEXT ===',
    text
  ].join('\n');
}

// ============================================================
// 数値の照合
// ============================================================

/** 全角数字や記号をそろえる（国内論文の PDF は全角が混ざる） */
function normalizeText(s) {
  return String(s || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[．]/g, '.')
    .replace(/[−–—‒－]/g, '-')
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
}

/** 人数の欄（カンマは桁区切り）。ほかの欄（平均・SD・t・F・d・g・r）のカンマは小数点 */
const COUNT_KEYS = new Set(['nTreatment', 'nControl', 'nTotal']);

/** 全角数字・全角ピリオド・マイナス記号だけをそろえる（桁区切りや小数点のカンマには触れない） */
function basicNormalize(s) {
  return String(s || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[．]/g, '.')
    .replace(/[，]/g, ',')
    .replace(/[−–—‒－]/g, '-');
}

/**
 * 数値の文字列を数にする。小数点がカンマの表記（インドネシア語・ドイツ語・フランス語・ポルトガル語などの論文）も読む。
 * key が人数の欄なら「1,234」は 1234、ほかの欄なら「5,160」は 5.16
 */
function parseNumber(s, key) {
  const t = basicNormalize(s).trim().replace(/\s+/g, '');
  if (COUNT_KEYS.has(key)) {
    const c = t.replace(/(\d)[,.](?=\d{3}(?!\d))/g, '$1');
    return /^-?\d+$/.test(c) ? Number(c) : NaN;
  }
  const d = /^-?\d*,\d+$/.test(t) ? t.replace(',', '.') : t;
  if (!/^-?\d*\.?\d+$/.test(d)) return NaN;
  return Number(d);
}

/**
 * その数字が本文に書かれているか。
 *   ・".45" と "0.45"、符号の有無は同じとみなす
 *   ・小数点は "." でも "," でも同じとみなす（本文が "79,8"、抽出が "79.8" でも、その逆でもよい）
 *   ・4桁以上の整数は、本文が "1,234" や "1 234" と桁区切りされていてもよい
 * 前後に別の数字が続くもの（"15,160" の中の "5,160" など）は一致にしない
 */
function numberInText(value, text) {
  const raw = basicNormalize(value).trim().replace(/^[-+]/, '').replace(/\s+/g, '');
  const m = raw.match(/^(\d*)[.,](\d+)$/);
  const int = raw.match(/^\d+$/);
  if (!m && !int) return false;

  const patterns = [];
  if (m) {
    const [, a, b] = m;
    const heads = a === '' ? ['', '0'] : a === '0' ? ['0', ''] : [a];
    heads.forEach((h) => patterns.push(h + '[.,]' + b));
    // "5,160" は 5160（桁区切り）のこともある
    if (b.length === 3 && a && a.length <= 3) patterns.push(a + '[,. ]?' + b);
  } else {
    patterns.push(raw);
    if (raw.length >= 4) patterns.push(raw.replace(/\B(?=(\d{3})+(?!\d))/g, '[,. ]?'));
  }
  const body = basicNormalize(text);
  return patterns.some((p) => new RegExp('(^|[^\\d.])' + p + '(?!\\d)').test(body));
}

/** 空でない数値欄を本文と照合する。見つからない欄の名前を返す */
function verifyStats(stats, fullText) {
  const missing = [];
  Object.keys(stats || {}).forEach((k) => {
    if (k === 'direction') return;
    const v = String(stats[k] || '').trim();
    if (!v) return;
    if (Number.isNaN(parseNumber(v, k)) || !numberInText(v, fullText)) missing.push(k + '=' + v);
  });
  return missing;
}

/**
 * 引用が本文にあるか。PDF の文字起こしは改行・ハイフン・引用記号が崩れるので、3語（日本語は3文字）の並びの一致率で見る。
 * 数値のように文字列で確かめられない「分類」の根拠を、本文に当たらせるための安全策
 */
function quoteSupported(quote, text, threshold = 0.7) {
  const tokens = (s) => String(s || '').toLowerCase()
    .replace(/-\s*\n\s*/g, '')
    .replace(/([\u3040-\u30ff\u4e00-\u9fff])/g, ' $1 ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  const q = tokens(quote);
  if (q.length < 3) return false;
  const body = tokens(text);
  const grams = new Set();
  for (let i = 0; i + 2 < body.length; i++) grams.add(body[i] + ' ' + body[i + 1] + ' ' + body[i + 2]);
  let hit = 0;
  let total = 0;
  for (let i = 0; i + 2 < q.length; i++) { total++; if (grams.has(q[i] + ' ' + q[i + 1] + ' ' + q[i + 2])) hit++; }
  return total > 0 && hit / total >= threshold;
}

/**
 * 比較条件の種類（passive / active / unclear）。相関のテーマでは使わない。
 * 根拠の引用が本文に見つからない分類は「unclear」に落とし、下位集団分析から外す（全体の統合には残る）
 */
function classifyComparison(theme, raw, fullText) {
  if (theme.effect === 'r') return { comparisonType: 'unclear', comparisonEvidence: '' };
  const quote = String((raw || {}).comparisonEvidence || '').trim();
  let type = ['passive', 'active'].includes((raw || {}).comparisonType) ? raw.comparisonType : 'unclear';
  const out = { comparisonEvidence: quote };
  if (type !== 'unclear' && !quoteSupported(quote, fullText)) {
    out.comparisonNote = '比較の種類（' + type + '）の根拠の引用が本文に見つからないため unclear にした';
    type = 'unclear';
  }
  out.comparisonType = type;
  return out;
}

/** 論文1本からデータを抜き出し、照合結果を付けて返す */
async function extract(theme, paper, fullText) {
  const body = dropReferenceList(fullText).slice(0, config.pdfTextMaxChars);
  const raw = await llm.generateJson(extractPrompt(theme, paper, body), extractSchema);
  const stats = {};
  STAT_KEYS_SMD.concat(STAT_KEYS_R, ['direction']).forEach((k) => {
    stats[k] = String(((raw || {}).stats || {})[k] || '').trim();
  });
  const data = {
    eligible: !!raw.eligible,
    reason: String(raw.reason || ''),
    country: String(raw.country || ''),
    gradeLevel: String(raw.gradeLevel || ''),
    gradeBand: ['elementary', 'middle', 'mixed', 'other'].includes(raw.gradeBand) ? raw.gradeBand : 'other',
    design: String(raw.design || ''),
    intervention: String(raw.intervention || ''),
    comparison: String(raw.comparison || ''),
    outcomeMeasure: String(raw.outcomeMeasure || ''),
    summaryEn: String(raw.summaryEn || ''),
    summaryJa: String(raw.summaryJa || ''),
    evidence: String(raw.evidence || ''),
    ja: Object.fromEntries(JA_KEYS.map((k) => [k, String(((raw || {}).ja || {})[k] || '').trim()])),
    stats,
    model: llm.usedModel()
  };
  data.unverified = verifyStats(stats, fullText);
  Object.assign(data, classifyComparison(theme, raw, fullText));
  return data;
}

module.exports = {
  screen, extract, quoteSupported, classifyComparison, screenPrompt, extractPrompt, criteria,
  verifyStats, numberInText, normalizeText, parseNumber, STAT_KEYS_SMD, STAT_KEYS_R
};
