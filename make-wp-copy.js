/**
 * WordPress に貼る用の、リンクを外した本文を作る（送信はしない）。
 *
 *   node make-wp-copy.js <reports の下のフォルダ名> ...
 *
 * reports/<名前>/article-ja.html から、send-wp.js が送るのと同じ処理（content.sanitizeForWordPress）で
 * リンクと「https://」を外し、reports/<名前>/article-ja.wordpress.html に書く。
 * WordPress のエディタの「コードエディター」に貼り替えるために使う。残ったリンクがあれば失敗する。
 */
const fs = require('fs');
const path = require('path');
const doc = require('./lib/content');

for (const name of process.argv.slice(2)) {
  const dir = path.join(__dirname, 'reports', name);
  const src = fs.readFileSync(path.join(dir, 'article-ja.html'), 'utf8');
  const html = doc.stripAstral(doc.sanitizeForWordPress(src));
  const left = doc.findLinks(html);
  if (left.length) throw new Error(name + ': リンクが残っています: ' + left.slice(0, 3).join(' | '));
  const out = path.join(dir, 'article-ja.wordpress.html');
  fs.writeFileSync(out, html, 'utf8');
  console.log(name + ': ' + src.length + ' 字 → ' + html.length + ' 字、リンク 0 → ' + out);
}
