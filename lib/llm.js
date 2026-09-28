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
    res = await callGemini(key, models[i], parts, schema);
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
async function generateJson(prompt, schema) {
  const parts = [{ text: prompt }];
  const claude = require('./claude');
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();

  if (!geminiKey && claude.available()) {
    lastModel = config.claude.model;
    return claude.generateJson(prompt);
  }
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
      console.warn('    Gemini が混雑したままなので ' + config.claude.model + ' で書きます。');
      lastModel = config.claude.model;
      return claude.generateJson(prompt);
    }
    throw await httpError('Gemini APIエラー', res);
  }
  const json = await res.json();
  const cand = (json.candidates || [])[0];
  const text = ((cand || {}).content ? (cand.content.parts || []).map((p) => p.text || '').join('') : '').trim();
  if (!text) throw new Error('Gemini の応答が空です: ' + JSON.stringify(json).slice(0, 300));
  return parseJson(text, 'Gemini');
}

module.exports = { generateJson, usedModel, parseJson };
