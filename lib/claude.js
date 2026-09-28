/**
 * Claude（Gemini が全部混雑したとき、または GEMINI_API_KEY が無いときの逃げ道）
 *
 * 鍵は ANTHROPIC_API_KEY。従量課金なので、使った日だけ費用が出る。
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

async function generateJson(prompt) {
  const client = module.exports.createClient();
  const res = await client.messages.create({
    model: config.claude.model,
    max_tokens: config.claude.maxTokens,
    output_config: { effort: config.claude.effort },
    system: '求められた項目だけを JSON で返してください。前置き・説明・コードブロックの印は付けないこと。',
    messages: [{ role: 'user', content: prompt }]
  });

  if (res.stop_reason === 'refusal') {
    throw new Error('Claude が応答を断りました（' + ((res.stop_details || {}).category || '理由不明') + '）');
  }
  const body = (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!body) throw new Error('Claude の応答が空です');
  return require('./llm').parseJson(body, 'Claude');
}

module.exports = { generateJson, createClient, available };
