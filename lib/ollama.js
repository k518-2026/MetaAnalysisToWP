/**
 * 手元の Ollama（LAN の Mac mini）に内容を作らせる
 *
 * LLM_PRIMARY=ollama のとき、llm.generateJson は Gemini / Claude の API を呼ばず、ここへ依頼する。
 * 出力は JSON スキーマで縛る（Ollama の format）。小さなモデルなので、返ってきた内容は
 * そのまま使わず、Claude Code が確認・修正する（lib/local.js の「下書きつきの依頼」）。
 *
 *   OLLAMA_HOST … 既定は config.ollama.host
 *   OLLAMA_MODEL … 既定は config.ollama.model
 * つながらない・時間切れ・JSON が壊れているときは、他の API に黙って切り替えず、はっきり失敗にする。
 */
const config = require('../config');

function host() {
  return String(process.env.OLLAMA_HOST || config.ollama.host).replace(/\/+$/, '');
}

function model() {
  return String(process.env.OLLAMA_MODEL || config.ollama.model).trim();
}

/** Gemini 形式のスキーマ（型が大文字: OBJECT / STRING …）を、Ollama の JSON スキーマ（小文字）にする */
function toJsonSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  Object.keys(s).forEach((k) => {
    const v = s[k];
    if (k === 'type' && typeof v === 'string') out.type = v.toLowerCase();
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([n, x]) => [n, toJsonSchema(x)]));
    else if (k === 'items') out.items = toJsonSchema(v);
    else out[k] = v;
  });
  return out;
}

/** 入力の長さから num_ctx を決める（日本語は 1 字 ≒ 1.2 トークン、英数は 0.3 トークンで見積もり、余裕と出力の分を足す） */
function contextFor(prompt) {
  const s = String(prompt);
  const cjk = (s.match(/[　-ヿ一-鿿＀-￯]/g) || []).length;
  const est = cjk * 1.2 + (s.length - cjk) * 0.3;
  const need = Math.ceil(est * 1.15) + config.ollama.numPredict + 256;
  return Math.min(131072, Math.max(config.ollama.numCtx, need));
}

async function chat(prompt, schema) {
  const body = {
    model: model(),
    stream: false,
    think: false,
    messages: [{ role: 'user', content: prompt }],
    format: schema ? toJsonSchema(schema) : 'json',
    options: { temperature: config.temperature, num_ctx: contextFor(prompt), num_predict: config.ollama.numPredict }
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), config.ollama.timeoutMs);
  let res;
  try {
    res = await fetch(host() + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
  } catch (e) {
    throw new Error(`Ollama（${host()}）につながりません: ${e.name === 'AbortError' ? '時間切れ' : e.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Ollama のエラー ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const text = String(((json || {}).message || {}).content || '').trim();
  if (!text) throw new Error('Ollama の応答が空です: ' + JSON.stringify(json).slice(0, 300));
  if (json.done_reason === 'length') throw new Error('Ollama の出力が長さの上限（num_predict）で切れました');
  // Ollama は、入力が num_ctx を超えると、エラーを出さずに前を切り捨てる。読み込んだ長さが枠いっぱいなら切れている
  if (Number(json.prompt_eval_count) >= body.options.num_ctx - 16) {
    throw new Error(`Ollama の入力が num_ctx（${body.options.num_ctx}）を超えて切り捨てられた可能性があります（読み込み ${json.prompt_eval_count}）`);
  }
  return text;
}

/** 依頼して JSON を受け取る。壊れた JSON は1回だけやり直す */
async function generateJson(prompt, schema, parseJson) {
  let last;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const text = await chat(prompt, schema);
    try {
      return parseJson(text, 'Ollama');
    } catch (e) {
      last = e;
      console.warn(`    Ollama の応答が JSON ではありません（${attempt}/2）`);
    }
  }
  throw last;
}

module.exports = { generateJson, model, host, toJsonSchema, contextFor };
