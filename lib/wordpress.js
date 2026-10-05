/**
 * WordPress.com のメール投稿
 *
 * 件名がそのまま記事タイトル、本文が記事本文になる。カテゴリや公開状態は
 * 本文末尾のショートコード（[category] [tags] [publicize off] [end]）で指定する。
 *
 * 注意（paper-to-zenn/datasci で確かめたこと）:
 *   ・本文に `<hr>` や `--` を入れない。署名とみなされ、それ以降が記事から消える
 *   ・4バイト文字（絵文字）は化けるので送る前に落とす（content.stripAstral）
 *   ・**リンク（<a>）は送る前にすべて外す**。DOI は「DOI: 10.xxxx/...」の文字にする（WordPress の不正検知を避けるため。content.sanitizeForWordPress）
 *   ・記事の URL は返ってこない。確かめたいときはブログの RSS で探す
 *
 * 必要な環境変数:
 *   WP_POST_EMAIL … 設定 → 執筆 → メール投稿 の秘密のアドレス
 *   SMTP_USER     … 送信元（Gmail なら自分のアドレス）
 *   SMTP_PASSWORD … Gmail はアプリパスワード
 *   SMTP_HOST / SMTP_PORT … 任意。既定は Gmail（smtp.gmail.com:465）
 */
const config = require('../config');
const { stripAstral, sanitizeForWordPress } = require('./content');

/** テストが差し替えられるように、送信の口を分けてある */
function createTransport() {
  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
  });
}

function missing() {
  return ['WP_POST_EMAIL', 'SMTP_USER', 'SMTP_PASSWORD'].filter((k) => !(process.env[k] || '').trim());
}

/** 記事をメールで送る。送れたら件名を返す */
async function send(subject, html) {
  const lack = missing();
  if (lack.length) throw new Error(lack.join(' / ') + ' が設定されていません');
  const clean = stripAstral(subject);
  // 作る側でもリンクを作らないが、過去の報告の記事ファイルなどに残っていても、ここで必ず外す
  const links = (String(html).match(/<a\b/gi) || []).length;
  const body = sanitizeForWordPress(html);
  if (links) console.warn(`  記事にリンクが ${links} 件残っていたので、送る前に外しました。`);
  const info = await module.exports.createTransport().sendMail({
    from: '"' + config.wordpress.senderName + '" <' + process.env.SMTP_USER + '>',
    to: process.env.WP_POST_EMAIL,
    subject: clean,
    text: 'このメールはHTMLで作成されています。',
    html: body
  });
  return { subject: clean, messageId: (info || {}).messageId || '' };
}

module.exports = { send, createTransport, missing };
