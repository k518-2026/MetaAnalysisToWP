/**
 * J-STAGE（国内の論文）
 *
 * ・検索 API は要旨を返さない。要旨は記事ページの <meta name="abstract"> から取る
 *   （paper-to-zenn の旧版 fetch-jstage.js で実測済み）
 * ・abst 検索は要旨を対象にするので、要旨を持つ論文しか返らない（空振りの記事ページ取得が減る）
 * ・分野では絞れない（「分数」で物理の論文も返る）。要旨の選別で落とす
 * ・PDF の URL は記事ページの citation_pdf_url。無ければ URL の _article を _pdf に替える
 */
const { fetchRetry, sleep } = require('./http');
const config = require('../config');

const API = 'https://api.jstage.jst.go.jp/searchapi/do';

const unescapeHtml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&amp;/g, '&');   // &amp; は最後。先に戻すと &amp;lt; が壊れる

const clean = (s) => unescapeHtml(String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// ひらがな・カタカナ・漢字
const JAPANESE = new RegExp('[\\u3040-\\u30ff\\u4e00-\\u9fff]');

function pickLang(entry, tag) {
  const block = entry.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!block) return { ja: '', en: '' };
  const ja = block[1].match(/<ja>([\s\S]*?)<\/ja>/);
  const en = block[1].match(/<en>([\s\S]*?)<\/en>/);
  return { ja: clean(ja && ja[1]), en: clean(en && en[1]) };
}

/** 著者名。日本語と英語の両方を取っておく（英語版の文献リストは英語表記を使う） */
function pickAuthors(entry) {
  const block = entry.match(/<author>([\s\S]*?)<\/author>/);
  if (!block) return { en: [], ja: [] };
  const names = (lang) => {
    const m = block[1].match(new RegExp(`<${lang}>([\\s\\S]*?)</${lang}>`));
    if (!m) return [];
    const out = [];
    const re = /<name>([\s\S]*?)<\/name>/g;
    let x;
    while ((x = re.exec(m[1])) !== null) {
      const n = clean(x[1]);
      if (n) out.push(n);
    }
    return out;
  };
  return { en: names('en'), ja: names('ja') };
}

function parseEntry(entry) {
  const title = pickLang(entry, 'article_title');
  const link = pickLang(entry, 'article_link');
  const journal = pickLang(entry, 'material_title');
  const url = link.ja || link.en;
  if (!url) return null;

  const pick = (tag) => clean((entry.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || '');
  const authors = pickAuthors(entry);
  const doi = pick('prism:doi');
  const first = pick('prism:startingPage');
  const last = pick('prism:endingPage');
  const japanese = !!title.ja && JAPANESE.test(title.ja);

  return {
    source: 'jstage',
    id: doi ? 'doi:' + doi.toLowerCase() : url,
    doi,
    title: title.ja || title.en,
    titleEn: japanese ? title.en : '',
    authors: authors.ja.length ? authors.ja : authors.en,
    authorsEn: authors.en,
    venue: journal.ja || journal.en,
    venueEn: journal.en,
    volume: pick('prism:volume'),
    issue: pick('prism:number'),
    pages: first ? (last && last !== first ? first + '–' + last : first) : '',
    year: pick('pubyear'),
    language: japanese ? 'ja' : 'en',
    citedBy: 0,
    url: doi ? 'https://doi.org/' + doi : url,
    landing: url,
    pdfUrls: [],
    abstract: ''
  };
}

async function getText(url) {
  const res = await fetchRetry(url, {}, { attempts: 2, timeoutMs: 30000 });
  if (!res.ok) throw new Error(`J-STAGE が HTTP ${res.status} を返しました`);
  return res.text();
}

/** キーワードごとに検索して、重複を除いた候補を返す（要旨はまだ空） */
async function search(theme) {
  if (!config.jstage.enabled || !(theme.jstage || []).length) return { total: 0, papers: [] };
  const seen = new Set();
  const papers = [];
  let total = 0;
  for (const kw of theme.jstage) {
    const params = new URLSearchParams({
      service: '3', abst: kw, count: String(config.jstage.count),
      pubyearfrom: String(config.jstage.fromYear)
    });
    try {
      const xml = await getText(API + '?' + params.toString());
      total += Number((xml.match(/<opensearch:totalResults>(\d+)/) || [])[1] || 0);
      xml.split('<entry>').slice(1).map(parseEntry).filter(Boolean).forEach((p) => {
        if (seen.has(p.id)) return;
        seen.add(p.id);
        papers.push(p);
      });
    } catch (e) {
      console.warn(`  J-STAGE の検索に失敗（${kw}）: ${e.message}`);
    }
  }
  papers.sort((a, b) => Number(b.year || 0) - Number(a.year || 0));
  return { total, papers };
}

/** 記事ページから要旨と PDF の URL を取る */
function parseArticlePage(html, pageUrl) {
  const meta = (name) => {
    const re = new RegExp(`<meta\\s+name="${name}"\\s+content="([\\s\\S]*?)"\\s*/?>`, 'i');
    return clean((String(html).match(re) || [])[1] || '');
  };
  const abstract = meta('abstract') || meta('citation_abstract') || meta('description');
  let pdf = meta('citation_pdf_url');
  if (!pdf && /\/_article/.test(pageUrl)) pdf = pageUrl.replace(/\/_article(\/-char\/(ja|en))?\/?$/, '/_pdf$1');
  return { abstract, pdf };
}

/** 候補に要旨と PDF の URL を付ける（上限まで） */
async function enrich(papers) {
  let opened = 0;
  for (const p of papers) {
    if (opened >= config.jstage.maxPageFetch) break;
    if (p.source !== 'jstage' || p.abstract) continue;
    opened++;
    try {
      const html = await getText(p.landing);
      const got = parseArticlePage(html, p.landing);
      p.abstract = got.abstract;
      if (got.pdf) p.pdfUrls = [got.pdf];
    } catch (e) {
      console.warn('  J-STAGE の記事ページを開けません: ' + p.landing + ' ' + e.message);
    }
    await sleep(config.jstage.pageIntervalMs);
  }
  return papers;
}

module.exports = { search, enrich, parseEntry, parseArticlePage, JAPANESE };
