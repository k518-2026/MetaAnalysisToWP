/**
 * OpenAlex（海外の論文の検索と書誌）
 *
 * ・`search=` は**全文検索**になり、「fraction」で心臓の駆出率（ejection fraction）の論文が並ぶ
 *   （2026-09-28 に実測）。題名と要旨だけを見る `title_and_abstract.search` フィルタを使い、
 *   分野（subfield）を教育に絞る
 * ・フィルタはカンマ区切りなので、検索語にカンマを入れない
 * ・キーは URL に載せず Authorization ヘッダで送る（ログに残さないため）
 */
const { fetchRetry, httpError } = require('./http');
const config = require('../config');

const ENDPOINT = 'https://api.openalex.org/works';
const SELECT = 'id,doi,title,publication_year,biblio,authorships,primary_location,best_oa_location,' +
               'locations,type,language,abstract_inverted_index,cited_by_count';

async function callOpenAlex(params) {
  const url = ENDPOINT + '?' + new URLSearchParams(params).toString();
  const key = (process.env.OPENALEX_API_KEY || '').trim();
  const headers = key ? { Authorization: 'Bearer ' + key } : {};

  const res = await fetchRetry(url, { headers }, {
    attempts: 4,
    shouldRetry: async (r) => {
      if (r.status !== 429) return r.status >= 500;
      const body = await r.clone().text();
      return !/budget|Insufficient/i.test(body);   // 1日の枠切れは待っても戻らない
    }
  });
  if (res.ok) return res.json();
  const body = await res.clone().text();
  if (res.status === 429 && /budget|Insufficient/i.test(body)) {
    throw new Error('OpenAlex の1日の利用枠を使い切りました（日本時間9時に戻ります）。' +
                    (key ? '' : 'OPENALEX_API_KEY を登録すると1日 $1 が専用になります。'));
  }
  throw await httpError('OpenAlex APIエラー', res);
}

function buildFilter(theme) {
  const o = config.openalex;
  const parts = [
    'title_and_abstract.search:' + theme.query.replace(/,/g, ' '),
    'is_oa:true',
    'type:article',
    'primary_location.source.type:journal',
    'publication_year:>' + (o.fromYear - 1),
    'language:' + o.languages.join('|'),
    'primary_topic.subfield.id:' + (theme.subfields || o.subfields).join('|')
  ];
  if (o.openJournalsOnly) parts.push('primary_location.source.is_oa:true');
  return parts.join(',');
}

/** 関連度の高い順に候補を集める */
async function search(theme) {
  const out = [];
  let total = 0;
  for (let page = 1; page <= config.openalex.pages; page++) {
    const json = await callOpenAlex({
      filter: buildFilter(theme),
      sort: 'relevance_score:desc',
      'per-page': String(config.openalex.perPage),
      page: String(page),
      select: SELECT
    });
    if (page === 1) total = (json.meta || {}).count || 0;
    const papers = (json.results || []).map(toPaper).filter((p) => p.title);
    out.push(...papers);
    if (papers.length < config.openalex.perPage) break;
  }
  return { total, papers: out };
}

function shortId(url) {
  return String(url || '').replace(/^https?:\/\/openalex\.org\//, '');
}

function cleanTitle(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

function pageRange(first, last) {
  const f = String(first || '').trim();
  const l = String(last || '').trim();
  if (!f) return '';
  return (!l || l === f) ? f : f + '–' + l;
}

/** OpenAlex は要旨を「単語 → 出現位置」の形で持っている。元の文に戻す */
function abstractFromIndex(index) {
  if (!index || typeof index !== 'object') return '';
  const words = [];
  Object.keys(index).forEach((w) => (index[w] || []).forEach((pos) => { words[pos] = w; }));
  return words.filter((w) => w !== undefined).join(' ').replace(/\s+/g, ' ').trim();
}

function toPaper(w) {
  const src = (w.primary_location && w.primary_location.source) || {};
  const b = w.biblio || {};
  const doi = String(w.doi || '').replace(/^https?:\/\/doi\.org\//i, '');

  // PDF の候補は複数ある。出版社版が弾かれてもリポジトリ版が取れることがある
  const pdfUrls = [];
  [w.best_oa_location].concat(w.locations || []).forEach((loc) => {
    const u = loc && loc.pdf_url;
    if (u && !pdfUrls.includes(u)) pdfUrls.push(u);
  });
  const landing = (w.primary_location && w.primary_location.landing_page_url) ||
                  (w.best_oa_location && w.best_oa_location.landing_page_url) || '';

  return {
    source: 'openalex',
    id: shortId(w.id),
    doi,
    title: cleanTitle(w.title || w.display_name),
    titleEn: '',
    authors: (w.authorships || []).map((a) => String((a.author || {}).display_name || '').trim()).filter(Boolean),
    venue: cleanTitle(src.display_name || ''),
    volume: String(b.volume || ''),
    issue: String(b.issue || ''),
    pages: pageRange(b.first_page, b.last_page),
    year: String(w.publication_year || ''),
    language: String(w.language || 'en'),
    citedBy: Number(w.cited_by_count) || 0,
    url: doi ? 'https://doi.org/' + doi : landing,
    landing,
    pdfUrls,
    abstract: abstractFromIndex(w.abstract_inverted_index)
  };
}

module.exports = { search, buildFilter, toPaper, abstractFromIndex, callOpenAlex };
