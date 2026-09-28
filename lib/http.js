/** 通信の共通部分。再試行と、よくある失敗の見分け方（paper-to-zenn/datasci と同じ） */

const USER_AGENT = 'MetaAnalysisToWP/1.0 (+https://github.com/k518-2026/MetaAnalysisToWP)';

// 再試行の待ち時間の基準（test.js が 0 にして速く回す）
const retry = { baseMs: 2000 };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 一時的な失敗（429・5xx・通信断）だけ待って試し直す。
 * shouldRetry を渡すと、応答の中身を見て再試行の可否を決められる。
 */
async function fetchRetry(url, options = {}, { attempts = 3, shouldRetry = null, timeoutMs = 60000 } = {}) {
  let last = null;
  for (let i = 1; i <= attempts; i++) {
    let after = 0;
    try {
      const res = await fetch(url, {
        ...options,
        headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
        signal: AbortSignal.timeout(timeoutMs)
      });
      const retryable = shouldRetry ? await shouldRetry(res) : (res.status === 429 || res.status >= 500);
      if (!retryable || i === attempts) return res;
      last = new Error(`HTTP ${res.status}`);
      // 相手が待ち時間を指定してきたら従う（OpenAlex は混雑時に 30 秒前後を指定する）。長すぎる指定は 90 秒で打ち切る
      after = Math.min(90, Number(res.headers && res.headers.get && res.headers.get('retry-after')) || 0) * 1000;
    } catch (e) {
      if (i === attempts) throw e;
      last = e;
    }
    const wait = retry.baseMs ? Math.max(after, retry.baseMs * i + Math.floor(Math.random() * 1000)) : 0;
    console.log(`  再試行します(${i}/${attempts - 1}, ${wait}ms待機): ${last.message}`);
    await sleep(wait);
  }
  throw last;
}

async function httpError(label, res) {
  const body = await res.text().catch(() => '');
  const e = new Error(`${label}(${res.status}): ${body.slice(0, 300)}`);
  e.status = res.status;
  e.body = body;
  return e;
}

function requireEnv(name) {
  const v = (process.env[name] || '').trim();
  if (!v) throw new Error(`${name} が設定されていません（GitHub の Settings → Secrets → Actions で登録します）`);
  return v;
}

module.exports = { fetchRetry, httpError, requireEnv, sleep, retry, USER_AGENT };
