/**
 * 効果量の計算とメタ分析（すべてコードで計算する。言語モデルには計算させない）
 *
 * 効果量:
 *   smd … Hedges の g（平均・SD・人数 → t と人数 → F(1,·) と人数 → 報告された d / g の順に使う）
 *   r   … Fisher の z に変換して統合し、r に戻して報告する
 * 統合: ランダム効果モデル。τ² は DerSimonian–Laird 法、信頼区間は Hartung–Knapp–Sidik–Jonkman 法
 *       （研究数が少ないとき DL の正規近似は区間が狭すぎるため）。固定効果の推定値も併記する
 * 異質性: Q・I²・τ²、予測区間（k ≥ 3）
 * 感度分析: 1研究ずつ除いた推定値。出版バイアス: Egger 検定（k ≥ 10 のときだけ）
 */
const stats = require('./stats');
const config = require('../config');
const { parseNumber } = require('./review');

// ============================================================
// 研究ごとの効果量
// ============================================================

function hedgesJ(df) {
  return 1 - 3 / (4 * df - 1);
}

/**
 * 抽出した数値から効果量を計算する。
 * 返り値: { yi, vi, n, method } または { error }
 */
function computeEffect(effectType, s) {
  const num = (k) => parseNumber(s[k], k);   // 欄の種類で、カンマを桁区切りと読むか小数点と読むかを決める
  const ok = (x) => Number.isFinite(x);

  if (effectType === 'r') {
    const r = num('r');
    const n = num('nTotal');
    if (!ok(r) || !ok(n)) return { error: 'r と N がそろっていない' };
    if (Math.abs(r) >= 1) return { error: 'r が範囲外' };
    if (n <= 3) return { error: 'N が小さすぎる' };
    return { yi: Math.atanh(r), vi: 1 / (n - 3), n, method: 'Pearson r', display: r };
  }

  const n1 = num('nTreatment');
  const n2 = num('nControl');
  if (!ok(n1) || !ok(n2) || n1 < 2 || n2 < 2) return { error: '群ごとの人数がそろっていない' };
  const df = n1 + n2 - 2;
  const J = hedgesJ(df);
  const sign = s.direction === 'control_higher' ? -1 : 1;
  let d = NaN;
  let method = '';

  const m1 = num('meanTreatment'); const m2 = num('meanControl');
  const sd1 = num('sdTreatment'); const sd2 = num('sdControl');
  if ([m1, m2, sd1, sd2].every(ok) && sd1 > 0 && sd2 > 0) {
    const sp = Math.sqrt(((n1 - 1) * sd1 * sd1 + (n2 - 1) * sd2 * sd2) / df);
    d = (m1 - m2) / sp;
    method = 'means and SDs';
  } else if (ok(num('t'))) {
    if (s.direction === 'unclear' || !s.direction) return { error: 't の向きが不明' };
    d = sign * Math.abs(num('t')) * Math.sqrt(1 / n1 + 1 / n2);
    method = 't statistic';
  } else if (ok(num('F'))) {
    if (s.direction === 'unclear' || !s.direction) return { error: 'F の向きが不明' };
    d = sign * Math.sqrt(Math.abs(num('F'))) * Math.sqrt(1 / n1 + 1 / n2);
    method = 'F statistic (1 df)';
  } else if (ok(num('g'))) {
    d = num('g') / J;
    method = 'reported g';
  } else if (ok(num('d'))) {
    d = num('d');
    method = 'reported d';
  } else {
    return { error: '効果量を計算できる統計量がない' };
  }
  // 報告された d / g は符号が省かれることがある。向きがわかれば合わせる
  if (/reported/.test(method) && s.direction && s.direction !== 'unclear') d = sign * Math.abs(d);

  const g = J * d;
  const vd = (n1 + n2) / (n1 * n2) + d * d / (2 * (n1 + n2));
  return { yi: g, vi: J * J * vd, n: n1 + n2, method, display: g };
}

/** 効果量が現実的な範囲か */
function plausible(effectType, eff) {
  if (eff.n < config.plausible.minN) return '人数が少なすぎる';
  if (effectType === 'r') return Math.abs(eff.display) > config.plausible.maxAbsR ? 'r が大きすぎる' : '';
  return Math.abs(eff.yi) > config.plausible.maxAbsG ? 'g が大きすぎる（抽出の誤りの疑い）' : '';
}

// ============================================================
// 統合
// ============================================================

/** studies: [{ yi, vi }] */
function pool(studies) {
  const k = studies.length;
  if (!k) return null;
  const w = studies.map((s) => 1 / s.vi);
  const sw = w.reduce((a, b) => a + b, 0);
  const fe = studies.reduce((a, s, i) => a + w[i] * s.yi, 0) / sw;
  const Q = studies.reduce((a, s, i) => a + w[i] * (s.yi - fe) ** 2, 0);
  const df = k - 1;
  const C = sw - w.reduce((a, b) => a + b * b, 0) / sw;
  const tau2 = k > 1 ? Math.max(0, (Q - df) / C) : 0;

  const ws = studies.map((s) => 1 / (s.vi + tau2));
  const sws = ws.reduce((a, b) => a + b, 0);
  const est = studies.reduce((a, s, i) => a + ws[i] * s.yi, 0) / sws;
  const seDL = Math.sqrt(1 / sws);

  // Hartung–Knapp
  let se = seDL;
  let crit = 1.959963984540054;
  let test = est / seDL;
  let p = stats.pFromZ(test);
  if (k > 1) {
    const q = studies.reduce((a, s, i) => a + ws[i] * (s.yi - est) ** 2, 0) / df;
    se = Math.sqrt(Math.max(q, 1e-12) / sws);   // HK の分散が DL を下回ることもそのまま使う（標準的な定義）
    crit = stats.tQuantile(0.975, df);
    test = est / se;
    p = stats.pFromT(test, df);
  }

  let pi = null;
  if (k >= 3) {
    const tpi = stats.tQuantile(0.975, k - 2);
    const spi = Math.sqrt(tau2 + seDL * seDL);
    pi = [est - tpi * spi, est + tpi * spi];
  }

  return {
    k,
    est, se, ci: [est - crit * se, est + crit * se], test, p, df,
    fixed: { est: fe, se: Math.sqrt(1 / sw) },
    Q, pQ: k > 1 ? stats.chiSquareSf(Q, df) : NaN,
    I2: k > 1 && Q > 0 ? Math.max(0, (Q - df) / Q) * 100 : 0,
    tau2,
    pi,
    weights: ws.map((x) => x / sws * 100)
  };
}

/** Egger の回帰（標準化効果 ~ 精度）。切片の t 検定 */
function egger(studies) {
  const k = studies.length;
  if (k < 10) return null;
  const x = studies.map((s) => 1 / Math.sqrt(s.vi));
  const y = studies.map((s) => s.yi / Math.sqrt(s.vi));
  const mx = x.reduce((a, b) => a + b, 0) / k;
  const my = y.reduce((a, b) => a + b, 0) / k;
  const sxx = x.reduce((a, v) => a + (v - mx) ** 2, 0);
  const sxy = x.reduce((a, v, i) => a + (v - mx) * (y[i] - my), 0);
  const b1 = sxy / sxx;
  const b0 = my - b1 * mx;
  const rss = y.reduce((a, v, i) => a + (v - b0 - b1 * x[i]) ** 2, 0);
  const s2 = rss / (k - 2);
  const se0 = Math.sqrt(s2 * (1 / k + mx * mx / sxx));
  const t = b0 / se0;
  return { intercept: b0, se: se0, t, df: k - 2, p: stats.pFromT(t, k - 2) };
}

/** 学年段階ごとの統合と、段階間の差の Q 検定（各段階 2 研究以上のときだけ） */
function subgroups(studies) {
  const groups = {};
  studies.forEach((s) => { (groups[s.gradeBand] = groups[s.gradeBand] || []).push(s); });
  const usable = Object.keys(groups).filter((g) => groups[g].length >= 2);
  if (usable.length < 2) return null;
  const res = usable.map((g) => ({ band: g, ...pool(groups[g]) }));
  // 段階間の Q（各段階の推定値を DL の標準誤差で重み付け）
  const w = res.map((r) => 1 / (r.se * r.se));
  const sw = w.reduce((a, b) => a + b, 0);
  const m = res.reduce((a, r, i) => a + w[i] * r.est, 0) / sw;
  const Qb = res.reduce((a, r, i) => a + w[i] * (r.est - m) ** 2, 0);
  return { groups: res, Qbetween: Qb, df: res.length - 1, p: stats.chiSquareSf(Qb, res.length - 1) };
}

function leaveOneOut(studies) {
  if (studies.length < 3) return [];
  return studies.map((s, i) => {
    const r = pool(studies.filter((_, j) => j !== i));
    return { id: s.id, est: r.est, ci: r.ci };
  });
}

/** 報告用に r へ戻す（smd はそのまま） */
function back(effectType, x) {
  return effectType === 'r' ? Math.tanh(x) : x;
}

/** 全体の分析 */
function analyze(effectType, studies) {
  const overall = pool(studies);
  const loo = leaveOneOut(studies);
  return {
    effectType,
    overall,
    subgroups: subgroups(studies),
    leaveOneOut: loo,
    looRange: loo.length ? [Math.min(...loo.map((l) => l.est)), Math.max(...loo.map((l) => l.est))] : null,
    egger: egger(studies),
    totalN: studies.reduce((a, s) => a + s.n, 0)
  };
}

/** 効果の大きさの目安（Cohen） */
function magnitude(effectType, value) {
  const a = Math.abs(value);
  if (effectType === 'r') {
    if (a < 0.1) return { en: 'negligible', ja: 'ごく小さい' };
    if (a < 0.3) return { en: 'small', ja: '小さい' };
    if (a < 0.5) return { en: 'moderate', ja: '中程度' };
    return { en: 'large', ja: '大きい' };
  }
  if (a < 0.2) return { en: 'negligible', ja: 'ごく小さい' };
  if (a < 0.5) return { en: 'small', ja: '小さい' };
  if (a < 0.8) return { en: 'moderate', ja: '中程度' };
  return { en: 'large', ja: '大きい' };
}

module.exports = { computeEffect, plausible, pool, egger, subgroups, leaveOneOut, analyze, back, magnitude, hedgesJ };
