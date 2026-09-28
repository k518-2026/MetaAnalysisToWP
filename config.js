/**
 * 週1回のメタ分析 → WordPress（設定）
 *
 * 毎回テーマを1つ決め、国内外のオープンアクセス論文から5〜10本を集めて効果量を統合し、
 * 日本語の記事と英語の論文（APA 第7版）を作って WordPress へメールで投稿する。
 *
 * 数学教育は小学校・中学校（1〜9年生）に絞る。情報教育は小中学校を優先しつつ高校までを含める。
 */

// ============================================================
// テーマ
// ============================================================
// effect: 'smd' … 介入群と比較群の差（Hedges の g）
//         'r'   … 2変数の相関（Fisher の z で統合し r に戻す）
// query: OpenAlex の題名・要旨検索（AND / OR / NOT と "句"。**カンマは使わない**＝フィルタの区切りになる）
// jstage: J-STAGE の要旨検索に使う日本語キーワード（空白区切りは AND）
// id は台帳に残るので変えない。並び順がおおよその出番の順（数学と情報を交互に取る）

const MATH_POP = 'students in grades 1-9 (primary/elementary school and lower secondary/middle/junior high school, ages about 6-15). ' +
  'Exclude preschool-only, upper secondary-only, university, adult, and teacher/pre-service teacher samples.';
const INFO_POP = 'students in primary or secondary school (K-12). Primary and lower secondary samples are preferred; ' +
  'upper secondary samples are acceptable. Exclude university, adult, and teacher/pre-service teacher samples.';
const MATH_GRADES = '(elementary OR primary OR "middle school" OR "junior high" OR "lower secondary" OR grade OR children OR pupils)';
const K12 = '(elementary OR primary OR "middle school" OR "junior high" OR secondary OR "K-12" OR grade OR children OR pupils)';

const themes = [
  { id: 'math-fraction-instruction', domain: 'math', effect: 'smd',
    titleJa: '分数の指導法は理解を高めるか', titleEn: 'Effects of Fraction Instruction Interventions on Students\' Fraction Understanding',
    query: `(fraction OR fractions) AND (intervention OR instruction OR teaching OR training) AND ${MATH_GRADES}`,
    jstage: ['分数 指導 小学校', '分数 授業 効果'],
    population: MATH_POP,
    intervention: 'an instructional intervention or teaching approach targeting fraction concepts or operations',
    comparison: 'business-as-usual instruction, an alternative instruction, or a no-treatment control group',
    outcome: 'a fraction knowledge test or mathematics achievement test' },

  { id: 'info-unplugged-ct', domain: 'info', effect: 'smd',
    titleJa: 'アンプラグド活動はプログラミング的思考を育てるか', titleEn: 'Effects of Unplugged Activities on Computational Thinking in School Students',
    query: `(unplugged) AND ("computational thinking" OR programming OR "computer science") AND ${K12}`,
    jstage: ['アンプラグド プログラミング', 'アンプラグド 小学校'],
    population: INFO_POP,
    intervention: 'unplugged (computer-free) computer science or computational thinking activities',
    comparison: 'no computational thinking instruction, regular lessons, or plugged (computer-based) activities',
    outcome: 'a computational thinking test or programming concept test' },

  { id: 'math-anxiety-achievement', domain: 'math', effect: 'r',
    titleJa: '算数・数学への不安と学力の関係', titleEn: 'The Relationship Between Mathematics Anxiety and Mathematics Achievement in Primary and Lower Secondary Students',
    query: `("math anxiety" OR "mathematics anxiety" OR "mathematical anxiety") AND (achievement OR performance) AND ${MATH_GRADES}`,
    jstage: ['数学不安 学力', '算数 不安 成績'],
    population: MATH_POP,
    intervention: 'mathematics anxiety measured by a questionnaire (predictor)',
    comparison: 'not applicable (correlational)',
    outcome: 'mathematics achievement or performance measured by a test or grades; report the correlation r' },

  { id: 'info-block-programming-ct', domain: 'info', effect: 'smd',
    titleJa: 'ブロック型プログラミング（Scratch など）の学習効果', titleEn: 'Effects of Block-Based Programming Instruction on Computational Thinking in School Students',
    query: `(Scratch OR "block-based programming" OR "visual programming" OR "block-based coding") AND ("computational thinking" OR "problem solving" OR programming) AND ${K12}`,
    jstage: ['Scratch 小学校', 'ビジュアルプログラミング 授業'],
    population: INFO_POP,
    intervention: 'block-based or visual programming instruction (e.g., Scratch, ScratchJr, Code.org, Blockly)',
    comparison: 'regular lessons, no programming instruction, or text-based/alternative instruction',
    outcome: 'a computational thinking, programming, or problem-solving test' },

  { id: 'math-game-based-learning', domain: 'math', effect: 'smd',
    titleJa: 'ゲームを使った算数・数学学習の効果', titleEn: 'Effects of Game-Based Learning on Mathematics Achievement in Primary and Lower Secondary Students',
    query: `("game-based" OR "educational game" OR "digital game" OR gamification OR "serious game") AND (mathematics OR math OR arithmetic) AND ${MATH_GRADES}`,
    jstage: ['ゲーム 算数 学習', 'ゲーミフィケーション 数学'],
    population: MATH_POP,
    intervention: 'game-based learning, educational (digital or board) games, or gamification in mathematics',
    comparison: 'conventional instruction or non-game practice',
    outcome: 'a mathematics achievement test' },

  { id: 'info-educational-robotics', domain: 'info', effect: 'smd',
    titleJa: 'ロボット教材はプログラミング的思考を育てるか', titleEn: 'Effects of Educational Robotics on Computational Thinking in School Students',
    query: `("educational robotics" OR robot OR robotics OR "LEGO" OR "Bee-Bot") AND ("computational thinking" OR programming OR coding) AND ${K12}`,
    jstage: ['ロボット プログラミング 小学校', 'ロボット教材 授業'],
    population: INFO_POP,
    intervention: 'educational robotics activities (e.g., LEGO robotics, Bee-Bot, micro:bit robots)',
    comparison: 'no robotics, regular lessons, or screen-only programming',
    outcome: 'a computational thinking or programming test' },

  { id: 'math-manipulatives', domain: 'math', effect: 'smd',
    titleJa: '具体物（操作教材）を使った算数・数学指導の効果', titleEn: 'Effects of Concrete and Virtual Manipulatives on Mathematics Learning in Primary and Lower Secondary Students',
    query: `(manipulatives OR "concrete materials" OR "virtual manipulatives" OR "hands-on") AND (mathematics OR math OR arithmetic OR geometry) AND ${MATH_GRADES}`,
    jstage: ['具体物 算数', '操作活動 算数 効果'],
    population: MATH_POP,
    intervention: 'instruction using concrete or virtual manipulatives',
    comparison: 'instruction without manipulatives (e.g., symbolic or textbook-only instruction)',
    outcome: 'a mathematics achievement test' },

  { id: 'info-programming-math', domain: 'info', effect: 'smd',
    titleJa: 'プログラミング学習は算数・数学の学力を高めるか', titleEn: 'Effects of Programming Instruction on Mathematics Achievement in School Students',
    query: `(programming OR coding OR Scratch) AND (mathematics OR math OR geometry OR arithmetic) AND (achievement OR learning OR performance) AND ${K12}`,
    jstage: ['プログラミング 算数 学習効果', 'プログラミング 数学 授業'],
    population: INFO_POP,
    intervention: 'programming or coding activities integrated into or alongside mathematics',
    comparison: 'mathematics instruction without programming',
    outcome: 'a mathematics achievement test' },

  { id: 'math-word-problem-strategy', domain: 'math', effect: 'smd',
    titleJa: '文章題の解決方略（スキーマ指導など）の効果', titleEn: 'Effects of Word-Problem Solving Strategy Instruction in Primary and Lower Secondary Mathematics',
    query: `("word problem" OR "word problems" OR "story problems") AND (instruction OR intervention OR strategy OR schema) AND ${MATH_GRADES}`,
    jstage: ['文章題 指導 効果', '文章題 小学校 方略'],
    population: MATH_POP,
    intervention: 'instruction in word-problem solving strategies (e.g., schema-based instruction, diagrams, heuristics)',
    comparison: 'business-as-usual instruction or an alternative instruction',
    outcome: 'a word-problem solving test' },

  { id: 'info-pair-programming', domain: 'info', effect: 'smd',
    titleJa: 'ペアプログラミング・協働的プログラミングの効果', titleEn: 'Effects of Pair and Collaborative Programming on School Students\' Programming Learning',
    query: `("pair programming" OR "collaborative programming" OR "collaborative coding") AND ${K12}`,
    jstage: ['ペアプログラミング', '協働 プログラミング 授業'],
    population: INFO_POP,
    intervention: 'pair programming or structured collaborative programming',
    comparison: 'individual (solo) programming',
    outcome: 'a programming or computational thinking test' },

  { id: 'math-computer-assisted-practice', domain: 'math', effect: 'smd',
    titleJa: 'コンピュータ支援・適応型の算数練習の効果', titleEn: 'Effects of Computer-Assisted and Adaptive Mathematics Practice in Primary and Lower Secondary Students',
    query: `("computer-assisted" OR adaptive OR "intelligent tutoring" OR "educational software" OR tablet OR app) AND (mathematics OR math OR arithmetic) AND (intervention OR program OR practice) AND ${MATH_GRADES}`,
    jstage: ['タブレット 算数 効果', 'デジタルドリル 算数'],
    population: MATH_POP,
    intervention: 'computer-assisted, adaptive, or tablet-based mathematics practice or tutoring',
    comparison: 'paper-based practice or regular instruction',
    outcome: 'a mathematics achievement test' },

  { id: 'info-ct-math-correlation', domain: 'info', effect: 'r',
    titleJa: 'プログラミング的思考と算数・数学の学力の関係', titleEn: 'The Relationship Between Computational Thinking and Mathematics Achievement in School Students',
    query: `("computational thinking") AND (mathematics OR math OR mathematical) AND (correlation OR relationship OR predict OR association) AND ${K12}`,
    jstage: ['プログラミング的思考 算数', '計算論的思考 数学'],
    population: INFO_POP,
    intervention: 'computational thinking skill measured by a test (predictor)',
    comparison: 'not applicable (correlational)',
    outcome: 'mathematics achievement measured by a test or grades; report the correlation r' },

  { id: 'math-flipped-classroom', domain: 'math', effect: 'smd',
    titleJa: '反転授業は算数・数学の学力を高めるか', titleEn: 'Effects of the Flipped Classroom on Mathematics Achievement in Primary and Lower Secondary Students',
    query: `("flipped classroom" OR "flipped learning" OR "inverted classroom") AND (mathematics OR math) AND ${MATH_GRADES}`,
    jstage: ['反転授業 数学', '反転授業 算数'],
    population: MATH_POP,
    intervention: 'flipped classroom instruction in mathematics',
    comparison: 'traditional (lecture-based) instruction',
    outcome: 'a mathematics achievement test' },

  { id: 'info-digital-literacy', domain: 'info', effect: 'smd',
    titleJa: '情報活用能力・デジタルリテラシーの指導効果', titleEn: 'Effects of Digital and Information Literacy Instruction in School Students',
    query: `("digital literacy" OR "information literacy" OR "media literacy" OR "online safety" OR "digital citizenship") AND (intervention OR instruction OR program OR training) AND ${K12}`,
    jstage: ['情報活用能力 授業 効果', '情報モラル 指導 効果'],
    population: INFO_POP,
    intervention: 'instruction or a program in digital, information, or media literacy, or digital citizenship',
    comparison: 'no such instruction or regular lessons',
    outcome: 'a digital/information/media literacy test or skill measure' },

  { id: 'math-cooperative-learning', domain: 'math', effect: 'smd',
    titleJa: '協同学習・ピアチュータリングの算数・数学への効果', titleEn: 'Effects of Cooperative Learning and Peer Tutoring on Mathematics Achievement in Primary and Lower Secondary Students',
    query: `("cooperative learning" OR "collaborative learning" OR "peer tutoring" OR "peer-assisted" OR jigsaw) AND (mathematics OR math) AND ${MATH_GRADES}`,
    jstage: ['協同学習 算数', 'ジグソー 数学 授業'],
    population: MATH_POP,
    intervention: 'cooperative learning, collaborative group work, or peer tutoring in mathematics',
    comparison: 'individual or teacher-centered instruction',
    outcome: 'a mathematics achievement test' },

  { id: 'math-metacognitive-strategy', domain: 'math', effect: 'smd',
    titleJa: 'メタ認知方略の指導は算数・数学の力を高めるか', titleEn: 'Effects of Metacognitive Strategy Instruction on Mathematics Achievement in Primary and Lower Secondary Students',
    query: `(metacognitive OR metacognition OR "self-regulated learning" OR "self-regulation") AND (mathematics OR math OR "problem solving") AND (instruction OR intervention OR training) AND ${MATH_GRADES}`,
    jstage: ['メタ認知 算数', 'メタ認知 数学 指導'],
    population: MATH_POP,
    intervention: 'instruction in metacognitive or self-regulated learning strategies for mathematics',
    comparison: 'regular instruction without explicit metacognitive training',
    outcome: 'a mathematics achievement or problem-solving test' },

  { id: 'math-dynamic-geometry', domain: 'math', effect: 'smd',
    titleJa: '動的幾何ソフト（GeoGebra など）の学習効果', titleEn: 'Effects of Dynamic Geometry Software on Geometry Learning in Lower Secondary Students',
    query: `(GeoGebra OR "dynamic geometry" OR "Cabri" OR "Geometer's Sketchpad") AND (achievement OR learning OR performance) AND ${MATH_GRADES}`,
    jstage: ['GeoGebra 授業', '動的幾何 中学校'],
    population: MATH_POP,
    intervention: 'instruction using dynamic geometry software',
    comparison: 'traditional instruction without dynamic geometry software',
    outcome: 'a geometry or mathematics achievement test' },

  { id: 'math-self-efficacy-achievement', domain: 'math', effect: 'r',
    titleJa: '算数・数学の自己効力感と学力の関係', titleEn: 'The Relationship Between Mathematics Self-Efficacy and Mathematics Achievement in Primary and Lower Secondary Students',
    query: `("self-efficacy" OR "self-concept") AND (mathematics OR math) AND (achievement OR performance) AND ${MATH_GRADES}`,
    jstage: ['自己効力感 数学 成績', '算数 自己効力感'],
    population: MATH_POP,
    intervention: 'mathematics self-efficacy or self-concept measured by a questionnaire (predictor)',
    comparison: 'not applicable (correlational)',
    outcome: 'mathematics achievement measured by a test or grades; report the correlation r' },

  { id: 'math-early-numeracy', domain: 'math', effect: 'smd',
    titleJa: '低学年の数量感覚（数の概念）を育てる指導の効果', titleEn: 'Effects of Early Numeracy Interventions for Children in the First Grades of Primary School',
    query: `("early numeracy" OR "number sense" OR "numerical magnitude" OR "number line") AND (intervention OR training OR instruction) AND (primary OR elementary OR "first grade" OR "grade 1" OR kindergarten OR children)`,
    jstage: ['数感覚 小学校', '数概念 低学年 指導'],
    population: MATH_POP + ' Samples mixing kindergarten and grades 1-2 are acceptable.',
    intervention: 'an early numeracy, number sense, or number line intervention',
    comparison: 'business-as-usual instruction or an active control activity',
    outcome: 'a numeracy or mathematics achievement test' }
];

module.exports = {
  themes,

  // --- 著者（論文と記事の署名。日本語版と記事は日本語名、英語版は英語名）---
  author: {
    nameJa: '教育情報分析研究会',
    nameEn: 'Society for Educational Data Analysis (SEDA)',
    shortEn: 'SEDA'
  },

  // --- 間隔（週1回）---
  // 前回の報告から何日たてば次を作ってよいか。予定より1日早く動いても作れるよう 6 にしてある
  minDaysBetweenReports: 6,
  // 1回の実行で試すテーマの数（論文が集まらなければ次のテーマへ）
  maxThemesPerRun: 3,

  // --- 検索（OpenAlex）---
  openalex: {
    // 3304 Education / 3204 Developmental and Educational Psychology。テーマごとに theme.subfields で上書きできる
    subfields: ['3304', '3204'],
    fromYear: 2012,
    perPage: 50,
    pages: 3,
    // true にすると全体が OA の雑誌（ゴールド OA）だけにする。false はハイブリッド誌の OA 論文も含める
    openJournalsOnly: false,
    languages: ['en']
  },

  // --- 検索（J-STAGE・国内論文）---
  jstage: {
    enabled: true,
    fromYear: 2012,
    count: 50,
    maxPageFetch: 30,       // 要旨と PDF の URL を取るために開く記事ページの上限
    pageIntervalMs: 1500
  },

  // --- 選別と採録 ---
  screening: {
    batchSize: 20,
    maxCandidates: 150,     // 要旨で選別する候補の上限
    abstractMaxChars: 1500
  },
  studies: {
    min: 5,                 // 効果量が計算できた研究がこれ未満なら、そのテーマはあきらめる
    max: 10,                // これだけ集まったら打ち切る
    maxFullTexts: 30        // 本文 PDF を読みに行く上限（1テーマあたり）
  },
  // 効果量の妥当な範囲。外れたものは抽出の誤りとみなして統合から外す
  plausible: { maxAbsG: 3.5, maxAbsR: 0.95, minN: 10 },

  // --- 本文 PDF ---
  pdfMaxBytes: 40 * 1024 * 1024,
  pdfTextMinChars: 3000,
  pdfTextMaxChars: 90000,   // 抽出に渡す上限（参考文献リストは先に落とす）

  // --- Gemini（主）と Claude（Gemini が全部混雑したときの逃げ道）---
  // 'claude' にすると最初から Claude で書く（従量課金）。環境変数 LLM_PRIMARY が優先（Actions の手動実行で選べる）
  llmPrimary: 'gemini',
  geminiModels: ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite'],
  geminiRounds: 2,          // Claude の鍵があれば、2巡しても駄目な時点で Claude に切り替える
  geminiRoundWaitMs: 90 * 1000,
  temperature: 0.2,
  maxOutputTokens: 16384,
  claude: {
    model: 'claude-sonnet-5',
    maxTokens: 16000,
    effort: 'medium'
  },

  // --- 公開 ---
  repo: {
    owner: 'k518-2026',
    name: 'MetaAnalysisToWP',
    branch: 'main'
  },

  // --- WordPress（メール投稿）---
  // 鍵は WP_POST_EMAIL / SMTP_USER / SMTP_PASSWORD。送るのは日本語の記事だけで、
  // 論文（日本語版・英語版の PDF）へはリポジトリの URL でリンクする
  wordpress: {
    senderName: '教育情報分析研究会',
    titlePrefix: '【メタ分析】',
    category: '教育メタ分析',
    tags: 'メタ分析,算数・数学教育,情報教育,教育研究',
    draft: false,
    publicize: false
  },

  // --- PDF（Chrome で HTML から作る）---
  // GitHub Actions の ubuntu-latest には google-chrome が入っている。手元の Windows では Edge を使う。
  // CHROME_PATH で上書きできる
  chromeCandidates: [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ],

  paths: {
    reports: 'reports',
    ledger: 'ledger.json'
  }
};
