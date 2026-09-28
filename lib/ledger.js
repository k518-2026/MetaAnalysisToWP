/**
 * 台帳（ledger.json）
 *
 * 何を・いつ・どのテーマで作ったかの記録。テーマの順番決めと、週1回の間隔の判定に使う。
 * 論文が集まらなかったテーマも残す（次の回で後回しにするため）。
 */
const fs = require('fs');
const path = require('path');

const STATUS = { DONE: 'done', FAILED: 'failed' };

/** 日本時間の日付（UTC のままだと朝の実行で前日になる） */
function jstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function load(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { runs: Array.isArray(j.runs) ? j.runs : [] };
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('台帳を読めませんでした（新しく作ります）: ' + e.message);
    return { runs: [] };
  }
}

function save(file, ledger) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2) + '\n', 'utf8');
}

function lastDone(ledger) {
  const done = ledger.runs.filter((r) => r.status === STATUS.DONE);
  return done.length ? done[done.length - 1] : null;
}

/** 前回の報告から何日たったか（無ければ Infinity） */
function daysSinceLast(ledger, today) {
  const last = lastDone(ledger);
  if (!last) return Infinity;
  return Math.round((Date.parse(today) - Date.parse(last.date)) / 86400000);
}

/**
 * 次のテーマの候補を順に返す。
 *   1. 前回と違う分野（数学 ⇄ 情報）を先に
 *   2. まだ扱っていないもの → 扱ったのが古いもの の順
 *   3. 最近失敗したテーマは後ろへ
 */
function themeOrder(themes, ledger) {
  const lastDoneAt = {};
  const lastFailAt = {};
  ledger.runs.forEach((r, i) => {
    if (r.status === STATUS.DONE) lastDoneAt[r.themeId] = i;
    else lastFailAt[r.themeId] = i;
  });
  const last = lastDone(ledger);
  const lastDomain = last ? (themes.find((t) => t.id === last.themeId) || {}).domain : null;

  return themes.map((t, idx) => ({ t, idx })).sort((a, b) => {
    const da = a.t.domain === lastDomain ? 1 : 0;
    const db = b.t.domain === lastDomain ? 1 : 0;
    if (da !== db) return da - db;
    const ua = lastDoneAt[a.t.id] === undefined ? -1 : lastDoneAt[a.t.id];
    const ub = lastDoneAt[b.t.id] === undefined ? -1 : lastDoneAt[b.t.id];
    const fa = (lastFailAt[a.t.id] ?? -1) > ua ? 1 : 0;
    const fb = (lastFailAt[b.t.id] ?? -1) > ub ? 1 : 0;
    if (fa !== fb) return fa - fb;
    if (ua !== ub) return ua - ub;
    return a.idx - b.idx;
  }).map((x) => x.t);
}

module.exports = { load, save, lastDone, daysSinceLast, themeOrder, jstDate, STATUS };
