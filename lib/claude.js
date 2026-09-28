/**
 * Claude（Gemini が全部混雑したとき、GEMINI_API_KEY が無いとき、LLM_PRIMARY=claude のとき）
 *
 * 鍵は ANTHROPIC_API_KEY。従量課金なので、使った日だけ費用が出る。
 *
 * 返事は構造化出力（output_config.format の json_schema）でスキーマに沿わせる。
 * 指示文だけで JSON を頼むと、前置きや途中切れで JSON として読めないことがある。
 * スキーマは Gemini 用（type が 'OBJECT' などの大文字）を JSON Schema に直して使う。
 */
const config = require('../config');

/** テストが差し替えられるように、client を作る場所を分けてある */
function createClient() {
  const Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic();   // ANTHROPIC_API_KEY を環境から読む
}

function available() {
  return !!(process.env.ANTHROPIC_API_KEY || '').trim();
}

/** Gemini のスキーマ → JSON Schema（構造化出力は additionalProperties: false と全項目 required が要る） */
function toJsonSchema(s) {
  if (!s || typeof s !== 'object') return { type: 'string' };
  const type = String(s.type || 'STRING').toLowerCase();
  if (type === 'object') {
    const props = {};
    Object.keys(s.properties || {}).forEach((k) => { props[k] = toJsonSchema(s.properties[k]); });
    return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
  }
  if (type === 'array') return { type: 'array', items: toJsonSchema(s.items) };
  const out = { type };
  if (Array.isArray(s.enum)) out.enum = s.enum;
  return out;
}

async function generateJson(prompt, schema) {
  const client = module.exports.createClient();
  const params = {
    model: config.claude.model,
    max_tokens: config.claude.maxTokens,
    output_config: { effort: config.claude.effort },
    system: '求められた項目だけを JSON で返してください。前置き・説明・コードブロックの印は付けないこと。',
    messages: [{ role: 'user', content: prompt }]
  };
  if (schema) params.output_config.format = { type: 'json_schema', schema: toJsonSchema(schema) };
  const res = await client.messages.create(params);

  if (res.stop_reason === 'refusal') {
    throw new Error('Claude が応答を断りました（' + ((res.stop_details || {}).category || '理由不明') + '）');
  }
  if (res.stop_reason === 'max_tokens') {
    throw new Error('Claude の応答が長さの上限（max_tokens）で切れました');
  }
  const body = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!body) throw new Error('Claude の応答が空です');
  return require('./llm').parseJson(body, 'Claude');
}

module.exports = { generateJson, createClient, available, toJsonSchema };
