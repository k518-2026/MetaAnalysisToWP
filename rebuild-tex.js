/**
 * 保存した材料（data.json）から、論文を LuaLaTeX で組み直す（言語モデルは呼ばない）
 *
 *   node rebuild-tex.js reports/2026-10-06-math-anxiety-achievement [出力先フォルダ]
 *
 * 出力先を省くと、そのフォルダの中の paper-ja.tex / paper-en.tex / forest-*.pdf / paper-*.pdf を作り直す。
 * 出力先を指定すると、そこに書く（見た目の試し組み用。reports には触れない）。
 */
const fs = require('fs');
const path = require('path');
const { buildTexPapers } = require('./run');

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('使い方: node rebuild-tex.js reports/<フォルダ名> [出力先]');
  const srcDir = path.resolve(dir);
  const outDir = path.resolve(process.argv[3] || dir);
  const report = JSON.parse(fs.readFileSync(path.join(srcDir, 'data.json'), 'utf8'));
  report.models = new Set(report.models || []);
  fs.mkdirSync(outDir, { recursive: true });
  const r = await buildTexPapers(report, outDir);
  Object.entries(r.sizes).forEach(([f, s]) => console.log(`  ${path.basename(f)} ${Math.round(s / 1024)}KB`));
  console.log('組み直しました: ' + outDir);
  if (r.warnings.length) console.log('注意:\n  ' + r.warnings.join('\n  '));
}

main().catch((e) => {
  console.error('失敗しました: ' + (e.stack || e.message));
  process.exit(1);
});
