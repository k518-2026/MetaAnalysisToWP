/**
 * 記事（article-ja.html）だけを、保存した材料（data.json）から作り直す。論文 PDF・図・CSV には触れない。
 *
 *   node rebuild-article.js <reports の下のフォルダ名> ...
 *
 * 記事の書式を直したとき、過去の報告に反映するのに使う（rebuild.js は PDF や図まで作り直す）。
 * 数値と文章は data.json のまま。WordPress に貼る用の article-ja.wordpress.html も作る。
 */
const fs = require('fs');
const path = require('path');
const { Bibliography } = require('./lib/cite');
const content = require('./lib/content');
const { links } = require('./run');

for (const name of process.argv.slice(2)) {
  const dir = path.join(__dirname, 'reports', name);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
  report.models = new Set(report.models || []);
  const bib = new Bibliography(report.studies.map((s) => ({ sid: s.sid, paper: s.paper })), 'jset');
  const html = content.buildArticleHtml(report, report.text.article, bib, links(name), false);
  const left = content.findLinks(html);
  if (left.length) throw new Error(name + ': リンクが残っています: ' + left.slice(0, 3).join(' | '));
  fs.writeFileSync(path.join(dir, 'article-ja.html'), html, 'utf8');
  fs.writeFileSync(path.join(dir, 'article-ja.wordpress.html'), html, 'utf8');
  console.log(name + ': 記事を作り直しました（' + html.length + ' 字）');
}
