# 黒板 デプロイ手順チェックリスト

実際のデプロイは Claude と一緒に進める。これはその時の進行表。

---

## 事前準備（すでに済み）

- [x] `blackboard/index.html` 本体ページ
- [x] `blackboard/past/index.html` 引き出しページ
- [x] `blackboard/posts.json` 種データ
- [x] `blackboard/apps-script/Code.gs` Apps Script ソース
- [x] `blackboard/scripts/process.mjs` 整理スクリプト
- [x] `.github/workflows/blackboard-tick.yml` cron 定義

---

## デプロイ当日の手順

### 1. Google スプレッドシート作成

- [ ] sakura.dev.jp@gmail.com で `script.google.com` を開く
- [ ] 新規プロジェクト作成、名前「黒板」
- [ ] 紐づけ用スプレッドシートを新規作成（プロジェクトメニューから）
- [ ] Apps Script エディタで `Code.gs` の中身を `blackboard/apps-script/Code.gs` の内容に置換

### 2. シークレット生成

- [ ] `DUMP_SECRET` をランダム32〜64文字で生成（後で2箇所に貼る）
  - 例: ブラウザの DevTools コンソールで `crypto.randomUUID() + crypto.randomUUID()`

### 3. Apps Script のスクリプトプロパティ設定

- [ ] エディタ左の「プロジェクトの設定」→「スクリプト プロパティ」
- [ ] `DUMP_SECRET` = 上で生成した値

### 4. ウェブアプリとしてデプロイ

- [ ] 右上「デプロイ」→「新しいデプロイ」→「ウェブアプリ」
- [ ] 説明: 「黒板 v1」
- [ ] 実行ユーザー: 「自分（sakura.dev.jp@gmail.com）」
- [ ] アクセスできるユーザー: 「全員」
- [ ] デプロイ → 認可 → URL コピー（`https://script.google.com/macros/s/.../exec`）

### 5. GitHub リポジトリの Secrets 設定

リポジトリ: `sakuradevjp/old-clock-calendar-notes`

- [ ] Settings → Secrets and variables → Actions → New repository secret
- [ ] `BLACKBOARD_APPS_SCRIPT_URL` = ステップ4のURL
- [ ] `BLACKBOARD_DUMP_SECRET` = ステップ2の値

### 6. index.html の URL 差し替え

- [ ] `blackboard/index.html` と `blackboard/past/index.html` の
      `const APPS_SCRIPT_URL = "<<...>>"` の部分を実URLに置換
- [ ] commit & push

### 7. Actions の動作確認

- [ ] GitHub Actions タブで `Blackboard tick` を手動実行（workflow_dispatch）
- [ ] 成功すれば `posts.json` が更新される（最初は空配列になるはず）

### 8. 種データを Spreadsheet に投入

- [ ] ブラウザで本体ページを開いて、5件くらい「そっと置く」を押す
  - または、Spreadsheet に直接行を追加（publishAt は過去日にすると即時公開）
- [ ] 翌朝6時、または publishAt を過去にして cron 待ち

### 9. 動作確認

- [ ] 「そっと置く」→ Spreadsheet に行が増える
- [ ] 「あなたが昨夜置いたもの」セクションに自分の保留中投稿が出る
- [ ] 「うなずく」「よくないね」がカウントされる
- [ ] 5分後、cron が走って posts.json 更新
- [ ] 過去ページで「月でたどる」「あなたの過去」が動く

---

## トラブル時のチェック

- Apps Script の実行ログ: エディタ左下「実行数」
- GitHub Actions のログ: リポジトリ → Actions タブ
- ブラウザ: DevTools → Network タブで fetch がCORSで弾かれてないか
- CORS が出る場合: Apps Script を再デプロイ（バージョンを上げる）
