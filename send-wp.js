/**
 * 記事を WordPress へメールで送る（run.js で作った記事を、PDF を push したあとで送る）
 *
 *   node send-wp.js               まだ送っていない最新の報告を送り、台帳に送信日時を書く
 *   node send-wp.js --dir <名前>  reports/<名前> を送る（送信済みでももう一度送る）
 *   node send-wp.js --show        送らずに、件名と本文の先頭を画面に出す
 *   node send-wp.js --draft       下書きとして送る（WordPress で見え方を確かめる用）
 *
 * 送る前に、記事から張る PDF と図がリポジトリに実際に上がっているかを確かめる
 * （push される前に送ると、リンク切れの記事が公開される）。--no-check で省略できる。
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const ledgerLib = require('./lib/ledger');
const doc = require('./lib/content');
const { fetchRetry } = require('./lib/http');
const { links } = require('./run');

function argValue(name, argv = process.argv) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

const deps = {
  send: (subject, html) => require('./lib/wordpress').send(subject, html),
  urlOk: async (url) => {
    const res = await fetchRetry(url, { method: 'HEAD', redirect: 'follow' }, { attempts: 3, timeoutMs: 30000 });
    return res.ok;
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms))
};

async function main(argv = process.argv) {
  const has = (f) => argv.includes(f);
  const root = __dirname;
  const ledgerFile = path.join(root, config.paths.ledger);
  const ledger = ledgerLib.load(ledgerFile);

  const dirArg = argValue('--dir', argv);
  const run = dirArg
    ? ledger.runs.find((r) => r.dir === dirArg)
    : ledger.runs.filter((r) => r.status === ledgerLib.STATUS.DONE && !r.wpSentAt).pop();
  if (!run) {
    // 何も送らずに「成功」で終わると、送れたと思い込む。フォルダを指定した・下書きを頼んだときは失敗にする
    const msg = dirArg ? '台帳にその報告がありません: ' + dirArg : '送っていない報告はありません。';
    console.log(msg);
    const err = new Error(msg + (dirArg ? '' : '（フォルダ名を指定すれば、送信済みの報告も送り直せます: --dir <名前>）'));
    err.nothingToSend = true;
    err.mustFail = Boolean(dirArg) || has('--draft');
    if (err.mustFail) throw err;
    return null;
  }

  const file = path.join(root, config.paths.reports, run.dir, 'article-ja.html');
  // --show で見えるものと、実際に送るものを同じにするため、ここでもリンクを外す（送信の直前にも外す）
  let html = doc.sanitizeForWordPress(fs.readFileSync(file, 'utf8'));
  if (html.length < 3000) throw new Error('記事の HTML が短すぎます（' + html.length + ' 字）: ' + file);
  const wp = { ...config.wordpress, draft: config.wordpress.draft || has('--draft') };
  html += '\n' + doc.shortcodes(wp);
  const subject = config.wordpress.titlePrefix + run.titleJa;

  if (has('--show')) {
    console.log('件名: ' + subject + '\n' + html.slice(0, 1500) + '\n…（' + html.length + ' 字）');
    return { subject, html, sent: false };
  }

  if (!has('--no-check')) {
    const l = links(run.dir);
    // push の直後は raw.githubusercontent.com に反映されるまで少しかかる
    for (const url of [l.rawPaperJa, l.rawPaperJa.replace('paper-ja.pdf', 'paper-en.pdf'), l.figure]) {
      let ok = false;
      for (let i = 0; i < 6 && !ok; i++) {
        ok = await deps.urlOk(url).catch(() => false);
        if (!ok) await deps.sleep(10000);
      }
      if (!ok) throw new Error('リポジトリにまだありません（push を確かめてください）: ' + url);
    }
    console.log('PDF と図がリポジトリにあることを確かめました。');
  }

  const sent = await deps.send(subject, html);
  console.log('WordPress に送りました: ' + sent.subject);
  if (!has('--draft')) {
    run.wpSentAt = new Date().toISOString();
    run.wpDraft = Boolean(wp.draft);
    ledgerLib.save(ledgerFile, ledger);
    require('./run').writeIndex(root, ledger);
  }
  return { subject, html, sent: true };
}

if (require.main === module) {
  main().catch((e) => {
    console.error('失敗しました: ' + e.message);
    process.exit(1);
  });
}

module.exports = { main, deps };
