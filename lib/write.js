/**
 * 文章を書かせる部分（言語モデル）
 *
 *   1. 英語版の地の文（はじめに・考察・限界・まとめ・Abstract の前後）
 *   2. 1 を日本語に訳す（日本語版と英語版を「同じ内容」にするため、別々に書かせない）
 *   3. ブログ記事（日本語）
 *
 * 方法と結果の節、表、数値はコードが書く。モデルに渡すのは計算済みの数値だけで、
 * 書かれた文章に渡していない小数が出てきたら警告として残す。
 * 文献は [S1] の形で指させ、引用の形はコード（cite.js。日本語版は JSET、英語版は IEEE）が作る。
 */
const llm = require('./llm');

const S = (props, req) => ({ type: 'OBJECT', properties: props, required: req || Object.keys(props) });
const STR = { type: 'STRING' };
const ARR = { type: 'ARRAY', items: STR };

const paperSchema = S({
  background: STR, conclusionAbstract: STR,
  introduction: ARR, discussion: ARR, limitations: ARR, conclusion: ARR, keywords: ARR
});

const RULES = [
  'Rules:',
  '- Use ONLY the facts and numbers given below. Do not invent studies, numbers, authors, or references.',
  '- Cite the included studies only with their IDs in square brackets, e.g. [S1] or [S2, S5]. Never write author names, years, titles, or URLs.',
  '- Do not cite any literature other than the included studies.',
  '- Do not overstate: the number of studies is small and the data were extracted automatically.'
];

function paperPrompt(facts) {
  return [
    'You are writing parts of a journal article (a meta-analysis) in academic English for an educational technology journal.',
    'The Method and Results sections, tables, and figures are written separately by software; you write the parts below.',
    'The Abstract must stay within 150 words in total, and software adds about 60 words of method and results.',
    '',
    ...RULES,
    '',
    'Write:',
    '- background: ONE sentence (max 30 words) for the start of the Abstract (why the question matters). No citations.',
    '- conclusionAbstract: ONE sentence (max 30 words) for the end of the Abstract (what the results mean for primary and lower secondary education). No citations.',
    '- introduction: 3-4 paragraphs. Explain the educational context (primary and lower secondary schools), what the intervention or predictor is,',
    '  why a quantitative synthesis is useful, and end with the purpose and research question(s) of this meta-analysis. You may cite [S#] when describing what the included studies examined.',
    '- discussion: 3-5 paragraphs. Interpret the overall effect and its magnitude, heterogeneity, subgroup (school level; passive versus active comparison) and sensitivity results (only those given),',
    '  noting that subgroup differences are exploratory and based on few studies, and never stating causes for them as facts,',
    '  referring to the figure and tables where relevant, written exactly as "Table 1" (overview of the studies), "Table 2" (interventions and outcomes),',
    '  "Fig. 1" (forest plot), and "Table 3" (pooled estimates), e.g. "... varied widely across studies (Fig. 1).",',
    '  compare the included studies [S#], and give practical implications for teachers of grades 1-9.',
    '- limitations: 1-2 paragraphs specific to this synthesis (small number of studies, designs, measures, samples).',
    '- conclusion: 1 paragraph.',
    '- keywords: 4-5 keywords (the software adds "meta-analysis").',
    '',
    'Facts (JSON):',
    JSON.stringify(facts, null, 1)
  ].join('\n');
}

async function writePaper(facts) {
  return normalizePaper(await llm.generateJson(paperPrompt(facts), paperSchema));
}

function normalizePaper(raw) {
  const arr = (x) => (Array.isArray(x) ? x : [x]).map((s) => String(s || '').trim()).filter(Boolean);
  return {
    background: String(raw.background || '').trim(),
    conclusionAbstract: String(raw.conclusionAbstract || '').trim(),
    introduction: arr(raw.introduction),
    discussion: arr(raw.discussion),
    limitations: arr(raw.limitations),
    conclusion: arr(raw.conclusion),
    keywords: arr(raw.keywords).slice(0, 6)
  };
}

function translatePrompt(en) {
  return [
    '次の JSON は英語の学術論文（メタ分析）の一部です。すべての文字列を、学術論文にふさわしい自然な日本語（である調）に訳してください。',
    '・JSON の構造（キーと配列の要素数）はそのまま保つ',
    '・[S1] や [S2, S5] のような角括弧の記号は、そのままの形で同じ位置に残す（引用はあとでソフトが整える）',
    '・内容を足したり省いたりしない。数値はそのまま',
    '・句読点は「，」と「．」を使う（日本教育工学会論文誌の書式）',
    '・図表の参照は「Fig. 1」→「図1」，「Table 2」→「表2」のように番号を変えずに訳す',
    '・background と conclusionAbstract はそれぞれ80字以内（抄録全体を400字以内に収めるため）',
    '・専門用語は日本の教育研究で一般的な訳語を使い、初出で必要なら英語を括弧で添える（例: 効果量（effect size））',
    '・keywords は日本語のキーワードにする（英語と同じ数・同じ順）',
    '・criteria（研究の適格基準）は，論文の方法の節にそのまま埋め込める簡潔な日本語の名詞句にする（例: population →「1〜9年生（小学校・中学校）の児童生徒．幼児のみ，高校生のみ，大学生，教員の標本は除く」）',
    '',
    JSON.stringify(en, null, 1)
  ].join('\n');
}

const CRITERIA_KEYS = ['population', 'intervention', 'comparison', 'outcome'];
const translateSchema = {
  ...paperSchema,
  properties: { ...paperSchema.properties, criteria: S(Object.fromEntries(CRITERIA_KEYS.map((k) => [k, STR]))) }
};

/**
 * en に criteria（テーマの適格基準。英語）を付けて渡すと、日本語版の方法の節に使う訳も返す
 */
async function translatePaper(en) {
  const raw = await llm.generateJson(translatePrompt(en), en.criteria ? translateSchema : paperSchema);
  const ja = normalizePaper(raw);
  if (en.criteria) {
    ja.criteria = Object.fromEntries(CRITERIA_KEYS.map((k) => [k, String(((raw || {}).criteria || {})[k] || '').trim()]));
  }
  // 段落の数が違うと両言語で内容がずれる。足りなければ警告を返す
  const mismatch = ['introduction', 'discussion', 'limitations', 'conclusion']
    .filter((k) => ja[k].length !== en[k].length);
  return { ja, mismatch };
}

const articleSchema = S({
  lead: STR, question: STR, reading: ARR, hints: ARR, cautions: ARR, sns: STR
});

function articlePrompt(facts) {
  return [
    'あなたは教育研究に詳しいライターです。小学校・中学校の先生や教育に関心のある保護者向けに、',
    '下のメタ分析の結果を紹介するブログ記事の文章を日本語（です・ます調）で書いてください。',
    '',
    '守ること:',
    '・下の事実と数値だけを使う。研究・数値・著者・文献を作らない',
    '・個々の研究に触れるときは [S1] のような番号だけを書く（著者名・年・題名・URL は書かない）',
    '・効果を大げさに言わない。研究数が少なく、データは自動で抽出したものである',
    '・統計の用語は、使うなら一言で意味を添える（例: 効果量 g は「平均の差を標準偏差で割った値」）',
    '',
    '書くもの:',
    '・lead: 記事の冒頭。120〜200字。何を調べ、何がわかったか',
    '・question: この分析の問いと、なぜ先生にとって大事か。150〜250字',
    '・reading: 結果の読み解き。2〜3段落、各150〜250字。全体の効果、ばらつき（異質性）、学年別や比較の種類別（受動的／能動的）の結果（あれば。探索的で研究数が少ないことを添える）',
    '・hints: 小学校・中学校の授業へのヒント。2〜4項目、各60〜120字（結果から言える範囲で）',
    '・cautions: 結果を読むときの注意。2〜3項目、各60〜120字',
    '・sns: SNS 用の紹介文。100字以内',
    '',
    '事実（JSON）:',
    JSON.stringify(facts, null, 1)
  ].join('\n');
}

async function writeArticle(facts) {
  const raw = await llm.generateJson(articlePrompt(facts), articleSchema);
  const arr = (x) => (Array.isArray(x) ? x : [x]).map((s) => String(s || '').trim()).filter(Boolean);
  return {
    lead: String(raw.lead || '').trim(),
    question: String(raw.question || '').trim(),
    reading: arr(raw.reading),
    hints: arr(raw.hints),
    cautions: arr(raw.cautions),
    sns: String(raw.sns || '').trim()
  };
}

/**
 * モデルが書いた文章に、渡していない小数が出てこないか調べる。
 * allowedText には渡した事実（JSON 文字列）を入れる。見つかった数を返す
 */
function unknownNumbers(texts, allowedText) {
  const allowed = new Set();
  String(allowedText).replace(/-?\d*\.\d+/g, (m) => {
    const v = m.replace(/^-/, '');
    allowed.add(v);
    allowed.add(v.replace(/^0\./, '.'));
    allowed.add(v.startsWith('.') ? '0' + v : v);
    return m;
  });
  const bad = new Set();
  [].concat(texts).join('\n').replace(/[−-]?\d*\.\d+/g, (m) => {
    const v = m.replace(/^[−-]/, '');
    if (!allowed.has(v)) bad.add(m);
    return m;
  });
  return [...bad];
}

module.exports = { writePaper, translatePaper, writeArticle, unknownNumbers, paperPrompt, articlePrompt, translatePrompt, paperSchema, translateSchema, articleSchema };
