/**
 * 保存した材料（data.json）から、論文 PDF・図・記事を作り直す（言語モデルは呼ばない）
 *
 *   node rebuild.js reports/2026-10-04-math-fraction-instruction
 *
 * 書式を直したとき、過去の報告に反映するのに使う。数値と文章は data.json のまま。
 */
const fs = require('fs');
const path = require('path');
const { build } = require('./run');

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('使い方: node rebuild.js reports/<フォルダ名>');
  const outDir = path.resolve(dir);
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'data.json'), 'utf8'));
  report.models = new Set(report.models || []);
  const built = await build(report, outDir);
  Object.entries(built.sizes).forEach(([f, s]) => console.log(`  ${path.basename(f)} ${Math.round(s / 1024)}KB`));
  console.log('作り直しました: ' + outDir);
}

main().catch((e) => {
  console.error('失敗しました: ' + (e.stack || e.message));
  process.exit(1);
});
