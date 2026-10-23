# 資格ロードマップ

PMP と Salesforce 認定資格（STEP 1〜6 の 11 資格）を順番に取得するための、個人用の学習サイトです。STEP 1 が PMP、STEP 2〜6 が Salesforce の資格です。

公開先: https://pome-uniikura.github.io/salesforce-learning-hub/ （検索エンジンには載らない設定）

## できること

| 機能 | 内容 |
|---|---|
| ロードマップ | いま取り組む資格と次にやること（読みかけのレッスンを優先）、今日の学習量・連続学習日数・復習待ち、STEP 1〜6 の資格一覧と進捗 |
| 資格ページ | 進み具合と次にやること、苦手な範囲（正答率が合格ライン未満）、受験目標日と 1 日あたりのペース、出題範囲ごとの進捗と正答率、試験の概要、模擬試験の履歴 |
| レッスン | 出題範囲ごとの解説。PC は横に固定の目次（今読んでいる章を強調）、スマホは目次ボタン。読んだ割合のバー、前回の続きから読む、読了後に練習問題へ案内 |
| 練習問題 | 範囲別・全範囲の演習。回答するとすぐに解説を表示。途中で終えて結果を見られる。キーボード操作（1〜9 で選択、Enter で回答・次へ） |
| 模擬試験 | 配点どおりに出題し、本番と同じ時間配分のタイマー付き。範囲別の正答率を表示 |
| 復習 | 間違えた問題が自動で集まり、2 回続けて正解すると外れる。資格ごとにも復習できる |
| 用語集 | 資格をまたいで検索（`/` キーで検索欄へ、検索語は URL に残る） |
| 記録と設定 | テーマ（端末に合わせる／ライト／ダーク）と文字の大きさ、学習記録の書き出し・読み込み・削除 |

スマホではメニューが画面の下に固定され、片手で操作できます。

### iPhone のホーム画面に追加する

Safari でサイトを開き、共有ボタン →「ホーム画面に追加」で、アプリのように全画面で使えます（アイコンは `public/apple-touch-icon.png`、名前は「資格マップ」）。

- 一度開いたページは自動で端末に保存され、電波がなくても開けます。設定ページの「オフライン用に保存」で全ページ（約 8 MB）をまとめて保存できます
- ページは毎回ネットワークで新しい版を確かめるので、デプロイ後もすぐ最新になります
- ホーム画面のアプリと Safari では学習記録が別々に保存されます。設定ページの「記録を引き継ぐ（コピーと貼り付け）」で移せます

学習記録はブラウザの localStorage にだけ保存され、外部には送信しません。表示の設定とレッスンの読みかけ位置は端末ごとの設定として別に保存し、書き出しの対象にはしていません。

## 教材の状況

| 資格 | レッスン | 問題 | 合格ライン | 学習時間の目安 |
|---|---|---|---|---|
| PMP | 3 領域 | 156 問 | 非公開（このサイトでは 70% を目安） | 約 100 時間 |
| Platform Administrator | 8 範囲 | 260 問 | 65% | 約 70 時間 |
| Business Analyst | 6 範囲 | 159 問 | 72% | 約 40 時間 |
| Agentforce Sales Consultant | 5 範囲 | 158 問 | 69% | 約 45 時間 |
| Agentforce Service Consultant | 8 範囲 | 158 問 | 78% | 約 55 時間 |
| Platform Strategy Designer | 4 範囲 | 149 問 | 70% | 約 30 時間 |
| Platform Integration Architect | 6 範囲 | 150 問 | 67% | 約 60 時間 |
| Platform Data Architect | 6 範囲 | 148 問 | 58% | 約 60 時間 |
| Platform Sharing and Visibility Architect | 4 範囲 | 152 問 | 58% | 約 50 時間 |
| Data 360 Consultant | 6 範囲 | 151 問 | 70% | 約 45 時間 |
| Agentforce Specialist | 6 範囲 | 152 問 | 72% | 約 45 時間 |

- PMP の出題範囲・配点・問題数・試験時間・受験資格は、PMI 公式の試験内容の概要（ECO 2026、2026 年 7 月版）と照合済みです（2026 年 10 月 23 日に確認）。受験料は PMI の公式ページを直接確認できなかったため、2026 年 9 月時点の公開情報によります。
- Salesforce の 10 資格の出題範囲・配点・合格ライン・受験料は、Salesforce の公式試験ガイド（2026 年 10 月 17 日に確認）と照合済みです。合格ラインは日本語版がある資格は日本語版の値です。
- 各範囲のレッスンの冒頭に、公式試験ガイドの出題目標（日本語訳）を表示しています。
- 学習時間の目安は資格ごとの想定（前提は各資格ページに記載）で、範囲ごとの時間は配点で割り振っています。全体で約 600 時間です。
- 用語集は 214 語です（PMP の用語 50 語を含む）。

## 開発

```sh
npm install
npm run dev       # http://localhost:4321/salesforce-learning-hub/
npm run validate  # 教材データの整合性チェック
npm run build     # 型チェック + ビルド（dist/）
```

main に push すると GitHub Actions で GitHub Pages に公開されます。

## 構成

```
src/
  data/certs.json            資格・STEP・試験概要・出題範囲と配点
  data/questions/<資格>.json  練習問題（オリジナル）
  data/glossary.json         用語集
  content/lessons/<資格>/<範囲>.md  レッスン
  lib/storage.ts             学習記録の保存（ここだけが保存先を知っている）
  lib/quiz-runner.ts         演習・模擬試験・復習の画面
  pages/                     各ページ
scripts/validate-content.mjs 教材データのチェック
scripts/pwa-manifest.mjs     ビルド後に、オフライン保存の一覧（precache.json）を作る
public/sw.js                 オフライン対応（サービスワーカー）
public/manifest.webmanifest  ホーム画面のアプリの設定
scripts/merge-questions.py  追加の問題を ID を振って統合
```

### 教材を追加するには

1. `src/data/certs.json` の資格の `status` を `ready` にし、出題範囲と配点を公式ガイドどおりに更新する（合格点が公表されていない試験は `passingScore: null` にし、`passingNote` と目安の `targetScore` を書く）
2. `src/content/lessons/<資格ID>/<範囲ID>.md` にレッスンを書く
3. `src/data/questions/<資格ID>.json` に問題を追加する
4. `npm run validate && npm run build`

### 社内公開に向けて

教材（Markdown / JSON）と画面を分けてあり、学習記録の保存は `src/lib/storage.ts` の `StorageAdapter` 経由に限定しています。
ログイン付きの社内版にするときは、認証の仕組みを足し、`setStorageAdapter()` でサーバー保存のアダプタに差し替えます。
書き出した学習記録の JSON は、そのまま社内版への移行データとして使えます。

## 注意

練習問題はすべてオリジナルで、実際の試験問題ではありません。PMP の問題は、本番と同じく「PM として次に何をするか」を問う状況問題です。Salesforce の STEP 2〜3 の資格には、本番の出題形式（Trailhead のサンプル企業を使った状況設定、5 択の「2 つ選択」など）に寄せた問題を追加しています。試験の最新情報は、Salesforce は Trailhead の公式試験ガイド、PMP は PMI の公式情報で確認してください。
