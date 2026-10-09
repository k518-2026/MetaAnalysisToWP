/**
 * 本文中の引用と参考文献リスト
 *
 *   jset … 日本語版（日本教育工学会論文誌のテンプレートの「執筆の手引」に従う）
 *          本文: (堀田 2023) (HORITA and OYANAGI 2023) (HORITA et al. 2023) (堀田ほか 2023)
 *          文献: 著者の苗字のアルファベット順。欧文の姓は大文字、6名以上は5名＋ et al.／ほか
 *                GODA, Y., TAKABAYASHI, T. and SUZUKI, K. (2022) 題名. 誌名, 巻 (号)：頁. DOI
 *   ieee … 英語版（ITEL のテンプレート。IEEE の形で、引用した順に [1] [2] …）
 *          文献: A. Lee, B. Kim, and C. Park, “Title,” Journal, vol. 5, no. 2, pp. 1–10, 2021, doi: …
 *
 * 文献はすべて書誌（OpenAlex / J-STAGE）からコードが組み立てる。言語モデルには書かせない。
 * 本文の [S3] [S1, S4] [M:dl1986] を、その様式の引用に置き換える。
 * リストは「断片」の配列で返す: [{ text, italic, bold }]。HTML への変換は呼ぶ側で行う。
 */
const { JAPANESE } = require('./jstage');

// 方法の説明で引用する文献（書誌は固定。DOI は出版社の登録どおり）
const METHOD_REFS = {
  hedges1981: {
    authors: ['Larry V. Hedges'], year: '1981',
    title: 'Distribution theory for Glass\'s estimator of effect size and related estimators',
    venue: 'Journal of Educational Statistics', volume: '6', issue: '2', pages: '107–128',
    doi: '10.3102/10769986006002107'
  },
  dl1986: {
    authors: ['Rebecca DerSimonian', 'Nan Laird'], year: '1986',
    title: 'Meta-analysis in clinical trials',
    venue: 'Controlled Clinical Trials', volume: '7', issue: '3', pages: '177–188',
    doi: '10.1016/0197-2456(86)90046-2'
  },
  hk2001: {
    authors: ['Joachim Hartung', 'Guido Knapp'], year: '2001',
    title: 'A refined method for the meta-analysis of controlled clinical trials with binary outcome',
    venue: 'Statistics in Medicine', volume: '20', issue: '24', pages: '3875–3889',
    doi: '10.1002/sim.1009'
  },
  inthout2014: {
    authors: ['Joanna IntHout', 'John P. A. Ioannidis', 'George F. Borm'], year: '2014',
    title: 'The Hartung-Knapp-Sidik-Jonkman method for random effects meta-analysis is straightforward and considerably outperforms the standard DerSimonian-Laird method',
    venue: 'BMC Medical Research Methodology', volume: '14', issue: '', pages: '', article: '25',
    doi: '10.1186/1471-2288-14-25'
  },
  higgins2002: {
    authors: ['Julian P. T. Higgins', 'Simon G. Thompson'], year: '2002',
    title: 'Quantifying heterogeneity in a meta-analysis',
    venue: 'Statistics in Medicine', volume: '21', issue: '11', pages: '1539–1558',
    doi: '10.1002/sim.1186'
  },
  egger1997: {
    authors: ['Matthias Egger', 'George Davey Smith', 'Martin Schneider', 'Christoph Minder'], year: '1997',
    title: 'Bias in meta-analysis detected by a simple, graphical test',
    venue: 'BMJ', volume: '315', issue: '7109', pages: '629–634',
    doi: '10.1136/bmj.315.7109.629',
    nameParts: [['Egger', 'M.'], ['Davey Smith', 'G.'], ['Schneider', 'M.'], ['Minder', 'C.']]
  },
  borenstein2009: {
    authors: ['Michael Borenstein', 'Larry V. Hedges', 'Julian P. T. Higgins', 'Hannah R. Rothstein'], year: '2009',
    title: 'Introduction to Meta-Analysis', titleApa: 'Introduction to meta-analysis', book: true, publisher: 'Wiley',
    doi: '10.1002/9780470743386'
  },
  cohen1988: {
    authors: ['Jacob Cohen'], year: '1988',
    title: 'Statistical Power Analysis for the Behavioral Sciences', titleApa: 'Statistical power analysis for the behavioral sciences', edition: '2nd ed.', book: true,
    publisher: 'Lawrence Erlbaum Associates', doi: ''
  }
};

const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'del', 'della', 'da', 'di', 'du', 'la', 'le', 'ten', 'ter', 'dos', 'das', 'al', 'bin', 'el']);

function isJapanese(s) {
  return JAPANESE.test(String(s || ''));
}

function initialsOf(given) {
  return String(given || '').split(/\s+/).filter(Boolean).map((t) => {
    if (/^[A-Z]\.?$/.test(t)) return t[0] + '.';
    return t.split('-').filter(Boolean).map((p) => p[0].toUpperCase() + '.').join('-');
  }).join(' ');
}

/** "John A. Smith" → { family: 'Smith', initials: 'J. A.' }。日本語の名前は { family: 山田, full: 山田太郎 } */
function splitName(name) {
  const raw = String(name || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { family: '', initials: '', full: '', cjk: false };
  if (isJapanese(raw)) {
    const parts = raw.split(' ');
    return { family: parts[0], initials: '', full: raw.replace(/ /g, ''), cjk: true };
  }
  if (raw.includes(',')) {
    const [fam, given] = raw.split(',').map((x) => x.trim());
    return { family: fam, initials: initialsOf(given), full: raw, cjk: false };
  }
  const tokens = raw.split(' ');
  if (tokens.length === 1) return { family: tokens[0], initials: '', full: raw, cjk: false };
  let i = tokens.length - 1;
  while (i > 1 && PARTICLES.has(tokens[i - 1].toLowerCase())) i--;
  return { family: tokens.slice(i).join(' '), initials: initialsOf(tokens.slice(0, i).join(' ')), full: raw, cjk: false };
}

/** 様式に応じた著者の並び。日本語版は日本語名、英語版はローマ字（J-STAGE の英語表記）を優先 */
function namesFor(p, style) {
  if (p.nameParts) return p.nameParts.map(([family, initials]) => ({ family, initials, full: '', cjk: false }));
  const list = ((style === 'ieee' || style === 'apa') && p.authorsEn && p.authorsEn.length) ? p.authorsEn : (p.authors || []);
  const names = list.map(splitName).filter((n) => n.family);
  // APA: 姓がすべて大文字で書かれている書誌（KARAMERT）は、頭文字だけ大文字にする（McDonald のような混在はそのまま）
  if (style === 'apa') {
    names.forEach((n) => {
      if (!n.cjk && n.family.length > 1 && n.family === n.family.toUpperCase() && /[A-Z]/.test(n.family)) {
        n.family = n.family.toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
      }
    });
  }
  return names;
}

// ============================================================
// 本文中の引用
// ============================================================

/** JSET の著者部分: 堀田 / 堀田・小柳 / 堀田ほか / HORITA / HORITA and OYANAGI / HORITA et al. */
function jsetAuthors(p) {
  const n = namesFor(p, 'jset');
  if (!n.length) return { text: 'Anonymous', etal: false };
  const ja = n[0].cjk;
  const fam = (x) => (x.cjk ? x.family : x.family.toUpperCase());
  if (n.length === 1) return { text: fam(n[0]), etal: false };
  if (n.length === 2) return { text: ja ? fam(n[0]) + '・' + fam(n[1]) : fam(n[0]) + ' and ' + fam(n[1]), etal: false };
  return ja ? { text: fam(n[0]) + 'ほか', etal: false } : { text: fam(n[0]), etal: true };
}

/** IEEE の表の見出し用: Lee / Lee and Kim / Lee et al. */
function ieeeShort(p) {
  const n = namesFor(p, 'ieee');
  if (!n.length) return 'Anonymous';
  if (n.length === 1) return n[0].family;
  if (n.length === 2) return n[0].family + ' and ' + n[1].family;
  return n[0].family + ' et al.';
}

/** APA の本文中の著者部分: Lee / Lee & Kim（括弧の中）・Lee and Kim（文中）/ Lee et al.（3名以上） */
function apaAuthors(p, amp) {
  const n = namesFor(p, 'apa');
  if (!n.length) return 'Anonymous';
  if (n.length === 1) return n[0].family;
  if (n.length === 2) return n[0].family + (amp ? ' & ' : ' and ') + n[1].family;
  return n[0].family + ' et al.';
}

function romanFamily(p) {
  const en = (p.authorsEn || []).map(splitName)[0];
  const n = namesFor(p, 'jset')[0];
  return String((en && en.family) || (n && n.family) || p.title || '').toUpperCase();
}

/** 同じ「著者・年」が2本以上あれば年に a, b を付ける（JSET） */
function yearLabels(entries, style) {
  const groups = {};
  entries.forEach((p) => {
    const k = (style === 'apa' ? apaAuthors(p, true) : jsetAuthors(p).text) + '|' + p.year;
    (groups[k] = groups[k] || []).push(p);
  });
  const out = {};
  Object.values(groups).forEach((list) => {
    if (list.length === 1) { out[list[0].key] = list[0].year || 'n.d.'; return; }
    list.sort((a, b) => String(a.title).localeCompare(String(b.title)))
      .forEach((p, i) => { out[p.key] = (p.year || 'n.d.') + String.fromCharCode(97 + i); });
  });
  return out;
}

// 引用の中の「et al.」はイタリックにする。HTML に変換したあとで置き換えるための印
const ETAL = '@@ETAL@@';

class Bibliography {
  /** studies: [{ sid: 'S1', paper }]、style: 'jset' | 'ieee' */
  constructor(studies, style) {
    this.style = style;
    this.entries = {};
    studies.forEach((s) => { this.entries[s.sid] = { key: s.sid, included: true, ...s.paper }; });
    Object.keys(METHOD_REFS).forEach((k) => { this.entries['M:' + k] = { key: 'M:' + k, included: false, ...METHOD_REFS[k] }; });
    this.years = yearLabels(Object.values(this.entries), style);
    this.used = new Set();
    this.order = [];      // IEEE の番号（初めて引用した順）
  }

  use(key) {
    if (!this.entries[key]) return false;
    if (!this.used.has(key)) { this.used.add(key); this.order.push(key); }
    return true;
  }

  number(key) {
    this.use(key);
    return this.order.indexOf(key) + 1;
  }

  /** 表や図で使う形: LEE et al. (2021) ／ Lee et al. [3] */
  narrative(key) {
    const p = this.entries[key];
    if (!p) return key;
    this.use(key);
    if (this.style === 'ieee') return ieeeShort(p) + ' [' + this.number(key) + ']';
    if (this.style === 'apa') return apaAuthors(p, false) + ' (' + this.years[key] + ')';
    const a = jsetAuthors(p);
    return a.text + (a.etal ? ' ' + ETAL : '') + ' (' + this.years[key] + ')';
  }

  /** 括弧の引用: (LEE et al. 2021，WHITE 2019) ／ [1], [3] */
  cite(keys) {
    const ok = keys.filter((k) => this.use(k));
    if (!ok.length) return '';
    if (this.style === 'ieee') {
      return ok.map((k) => this.number(k)).sort((a, b) => a - b).map((n) => '[' + n + ']').join(', ');
    }
    if (this.style === 'apa') {
      const labels = ok.map((k) => ({ sort: romanFamily(this.entries[k]) + this.years[k], text: apaAuthors(this.entries[k], true) + ', ' + this.years[k] }))
        .sort((a, b) => a.sort.localeCompare(b.sort));
      return '(' + labels.map((l) => l.text).join('; ') + ')';
    }
    const labels = ok.map((k) => {
      const a = jsetAuthors(this.entries[k]);
      return { sort: romanFamily(this.entries[k]) + this.years[k], text: a.text + (a.etal ? ' ' + ETAL : '') + ' ' + this.years[k] };
    }).sort((a, b) => a.sort.localeCompare(b.sort));
    return '(' + labels.map((l) => l.text).join('，') + ')';
  }

  /** 本文中の [S1] [S1, S3] [M:dl1986] を引用に置き換える。知らない番号は消す */
  resolve(text) {
    return String(text || '').replace(/\s?\[((?:S\d+|M:[a-z0-9]+)(?:\s*[,;，]\s*(?:S\d+|M:[a-z0-9]+))*)\]/g, (whole, inner, offset, str) => {
      const keys = inner.split(/\s*[,;，]\s*/);
      // APA: 文頭で動詞が続く引用（"[S1] reported ..."）は文中の形 Lee (2021) にする
      if (this.style === 'apa' && /(^|[.!?:]\s*)$/.test(str.slice(0, offset)) && /^\s+[a-z]/.test(str.slice(offset + whole.length))) {
        const named = keys.filter((k) => this.entries[k]).map((k) => this.narrative(k));
        if (named.length) {
          const joined = named.length === 1 ? named[0] : named.length === 2 ? named.join(' and ') : named.slice(0, -1).join(', ') + ', and ' + named[named.length - 1];
          return (/^\s/.test(whole) ? ' ' : '') + joined;
        }
      }
      const c = this.cite(keys);
      if (!c) return '';
      return (this.style === 'ieee' || /^\s/.test(whole) ? ' ' : '') + c;
    });
  }

  /** 引用の印を消す（要旨・抄録は引用を含めない） */
  strip(text) {
    return String(text || '').replace(/\s?\[(?:S\d+|M:[a-z0-9]+)(?:\s*[,;，]\s*(?:S\d+|M:[a-z0-9]+))*\]/g, '');
  }

  /** 参考文献リスト。[{ label, segs }]。jset は苗字のアルファベット順、ieee は番号順 */
  references() {
    if (this.style === 'ieee') {
      return this.order.map((k, i) => ({ label: '[' + (i + 1) + ']', segs: ieeeRef(this.entries[k]) }));
    }
    const list = [...this.used].map((k) => this.entries[k]);
    if (this.style === 'apa') {
      list.sort((a, b) => romanFamily(a).localeCompare(romanFamily(b)) || String(this.years[a.key]).localeCompare(String(this.years[b.key])));
      return list.map((p) => ({ label: '', segs: apaRef(p, this.years[p.key]) }));
    }
    list.sort((a, b) => romanFamily(a).localeCompare(romanFamily(b)) || String(this.years[a.key]).localeCompare(String(this.years[b.key])));
    return list.map((p) => ({ label: '', segs: jsetRef(p, this.years[p.key]) }));
  }
}

// ============================================================
// 参考文献の1件
// ============================================================

function endPeriod(s) {
  const t = String(s || '').trim();
  return /[.?!。．]$/.test(t) ? t : t + '.';
}

/** JSET: 著者 (年) 題名. 誌名, 巻 (号)：頁. DOI */
function jsetRef(p, yearLabel) {
  const segs = [];
  const push = (text, o = {}) => { if (text) segs.push({ text, italic: !!o.italic, bold: !!o.bold }); };
  if (p.included) push('*');
  const n = namesFor(p, 'jset');
  const ja = n.length && n[0].cjk;
  const shown = n.slice(0, 5);
  let auth;
  if (ja) {
    auth = shown.map((x) => x.full).join(', ') + (n.length > 5 ? 'ほか' : '');
  } else {
    const f = shown.map((x) => x.family.toUpperCase() + (x.initials ? ', ' + x.initials : ''));
    auth = n.length > 5 ? f.join(', ') : (f.length > 1 ? f.slice(0, -1).join(', ') + ' and ' + f[f.length - 1] : f[0] || '');
  }
  push(auth || '');
  if (!ja && n.length > 5) { push(' '); push('et al.', { italic: true }); }
  push(' (' + (yearLabel || p.year || 'n.d.') + ') ');
  const jaText = isJapanese(p.title) || isJapanese(p.venue);
  if (p.book) {
    push(p.title, { italic: !jaText });
    if (p.edition) push(' (' + p.edition + ')');
    push('. ' + p.publisher);
  } else {
    push(endPeriod(p.title) + ' ');
    push(p.venue, { italic: !jaText });
    if (p.volume) {
      push(', ');
      push(p.volume, { bold: true });
      if (p.issue) push(' (' + p.issue + ')');
    }
    if (p.pages) push('：' + p.pages.replace(/[–—]/g, '-'));
    else if (p.article) push('：' + p.article);
  }
  if (p.doi) push('. https://doi.org/' + p.doi);
  else if (p.url && !p.book) push('. ' + p.url);
  return segs;
}

/** IEEE: A. Lee, B. Kim, and C. Park, “Title,” Journal, vol. 5, no. 2, pp. 1–10, 2021, doi: … */
function ieeeRef(p) {
  const segs = [];
  const push = (text, o = {}) => { if (text) segs.push({ text, italic: !!o.italic, bold: false }); };
  if (p.included) push('*');
  const n = namesFor(p, 'ieee').map((x) => (x.cjk ? x.full : (x.initials ? x.initials + ' ' : '') + x.family));
  let auth = '';
  if (n.length > 6) auth = n[0] + ' et al.';
  else if (n.length === 1) auth = n[0];
  else if (n.length === 2) auth = n[0] + ' and ' + n[1];
  else if (n.length > 2) auth = n.slice(0, -1).join(', ') + ', and ' + n[n.length - 1];
  const japanese = isJapanese(p.title);
  const title = japanese ? (p.titleEn || p.title) : p.title;
  const venue = (japanese || isJapanese(p.venue)) ? (p.venueEn || p.venue) : p.venue;
  if (p.book) {
    push(auth + ', ');
    push(title, { italic: true });
    push(', ' + (p.edition ? p.edition + ' ' : '') + p.publisher + ', ' + p.year);
  } else {
    push((auth ? auth + ', ' : '') + '“' + title + ',” ');
    push(venue, { italic: true });
    if (p.volume) push(', vol. ' + p.volume);
    if (p.issue) push(', no. ' + p.issue);
    if (p.pages) push(', ' + (/[–-]/.test(p.pages) ? 'pp. ' : 'p. ') + p.pages.replace(/-/g, '–'));
    else if (p.article) push(', Art. no. ' + p.article);
    push(', ' + p.year);
    if (japanese) push(' (in Japanese)');
  }
  if (p.doi) push(', doi: ' + p.doi + '.');
  else if (p.url && !p.book) push('. [Online]. Available: ' + p.url);
  else push('.');
  return segs;
}

// ============================================================
// APA 第7版
// ============================================================

// 題名を文頭だけ大文字にするとき、大文字のまま残す語（国・国民・言語・地名・人名）。OpenAlex の題名は Title Case のものが多い
const PROPER = new Set(('turkey turkish türkiye spain spanish brazil brazilian palestine palestinian colombia colombian china chinese ' +
  'taiwan taiwanese japan japanese korea korean india indian indonesia indonesian philippines philippine filipino malaysia malaysian ' +
  'thailand thai bangkok brunei bahrain jordan jordanian amman saudi arabia arab arabic qatar qatari iran iranian israel israeli ' +
  'germany german belgium belgian netherlands dutch france french italy italian greece greek poland polish finland finnish sweden ' +
  'swedish norway norwegian denmark danish switzerland swiss austria austrian america american british england english scotland ' +
  'welsh ireland irish canada canadian australia australian africa african ghana ghanaian nigeria nigerian kenya kenyan uganda ' +
  'tanzania ethiopia zimbabwe rwanda egypt egyptian mexico mexican chile chilean peru peruvian ecuador cuba cuban singapore ' +
  'vietnam vietnamese pakistan pakistani bangladesh nepal lanka hong kong shanghai beijing tehran istanbul ankara izmir tamil ' +
  'nadu kerala karnataka telangana sabah kinabalu sichuan mianyang ramallah bogotá cambridgeshire erzincan norway europe european ' +
  'asia asian latin western eastern middle east states united kingdom zealand korea arab emirates ' +
  'pearson cohen hedges piaget vygotsky montessori bebras scratch lego kahoot matific geogebra wechsler bayesian bayes ' +
  'covid sars black white hispanic latino latina indigenous').split(' '));

const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'nor', 'for', 'of', 'in', 'on', 'at', 'to', 'by', 'as', 'with', 'without',
  'from', 'into', 'over', 'under', 'between', 'among', 'across', 'through', 'during', 'after', 'before', 'about', 'than', 'via', 'vs',
  'is', 'are', 'was', 'be', 'not', 'do', 'does', 'how', 'what', 'when', 'where', 'why', 'which', 'who', 'that', 'this', 'these', 'those']);

/** 題名が Title Case（内容語の多くが大文字始まり）か */
function isTitleCased(title) {
  const words = String(title).split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && w.length > 3 && !FUNCTION_WORDS.has(w.toLowerCase()));
  if (words.length < 3) return false;
  return words.filter((w) => /^[A-Z]/.test(w)).length / words.length >= 0.6;
}

function lowerWord(word, keep) {
  const bare = word.replace(/[^A-Za-z0-9'’]/g, '');
  if (!bare || keep) return word;
  if (/[0-9]/.test(bare) || (bare.length > 1 && bare === bare.toUpperCase()) || /[a-z][A-Z]/.test(bare)) return word;   // 略語・数字・PLoS など
  if (PROPER.has(bare.toLowerCase().replace(/['’]s$/, ''))) return word;
  return /^[A-Z]/.test(word) ? word.charAt(0).toLowerCase() + word.slice(1) : word;
}

/**
 * APA の題名は文頭（とコロンの後）だけ大文字にする。Title Case の題名にだけ働く（すでに文頭だけ大文字のものは触らない）。
 * 辞書が無いので、リストに無い固有名詞（小さな地名など）は小文字になる。参考文献の目視確認が要る
 */
function sentenceCase(title) {
  const t = String(title || '').trim();
  // 英語の題名だけ。英語の機能語（the, of, and …）が2種類以上なければ、他言語（インドネシア語など）とみなして触らない
  const fw = new Set(t.toLowerCase().split(/[^a-z']+/).filter((w) => FUNCTION_WORDS.has(w)));
  if (fw.size < 2 || !isTitleCased(t)) return t;
  let clauseStart = true;
  return t.split(/(\s+)/).map((tok) => {
    if (!tok || /^\s+$/.test(tok)) return tok;
    const core = tok.replace(/^[("'“‘[]+/, '');
    const lead = tok.slice(0, tok.length - core.length);
    const out = core.split('-').map((part, i) => lowerWord(part, clauseStart && i === 0)).join('-');
    clauseStart = /[:?!—–]$/.test(tok);
    return lead + out;
  }).join('');
}

/** APA: Lee, A. B., Kim, C. D., & Park, E. F. (2021). Title in sentence case. Journal Title, 5(2), 1–10. https://doi.org/… */
function apaRef(p, yearLabel) {
  const segs = [];
  const push = (text, o = {}) => { if (text) segs.push({ text, italic: !!o.italic, bold: false }); };
  if (p.included) push('*');
  const n = namesFor(p, 'apa').map((x) => (x.cjk ? x.full : x.family + (x.initials ? ', ' + x.initials : '')));
  let auth = '';
  if (n.length > 20) auth = n.slice(0, 19).join(', ') + ', . . . ' + n[n.length - 1];
  else if (n.length === 1) auth = n[0];
  else if (n.length > 1) auth = n.slice(0, -1).join(', ') + ', & ' + n[n.length - 1];
  if (auth) push((/[.]$/.test(auth) ? auth : auth + '.') + ' ');
  const year = '(' + (yearLabel || p.year || 'n.d.') + '). ';
  const japanese = isJapanese(p.title);
  const rawTitle = p.titleApa || (japanese ? p.title : sentenceCase(p.title));
  const title = japanese && p.titleEn ? rawTitle + ' [' + sentenceCase(p.titleEn) + ']' : rawTitle;
  if (p.book) {
    if (auth) push(year);
    push(title, { italic: true });
    if (p.edition) push(' (' + p.edition + ')');
    push('. ' + p.publisher + '.');
  } else {
    if (auth) push(year);
    push(endPeriod(title) + ' ');
    push(p.venue, { italic: !isJapanese(p.venue) });
    if (p.volume) {
      push(', ');
      push(p.volume, { italic: true });
      if (p.issue) push('(' + p.issue + ')');
    }
    if (p.pages) push(', ' + p.pages.replace(/-/g, '–'));
    else if (p.article) push(', Article ' + p.article);
    push('.');
  }
  if (!auth) push(' ' + year.trim());
  if (p.doi) push(' https://doi.org/' + p.doi);
  else if (p.url && !p.book) push(' ' + p.url);
  return segs;
}

module.exports = { Bibliography, splitName, jsetAuthors, ieeeShort, jsetRef, ieeeRef, apaRef, apaAuthors, sentenceCase, METHOD_REFS, isJapanese, ETAL };
