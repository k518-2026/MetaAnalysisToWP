/**
 * 対象論文の本文 PDF の取得と文字起こし（paper-to-zenn/datasci と同じ作り）
 *
 * ・pdf_url があっても実際に PDF が返るのは6〜7割。出版社は 403 や HTML のログイン画面を返すので、
 *   **先頭4バイトが %PDF か**を必ず確かめる
 * ・文字起こしは poppler の pdftotext（GitHub Actions では apt で入れる）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { fetchRetry } = require('./http');
const config = require('../config');

function isPdf(buf) {
  return buf.length > 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

/** 論文のページ（HTML）から本文 PDF の URL を探す。citation_pdf_url は学術誌のページに広く入っている */
function pdfLinkFromHtml(html, pageUrl) {
  const s = String(html);
  const m = s.match(/<meta[^>]+name=["']citation_pdf_url["'][^>]*content=["']([^"']+)["']/i) ||
            s.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']citation_pdf_url["']/i);
  if (!m) return '';
  try { return new URL(m[1].replace(/&amp;/g, '&'), pageUrl).href; } catch { return ''; }
}

/** 1つの URL から PDF を取る。取れなければ理由を tried に足して null */
async function tryPdf(url, tried) {
  try {
    const res = await fetchRetry(url, { headers: { Accept: 'application/pdf' }, redirect: 'follow' },
      { attempts: 2, timeoutMs: 90000 });
    if (!res.ok) { tried.push(res.status + ' ' + url); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!isPdf(buf)) { tried.push('PDFではない ' + url); return null; }
    if (buf.length > config.pdfMaxBytes) { tried.push('大きすぎる ' + url); return null; }
    return { buf, url, bytes: buf.length };
  } catch (e) {
    tried.push('通信失敗 ' + url + ' ' + e.message);
    return null;
  }
}

/**
 * PDF を取ってくる。取れなければ null。
 * OpenAlex が PDF の URL を持たない論文（ログで「候補なし」になったもの）や、URL が弾かれた論文は、
 * 論文のページを開いて citation_pdf_url を探して試す
 */
async function fetchPdf(paper) {
  const tried = [];
  for (const url of paper.pdfUrls || []) {
    const got = await tryPdf(url, tried);
    if (got) return got;
  }
  if (paper.landing && /^https?:/.test(paper.landing)) {
    try {
      const res = await fetchRetry(paper.landing, { headers: { Accept: 'text/html' }, redirect: 'follow' }, { attempts: 2, timeoutMs: 30000 });
      if (res.ok) {
        const link = pdfLinkFromHtml(await res.text(), res.url || paper.landing);
        if (link && !(paper.pdfUrls || []).includes(link)) {
          const got = await tryPdf(link, tried);
          if (got) return got;
        }
      } else {
        tried.push('ページ ' + res.status + ' ' + paper.landing);
      }
    } catch (e) {
      tried.push('ページを開けない ' + paper.landing + ' ' + e.message);
    }
  }
  console.log('    PDF を取得できませんでした: ' + (tried.join(' / ') || '候補なし').slice(0, 300));
  return null;
}

/** pdftotext で文字にする。取れなければ空文字 */
function extractText(pdf) {
  const file = path.join(os.tmpdir(), 'meta-' + process.pid + '-' + Date.now() + '.pdf');
  fs.writeFileSync(file, pdf.buf);
  try {
    const out = execFileSync('pdftotext', ['-q', '-enc', 'UTF-8', file, '-'], {
      maxBuffer: 64 * 1024 * 1024, encoding: 'utf8'
    });
    return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  } catch (e) {
    console.warn('    pdftotext に失敗: ' + e.message.slice(0, 200));
    return '';
  } finally {
    try { fs.unlinkSync(file); } catch { /* 消せなくても続ける */ }
  }
}

/** 参考文献リストから後ろを落とす（モデルに渡す量を減らす） */
function dropReferenceList(text) {
  const m = String(text).match(/\n\s*(references|bibliography|literature cited|引用文献|参考文献)\s*\n/i);
  if (!m || m.index < text.length * 0.3) return text;   // 前の方にある見出しは本文の一部
  return text.slice(0, m.index);
}

module.exports = { fetchPdf, extractText, dropReferenceList, isPdf, pdfLinkFromHtml };
