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
 * これまでに記事にしたテーマ（同じテーマを二度扱わないため。ユーザー指示 2026-09-29）
 * 台帳の「done」に加えて、reports/ のフォルダ名（YYYY-MM-DD-<テーマ id>）も見る。
 * 台帳が壊れたり書き換えられたりしても、過去の記事があれば重複しない
 */
function usedThemes(ledger, reportsDir) {
  const used = new Set(ledger.runs.filter((r) => r.status === STATUS.DONE).map((r) => r.themeId));
  try {
    fs.readdirSync(reportsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}-/.test(d.name))
      .forEach((d) => used.add(d.name.slice(11)));
  } catch { /* reports/ がまだ無い */ }
  return used;
}

/**
 * 次のテーマの候補を順に返す（**記事にしたテーマは入れない**）。
 *   1. 分野（数学 ⇄ 情報）を交互に並べる。先頭は前回と違う分野
 *      （片方の分野で論文が集まらなくても、もう片方を同じ実行で試せる。2026-10-04 に情報の3テーマが続けて
 *       集まらず、その週の記事が出なかった）
 *   2. 同じ分野の中では、最近失敗したテーマを後ろへ（論文が集まらなかったもの）
 *   3. 同点なら config.js の並び順
 */
function themeOrder(themes, ledger, used = usedThemes(ledger, '')) {
  const lastFailAt = {};
  ledger.runs.forEach((r, i) => { if (r.status !== STATUS.DONE) lastFailAt[r.themeId] = i; });
  const last = lastDone(ledger);
  const lastDomain = last ? (themes.find((t) => t.id === last.themeId) || {}).domain : null;

  const byDomain = {};
  themes.filter((t) => !used.has(t.id)).map((t, idx) => ({ t, idx })).sort((a, b) => {
    const fa = lastFailAt[a.t.id] ?? -1;
    const fb = lastFailAt[b.t.id] ?? -1;
    return fa !== fb ? fa - fb : a.idx - b.idx;
  }).forEach((x) => { (byDomain[x.t.domain] = byDomain[x.t.domain] || []).push(x.t); });

  const domains = Object.keys(byDomain);
  if (!domains.length) return [];   // 全部使い切った（run.js が「テーマを足して」と案内する）
  // 先頭の分野: 前回と違う分野。初回は config.js の先頭のテーマの分野
  const first = domains.find((d) => d !== lastDomain) || domains[0];
  const order = [first].concat(domains.filter((d) => d !== first));
  const out = [];
  for (let i = 0; order.some((d) => i < byDomain[d].length); i++) {
    order.forEach((d) => { if (i < byDomain[d].length) out.push(byDomain[d][i]); });
  }
  return out;
}

module.exports = { load, save, lastDone, daysSinceLast, themeOrder, usedThemes, jstDate, STATUS };
