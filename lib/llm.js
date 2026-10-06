/**
 * 言語モデルの呼び出し（JSON で返させる）
 *
 * Gemini（無料枠）を順に試し、全部混雑していたら時間をおいて巡り直す。
 * それでも駄目で ANTHROPIC_API_KEY があれば Claude に回す（paper-to-zenn/datasci と同じ方針）。
 *
 * 守らせていること（プロンプト側）:
 *   ・URL や文献名を書かせない。文献は番号で指させ、コードが書誌から組み立てる
 *   ・数値はコードが計算したものだけを使わせる
 */
const { fetchRetry, httpError, requireEnv, sleep } = require('./http');
const config = require('../config');

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

let lastModel = '';
const usedModel = () => lastModel;

function isBusy(res) {
  return res.status === 503 || res.status === 429 || res.status >= 500;
}

function callGemini(key, model, parts, schema) {
  const generationConfig = {
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    responseMimeType: 'application/json'
  };
  if (schema) generationConfig.responseSchema = schema;

  return fetchRetry(ENDPOINT + encodeURIComponent(model) + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },   // キーは URL に載せない
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig })
  }, {
    attempts: 2,
    timeoutMs: 240000,
    shouldRetry: async (r) => {
      if (r.ok) return false;
      if (r.status === 429) return !/exceeded your current quota/i.test(await r.clone().text());
      return r.status === 503 || r.status >= 500;
    }
  });
}

async function tryModels(key, parts, schema) {
  const models = config.geminiModels;
  let res = null;
  for (let i = 0; i < models.length; i++) {
    try {
      res = await callGemini(key, models[i], parts, schema);
    } catch (e) {
      // 時間切れ・通信断は混雑と同じに扱う（そのまま投げると Claude に回らずに失敗する）
      res = { ok: false, status: 503, text: async () => e.message, clone() { return this; } };
    }
    lastModel = models[i];
    if (res.ok) break;
    if (![503, 429, 404].includes(res.status) || i === models.length - 1) break;
    console.warn(`    ${models[i]} が使えないため ${models[i + 1]} に切り替えます（${res.status}）`);
  }
  return res;
}

function parseJson(text, who) {
  try {
    return JSON.parse(String(text).trim().replace(/^```json\s*|\s*```$/g, ''));
  } catch (e) {
    throw new Error(who + ' の応答が JSON ではありません: ' + String(text).slice(0, 300));
  }
}

/** 指示文（と本文）を渡して JSON を受け取る */
// Gemini が一度「全モデル混雑」で尽きたら、その実行の残りは Claude で書く。
// 呼ぶたびに 5モデル×巡回×90秒待ちをやり直すと、1回で約5分を失う（2026-09-29 の初回実行で発生）
let geminiDown = false;

function primary() {
  return String(process.env.LLM_PRIMARY || config.llmPrimary || 'gemini').trim().toLowerCase();
}

async function useClaude(prompt, why, schema) {
  const claude = require('./claude');
  if (why) console.warn('    ' + why);
  lastModel = config.claude.model;
  return claude.generateJson(prompt, schema);
}

async function generateJson(prompt, schema) {
  // 外部の LLM API を使わず、手元の Claude Code が応答する（lib/local.js）。API へはフォールバックしない
  if (primary() === 'local') {
    const local = require('./local');
    lastModel = local.MODEL;
    return local.generateJson(prompt, schema, parseJson);
  }
  const parts = [{ text: prompt }];
  const claude = require('./claude');
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();

  if (claude.available() && (primary() === 'claude' || !geminiKey || geminiDown)) return useClaude(prompt, '', schema);

  const key = requireEnv('GEMINI_API_KEY');
  let res = null;
  for (let round = 1; round <= config.geminiRounds; round++) {
    res = await tryModels(key, parts, schema);
    if (res.ok || !isBusy(res)) break;
    if (round === config.geminiRounds) break;
    console.warn(`    全モデルが混雑しています。${Math.round(config.geminiRoundWaitMs / 1000)}秒おいて巡り直します（${round}/${config.geminiRounds}）`);
    await sleep(config.geminiRoundWaitMs);
  }

  if (!res.ok) {
    if (isBusy(res) && claude.available()) {
      geminiDown = true;
      return useClaude(prompt, 'Gemini が混雑したままなので、この実行の残りは ' + config.claude.model + ' で書きます。', schema);
    }
    const e = await httpError('Gemini APIエラー', res);
    if (isBusy(res)) e.message += '（ANTHROPIC_API_KEY が無いので Claude に切り替えられません）';
    throw e;
  }
  const json = await res.json();
  const cand = (json.candidates || [])[0];
  const text = ((cand || {}).content ? (cand.content.parts || []).map((p) => p.text || '').join('') : '').trim();
  if (!text) throw new Error('Gemini の応答が空です: ' + JSON.stringify(json).slice(0, 300));
  return parseJson(text, 'Gemini');
}

module.exports = { generateJson, usedModel, parseJson, _reset: () => { geminiDown = false; try { require('./local')._reset(); } catch (e) { /* noop */ } } };
