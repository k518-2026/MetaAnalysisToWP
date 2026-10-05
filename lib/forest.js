/**
 * フォレストプロット（SVG）
 *
 * 研究ごとの効果量と 95% 信頼区間、重み（四角の大きさ）、統合値（ひし形）、予測区間（点線）。
 * r のテーマは z で計算した値を r に戻して描く。
 * 文字は PDF 化するときの Chrome のフォントで描かれる（日本語は Noto Sans CJK を入れてある）。
 */
const { back } = require('./meta');

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(x) {
  return (x < 0 ? '−' : '') + Math.abs(x).toFixed(2);
}

function niceStep(span, parts = 6) {
  const raw = span / parts;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / pow;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * pow;
}

/**
 * rows: [{ label, yi, vi, weight }]（yi は計算に使った尺度: g または z）
 * result: pool() の結果
 * opts: { effectType, lang, large }
 *   large: 記事用。文字を大きく（13→19）して、記事の幅（500〜600px）に縮めても読めるようにする。論文の PDF には使わない
 */
function forestSvg(rows, result, opts) {
  const et = opts.effectType;
  const ja = opts.lang === 'ja';
  const z = 1.959963984540054;
  const items = rows.map((r) => ({
    label: r.label,
    est: back(et, r.yi),
    lo: back(et, r.yi - z * Math.sqrt(r.vi)),
    hi: back(et, r.yi + z * Math.sqrt(r.vi)),
    weight: r.weight
  }));
  const pooled = { est: back(et, result.est), lo: back(et, result.ci[0]), hi: back(et, result.ci[1]) };
  const pi = result.pi ? [back(et, result.pi[0]), back(et, result.pi[1])] : null;

  let min = Math.min(0, pooled.lo, ...items.map((i) => i.lo), ...(pi ? [pi[0]] : []));
  let max = Math.max(0, pooled.hi, ...items.map((i) => i.hi), ...(pi ? [pi[1]] : []));
  if (et === 'r') { min = Math.max(-1, min); max = Math.min(1, max); }
  // 記事用（large）は目盛りを粗くする（文字が大きく、細かいと重なる）
  const step = niceStep(max - min || 1, opts.large ? 3 : 6);
  min = Math.floor(min / step) * step;
  max = Math.ceil(max / step) * step;

  const L = Boolean(opts.large);
  const fs = L ? 19 : 13;
  const dy = L ? 7 : 4;          // 文字の基準線のずれ
  const W = L ? 980 : 900;
  const rowH = L ? 36 : 28;
  const top = L ? 64 : 50;
  const x0 = L ? 360 : 330;
  const x1 = L ? 620 : 640;
  const H = top + (items.length + 2) * rowH + (L ? 92 : 60);
  const X = (v) => x0 + (v - min) / (max - min) * (x1 - x0);
  const maxW = Math.max(...items.map((i) => i.weight));

  const col = L ? { label: 12, est: 640, weight: 910 } : { label: 12, est: 660, weight: 830 };
  const measure = et === 'r' ? 'r' : 'g';
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'Noto Sans', 'Noto Sans CJK JP', 'Yu Gothic', 'Meiryo', Arial, sans-serif" font-size="${fs}">`);
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  out.push(`<text x="${col.label}" y="${top - 18}" font-weight="bold">${ja ? '研究' : 'Study'}</text>`);
  out.push(`<text x="${col.est}" y="${top - 18}" font-weight="bold">${measure} [95% CI]</text>`);
  out.push(`<text x="${col.weight + 50}" y="${top - 18}" font-weight="bold" text-anchor="end">${ja ? '重み' : 'Weight'}</text>`);
  out.push(`<line x1="${col.label}" y1="${top - 8}" x2="${W - 12}" y2="${top - 8}" stroke="#333" stroke-width="1"/>`);

  items.forEach((it, i) => {
    const y = top + i * rowH + rowH / 2;
    const size = 5 + 9 * Math.sqrt(it.weight / maxW);
    out.push(`<text x="${col.label}" y="${y + dy}">${esc(it.label)}</text>`);
    out.push(`<line x1="${X(Math.max(min, it.lo))}" y1="${y}" x2="${X(Math.min(max, it.hi))}" y2="${y}" stroke="#222" stroke-width="1.4"/>`);
    out.push(`<rect x="${X(it.est) - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" fill="#1f4e79"/>`);
    out.push(`<text x="${col.est}" y="${y + dy}">${fmt(it.est)} [${fmt(it.lo)}, ${fmt(it.hi)}]</text>`);
    out.push(`<text x="${col.weight + 50}" y="${y + dy}" text-anchor="end">${it.weight.toFixed(1)}%</text>`);
  });

  const yP = top + items.length * rowH + rowH;
  out.push(`<line x1="${col.label}" y1="${yP - rowH / 2 - 2}" x2="${W - 12}" y2="${yP - rowH / 2 - 2}" stroke="#999" stroke-width="0.8"/>`);
  out.push(`<text x="${col.label}" y="${yP + dy}" font-weight="bold">${ja ? 'ランダム効果モデル（HKSJ）' : 'Random-effects model (HKSJ)'}</text>`);
  out.push(`<polygon points="${X(pooled.lo)},${yP} ${X(pooled.est)},${yP - 8} ${X(pooled.hi)},${yP} ${X(pooled.est)},${yP + 8}" fill="#c00000"/>`);
  out.push(`<text x="${col.est}" y="${yP + dy}" font-weight="bold">${fmt(pooled.est)} [${fmt(pooled.lo)}, ${fmt(pooled.hi)}]</text>`);
  out.push(`<text x="${col.weight + 50}" y="${yP + dy}" text-anchor="end" font-weight="bold">100%</text>`);
  if (pi) {
    const yPi = yP + rowH;
    out.push(`<text x="${col.label}" y="${yPi + dy}">${ja ? '予測区間' : 'Prediction interval'}</text>`);
    out.push(`<line x1="${X(pi[0])}" y1="${yPi}" x2="${X(pi[1])}" y2="${yPi}" stroke="#c00000" stroke-width="1.4" stroke-dasharray="5,4"/>`);
    out.push(`<text x="${col.est}" y="${yPi + dy}">[${fmt(pi[0])}, ${fmt(pi[1])}]</text>`);
  }

  // 軸
  const yAxis = top + (items.length + 2) * rowH + (L ? 16 : 6);
  out.push(`<line x1="${X(0)}" y1="${top - 4}" x2="${X(0)}" y2="${yAxis}" stroke="#666" stroke-width="1" stroke-dasharray="2,3"/>`);
  out.push(`<line x1="${x0}" y1="${yAxis}" x2="${x1}" y2="${yAxis}" stroke="#333" stroke-width="1"/>`);
  for (let v = min; v <= max + step / 2; v += step) {
    const vv = Math.abs(v) < 1e-9 ? 0 : v;
    out.push(`<line x1="${X(vv)}" y1="${yAxis}" x2="${X(vv)}" y2="${yAxis + 5}" stroke="#333"/>`);
    out.push(`<text x="${X(vv)}" y="${yAxis + (L ? 28 : 19)}" text-anchor="middle">${L && step >= 1 ? (vv < 0 ? '−' : '') + Math.abs(vv) : fmt(vv)}</text>`);
  }
  const leftLab = et === 'r' ? (ja ? '負の相関' : 'Negative') : (ja ? '比較群が上' : 'Favors comparison');
  const rightLab = et === 'r' ? (ja ? '正の相関' : 'Positive') : (ja ? '介入群が上' : 'Favors intervention');
  out.push(`<text x="${X(0) - 8}" y="${yAxis + (L ? 58 : 40)}" text-anchor="end" fill="#555">← ${leftLab}</text>`);
  out.push(`<text x="${X(0) + 8}" y="${yAxis + (L ? 58 : 40)}" fill="#555">${rightLab} →</text>`);
  out.push('</svg>');
  return out.join('\n');
}

module.exports = { forestSvg };
