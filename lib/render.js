/**
 * HTML → PDF、SVG → PNG（Chrome を puppeteer-core で動かす）
 *
 * ・GitHub Actions の ubuntu-latest には google-chrome が最初から入っている（Chrome 本体はダウンロードしない）
 * ・手元の Windows では Edge で動く。CHROME_PATH で場所を指定できる
 * ・日本語は Noto CJK（Actions では fonts-noto-cjk を入れる）。MS 明朝・MS ゴシック・Times New Roman・Arial が
 *   無い環境では、同じ系統の Noto / Liberation で代わりに描く
 */
const fs = require('fs');
const config = require('../config');

function chromePath() {
  const env = (process.env.CHROME_PATH || '').trim();
  if (env) return env;
  const found = config.chromeCandidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!found) throw new Error('Chrome が見つかりません（CHROME_PATH で場所を指定してください）');
  return found;
}

async function withBrowser(fn) {
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none']
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/**
 * 論文の HTML を PDF にする。用紙と余白は HTML の @page に書いてある（JSET は B5、ITEL は A4）。
 * header / footer は Chrome の欄外（ページ番号など）
 */
async function htmlToPdf(browser, html, file, { header, footer }) {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: file,
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: header || '<div></div>',
    footerTemplate: footer || '<div></div>'
  });
  await page.close();
  return fs.statSync(file).size;
}

/** PDF のページ数（中身の確認用） */
function pdfPages(file) {
  const s = fs.readFileSync(file, 'latin1');
  return (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

/** SVG を PNG にする（記事に載せる図）。2倍の解像度で撮る */
async function svgToPng(browser, svg, file) {
  const page = await browser.newPage();
  const w = Number((svg.match(/width="(\d+)"/) || [])[1] || 900);
  const h = Number((svg.match(/height="(\d+)"/) || [])[1] || 600);
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await page.setContent('<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body>' + svg + '</body></html>', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const el = await page.$('svg');
  await el.screenshot({ path: file, omitBackground: false });
  await page.close();
  return fs.statSync(file).size;
}

/** SVG を、図と同じ大きさの1ページの PDF（ベクター）にする。LuaLaTeX の \includegraphics で読む */
async function svgToPdf(browser, svg, file) {
  const page = await browser.newPage();
  const w = Number((svg.match(/width="(\d+)"/) || [])[1] || 900);
  const h = Number((svg.match(/height="(\d+)"/) || [])[1] || 600);
  await page.setContent('<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:' + w + 'px ' + h + 'px;margin:0}html,body{margin:0;background:#fff}svg{display:block}</style></head><body>' + svg + '</body></html>', { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: file, width: w + 'px', height: h + 'px', printBackground: true, pageRanges: '1' });
  await page.close();
  return fs.statSync(file).size;
}

module.exports = { withBrowser, htmlToPdf, svgToPng, svgToPdf, chromePath, pdfPages };
