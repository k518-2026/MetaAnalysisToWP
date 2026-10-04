# MetaAnalysisToWP

小学校・中学校の算数・数学教育と、情報教育の論文を、**週に1回メタ分析**して、
日本語と英語の論文（PDF）と日本語の解説記事を作り、記事を WordPress へメールで投稿する仕組みです。
GitHub Actions だけで動きます。

著者は **教育情報分析研究会（Society for Educational Data Analysis, SEDA）** です。

## できあがるもの

毎週1つテーマを決め、国内外のオープンアクセス論文から5〜10本を集めて効果量を統合します。

| ファイル | 中身 |
|---|---|
| `reports/<日付>-<テーマ>/paper-ja.pdf` | 日本語版の論文。日本教育工学会論文誌のテンプレートの体裁（B5・2段組）。左上の論文種別は「生成AI論文」 |
| `reports/<日付>-<テーマ>/paper-en.pdf` | 英語版の論文（同じ内容）。ITEL のテンプレートの体裁（A4・2段組）。左上は「Generative AI paper」 |
| `reports/<日付>-<テーマ>/article-ja.html` | WordPress に投稿する日本語の記事。両方の PDF へリンクする |
| `reports/<日付>-<テーマ>/studies.csv` | 抽出したデータ（研究ごとの統計量と効果量） |
| `reports/<日付>-<テーマ>/data.json` | 作り直しに使う材料一式（検索の記録、抽出結果、分析結果、文章） |
| `reports/README.md` | これまでの報告の一覧 |

テンプレートの学会誌名・巻号・著作権表示は使っていません（その雑誌に載った論文だと誤解されないように）。
柱や欄外は研究会の表記にしてあります。

## 流れ

1. **テーマを決める** — `config.js` の `themes`（数学12件・情報7件）から、前回と違う分野で、まだ扱っていないものを選ぶ。
   数学は1〜9年生（小学校・中学校）に限定
2. **検索** — OpenAlex（題名と要旨、教育分野、オープンアクセス）と J-STAGE（国内論文）
3. **選別** — 言語モデルが要旨を適格基準に照らして評価する
4. **抽出** — 本文の PDF を文字にし、言語モデルが人数・平均・SD・t・F・r などを抜き出す。
   **抜き出した数値が本文に実際に書かれているかをプログラムで照合し、1つでも見つからない研究は外す**
5. **統合** — 効果量（Hedges の g、または Fisher の z で統合した r）、ランダム効果モデル
   （DerSimonian–Laird 法の τ²、Hartung–Knapp–Sidik–Jonkman 法の信頼区間）、I²、予測区間、学校段階別の分析、比較条件の種類（受動＝介入なし・通常授業、能動＝別の介入）別の分析、
   1研究ずつ除いた感度分析。**計算はすべてプログラムで行い、言語モデルには計算させない**
6. **文章** — 英語版の「はじめに・考察・まとめ」を言語モデルが書き、日本語に訳す（日英で同じ内容にするため）。
   方法と結果の文、表、図、参考文献はプログラムが書く。文献は書誌データから組み立て、言語モデルには書かせない
7. **PDF** — Chrome で HTML から PDF を作る
8. **投稿** — PDF をリポジトリに push し、リンク先が実際に開けることを確かめてから、記事を WordPress へメールで送る

効果量を計算できた研究が5本に満たなければ、そのテーマはあきらめて次のテーマで作り直します（1回に3テーマまで）。

## 設定（最初に1回）

リポジトリの **Settings → Secrets and variables → Actions** に登録します。

| 名前 | 中身 |
|---|---|
| `GEMINI_API_KEY` | Gemini の API キー（選別・抽出・文章） |
| `OPENALEX_API_KEY` | OpenAlex の API キー（無いと混雑時に検索が止まる） |
| `ANTHROPIC_API_KEY` | 任意。Gemini が混雑し続けたときだけ Claude で代わりに書く |
| `WP_POST_EMAIL` | WordPress の「メールで投稿」の秘密のアドレス |
| `SMTP_USER` / `SMTP_PASSWORD` | 送信に使う Gmail のアドレスとアプリパスワード |

**リポジトリは公開にしてください。** 記事の図と PDF へのリンクは GitHub の URL を使うので、非公開だと開けません。

## 動かし方

- **自動**: 毎週日曜 7:00（日本時間）に「Weekly meta-analysis」が動きます
- **手動**: Actions → Weekly meta-analysis → Run workflow。テーマの id を入れると、そのテーマで作ります
- **WordPress だけ送り直す**: Actions → WordPress だけ送る（既定は下書き）

手元では次のように使えます（Node.js 20 以上と pdftotext が必要）。

```bash
npm install
node test.js            # 自己検査（通信と言語モデルは偽物）
node test.js --render   # 本物の Chrome / Edge で PDF を作って .cache/test-render/ に残す（見た目の確認用）
node test.js --live     # OpenAlex と J-STAGE にだけ本物で当てる
node run.js --dry-run --theme math-fraction-instruction   # .cache/dry-run/ に書き出す（台帳は触らない）
node rebuild.js reports/<フォルダ>                        # 書式を直したとき、保存した材料から PDF を作り直す
node send-wp.js --show  # 送る記事の件名と本文を見る
```

## 注意

- 生成 AI による自動の分析です。選別と抽出を人は確認していません。数値は本文との文字列の照合で確かめていますが、
  別の群や別の測定の値を取り違える可能性は残ります（論文の「まとめ」と記事にも書いています）
- 対象はオープンアクセスで本文を取得できた論文だけです
- 査読は受けていません

## ライセンス

MIT（`LICENSE.txt`）
