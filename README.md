# SF 資格ロードマップ

Salesforce 認定資格（STEP 1〜5 の 10 資格）を順番に取得するための、個人用の学習サイトです。

公開先: https://musik1207.github.io/sample/ （検索エンジンには載らない設定）

## できること

| 機能 | 内容 |
|---|---|
| ロードマップ | STEP 1〜5 の資格一覧、進捗、受験目標日までの日数、「次にやること」 |
| 資格ページ | 試験の概要、出題範囲と配点、範囲ごとの進捗、受験計画、模擬試験の履歴 |
| レッスン | 出題範囲ごとの解説と、読了チェック |
| 練習問題 | 範囲別・全範囲の演習。回答するとすぐに解説を表示 |
| 模擬試験 | 配点どおりに出題し、本番と同じ時間配分のタイマー付き。範囲別の正答率を表示 |
| 復習 | 間違えた問題が自動で集まり、2 回続けて正解すると外れる |
| 用語集 | 資格をまたいで検索 |
| 記録と設定 | 学習記録の書き出し・読み込み・削除 |

学習記録はブラウザの localStorage にだけ保存され、外部には送信しません。

## 教材の状況

- **Platform Administrator**: レッスン 8 範囲 ＋ オリジナル問題 150 問（2025 年 12 月改定の出題範囲に対応）
- そのほか 9 資格: 試験概要と出題範囲のみ（順次追加）

## 開発

```sh
npm install
npm run dev       # http://localhost:4321/sample/
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
```

### 教材を追加するには

1. `src/data/certs.json` の資格の `status` を `ready` にし、出題範囲と配点を公式ガイドどおりに更新する
2. `src/content/lessons/<資格ID>/<範囲ID>.md` にレッスンを書く
3. `src/data/questions/<資格ID>.json` に問題を追加する
4. `npm run validate && npm run build`

### 社内公開に向けて

教材（Markdown / JSON）と画面を分けてあり、学習記録の保存は `src/lib/storage.ts` の `StorageAdapter` 経由に限定しています。
ログイン付きの社内版にするときは、認証の仕組みを足し、`setStorageAdapter()` でサーバー保存のアダプタに差し替えます。
書き出した学習記録の JSON は、そのまま社内版への移行データとして使えます。

## 注意

練習問題はすべてオリジナルで、実際の試験問題ではありません。試験の最新情報は Trailhead の公式試験ガイドで確認してください。
