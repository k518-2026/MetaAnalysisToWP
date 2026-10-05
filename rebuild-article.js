/**
 * 記事（article-ja.html）と、記事用の図（forest-article.png）だけを、保存した材料（data.json）から作り直す。
 * 論文 PDF・論文用の図・CSV には触れない。
 *
 *   node rebuild-article.js <reports の下のフォルダ名> ...
 *
 * 記事の書式や図を直したとき、過去の報告に反映するのに使う（rebuild.js は PDF まで作り直す）。
 * 数値と文章は data.json のまま。WordPress に貼る用の article-ja.wordpress.html も作る。
 * 図の PNG は Chrome / Edge で描く（手元の Windows では Edge が使われる）。
 */
const fs = require('fs');
const path = require('path');
const { Bibliography, ETAL } = require('./lib/cite');
const content = require('./lib/content');
const { forestSvg } = require('./lib/forest');
const render = require('./lib/render');
const { links } = require('./run');

async function main() {
  for (const name of process.argv.slice(2)) {
    const dir = path.join(__dirname, 'reports', name);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
    report.models = new Set(report.models || []);
    const bibStudies = report.studies.map((s) => ({ sid: s.sid, paper: s.paper }));
    const bib = new Bibliography(bibStudies, 'jset');

    // 記事用の図（文字を大きくした版）。run.js の drawForest と同じ作り方
    const rows = report.studies.map((s, i) => ({
      label: new Bibliography(bibStudies, 'jset').narrative(s.sid).split(ETAL).join('et al.'),
      yi: s.effect.yi, vi: s.effect.vi, weight: report.analysis.overall.weights[i]
    }));
    const svg = forestSvg(rows, report.analysis.overall, { effectType: report.theme.effect, lang: 'ja', large: true });
    const png = path.join(dir, 'forest-article.png');
    const bytes = await render.withBrowser((browser) => render.svgToPng(browser, svg, png));
    if (!(bytes > 5000)) throw new Error(name + ': forest-article.png が小さすぎます（' + bytes + ' バイト）');

    const html = content.buildArticleHtml(report, report.text.article, bib, links(name), false);
    const left = content.findLinks(html);
    if (left.length) throw new Error(name + ': リンクが残っています: ' + left.slice(0, 3).join(' | '));
    fs.writeFileSync(path.join(dir, 'article-ja.html'), html, 'utf8');
    fs.writeFileSync(path.join(dir, 'article-ja.wordpress.html'), html, 'utf8');
    console.log(name + ': 記事（' + html.length + ' 字）と forest-article.png（' + Math.round(bytes / 1024) + 'KB）を作り直しました');
  }
}

main().catch((e) => {
  console.error('失敗しました: ' + (e.stack || e.message));
  process.exit(1);
});
