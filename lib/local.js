/**
 * 手元の Claude Code に言語モデルの仕事をしてもらう（外部の LLM API を使わない）
 *
 * LLM_PRIMARY=local のとき、llm.generateJson は API を呼ばず、依頼をファイルに書いて待つ。
 *   <LOCAL_LLM_DIR>/<番号>.request.json   { prompt, schema }
 *   <LOCAL_LLM_DIR>/<番号>.response.json  Claude Code が書く。JSON の中身だけ
 * 応答は parseJson と同じ規則で読む。プロンプトも検証（数値を本文と照合する等）も API 経由のときと同じ。
 * 番号は 1 から。実行のたびに LOCAL_LLM_DIR を空にしてから始める。
 */
const fs = require('fs');
const path = require('path');

const MODEL = 'claude-sonnet-5-5 (Claude Code, local)';
const REVIEW_MODEL = 'claude-sonnet-5-5';
let counter = 0;

function dir() {
  const d = process.env.LOCAL_LLM_DIR || path.join(__dirname, '..', '.cache', 'local-llm');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generateJson(prompt, schema, parseJson, extra) {
  const d = dir();
  const n = String(++counter).padStart(3, '0');
  const req = path.join(d, n + '.request.json');
  const res = path.join(d, n + '.response.json');
  fs.writeFileSync(req, JSON.stringify({ prompt, schema: schema || null, ...(extra || {}) }, null, 1), 'utf8');
  console.log(`    [local] 依頼 ${n} を書きました。応答を待ちます: ${res}`);
  const limit = Date.now() + 6 * 3600 * 1000;
  while (!fs.existsSync(res)) {
    if (Date.now() > limit) throw new Error('local: 応答が来ないまま 6 時間たちました（' + n + '）');
    await sleep(2000);
  }
  await sleep(300);   // 書き込み途中を読まない
  return parseJson(fs.readFileSync(res, 'utf8'), 'Claude Code (local)');
}

module.exports = { generateJson, MODEL, REVIEW_MODEL, _reset: () => { counter = 0; } };
