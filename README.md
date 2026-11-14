# Kuroko

PowerPoint でコピーした図の SVG を受け取り、図と同じサイズのベクター PDF として保存するツールです。React ベースのブラウザアプリで、配布物は **`index.html` 1 ファイル**です。Electron、プリンター、外部 CDN は不要です。図とフォントはブラウザ内で処理し、サーバーへ送信しません。

## 使い方

1. `dist-web/index.html` を Chrome / Edge で開きます。
2. PowerPoint で図を選択してコピーし、Kuroko で **Ctrl+V / ⌘V**、または **Paste Objects** を押します。
3. フォントが不足している場合は **Use Local Fonts** でアクセスを許可するか、**Select Font Files…** で TTF / OTF / TTC を選択します。
4. 生成された PDF のプレビューを確認し、**Save PDF / Ctrl+S / ⌘S** で保存します。

暗いツールバー、灰色のプレビュー領域、貼り付け・保存・フォーカス時の自動取得は従来の Kuroko に準じています。下部にはファイル名、ズーム、寸法、状態表示と、Konata と同様のコピー・クリア・サイズ変更ができるログペーンがあります。

- **Auto Capture on Focus**: ウィンドウへ戻ったときにクリップボードを読み取ります。既定ではオフです。同じ SVG は再変換せず、読み取りに失敗した場合は自動取得をオフにします。
- **Open SVG / ドラッグ＆ドロップ**: クリップボードから取得できない環境でも SVG ファイルを読み込めます。
- **Fonts**: 読み込み済み書体と不足書体を確認できます。Aptos などは **Office CloudFonts…** から `%LOCALAPPDATA%\Microsoft\FontCache` 内の `CloudFonts` フォルダーを選択できます。数値名のファイルも内部の書体名から判定します。
- **View source SVG**: 加工前の SVG を確認・保存できます。
- **About Kuroko**: バージョン、ビルド情報、同梱ライセンスを確認できます。

プレビューが「SVG preview · PDF pending」の間は、PDF はまだ作成されていません。不足フォントを読み込むと自動的に変換を再開します。フォントと図はセッション中だけ保持します。

### ブラウザとアクセス許可

配布 HTML 自体は `file://` からオフラインで動作します。ただし Clipboard API、Local Font Access API、保存ダイアログの利用可否はブラウザ・起動元・権限に依存します。クリップボードやローカルフォントの読み取りが制限される場合は、下記の localhost 起動を使ってください。通常の貼り付け、SVG ファイル選択、フォントファイル選択も用意しています。

保存ダイアログに対応しないブラウザでは、PDF をダウンロードします。実際の保存先や同名ファイルの扱いはブラウザ設定に従います。PowerPoint が SVG を提供しないコピー内容を EMF / PNG から変換する機能はありません。

## 開発・ビルド

Node.js **22.12 以降**と npm を使用します。

```sh
npm ci
make production
# 成果物: dist-web/index.html
```

```sh
make serve       # 開発サーバー http://127.0.0.1:8080
./kuroko.sh      # ビルド済みの HTML だけを http://127.0.0.1:30080 で配信
```

`KUROKO_PORT` で配信ポートを変更できます。`kuroko.sh` は Python 3 を使います。Windows では `py -m http.server 30080 --bind 127.0.0.1 --directory dist-web` でも起動できます。

### 検証

```sh
npx playwright-core install chromium
make check
```

`make check` は型検査、変換の基礎処理のテスト、production ビルド、単一 HTML 検査、実ブラウザ試験を順番に実行します。Linux では Chromium に必要な共有ライブラリと DejaVu Sans が必要です。既存ブラウザを使う場合は `CHROMIUM_PATH`、テスト用 DejaVu Sans のパスを変える場合は `TEST_FONT_PATH` を指定します。

```sh
CHROMIUM_PATH=/path/to/chrome make check
```

ブラウザ試験は `file://` で起動し、外部 HTTP リクエストがないこと、SVG の各貼り付け経路、ベクター PDF の寸法、文字の埋め込みと抽出、フォント不足、Office の影、処理の差し替え、ログ、狭い画面の表示を確認します。生成した PDF とスクリーンショットは `work/` に保存します。Windows の PowerPoint からの実クリップボード操作や OS の権限ダイアログは別途実機確認が必要です。

## 構成

Konata に合わせ、UI は React / TypeScript、状態と非同期処理は同期 `dispatch()` を入口に持つ Store に集約しています。React は `useSyncExternalStore()` で immutable snapshot を購読します。

| 場所 | 役割 |
| --- | --- |
| `src/app.tsx`, `src/components/` | ツールバー、プレビュー、ダイアログ、ログペーン |
| `src/store.ts` | アクション、状態、取り込み・フォント解決・変換・保存の制御 |
| `src/core/clipboard.ts` | paste イベント、Clipboard API、UTF-8 / UTF-16 |
| `src/core/svg.ts` | SVG の検査、サニタイズ、寸法と要求フォントの抽出 |
| `src/core/fonts.ts` | SFNT / TTC の解析、埋め込み条件、重複排除、文字の収録確認 |
| `src/core/effects.ts` | PowerPoint の影を 150 dpi の透明画像へ置換 |
| `src/core/conversion_worker.ts` | krilla-svg WASM による PDF 作成 |
| `src/core/pdf_preview.ts`, `src/core/pdf_preview_worker.ts` | 生成済み PDF を PDFium でプレビュー |
| `src/file_access.ts` | 保存ダイアログとダウンロード |
| `vendor/krilla-wasm/` | 実験で検証済みの WASM、Rust ソース、Cargo.lock |

WASM、変換 Worker、PDFium の描画 Worker、CSS、ライセンス文書は Webpack で HTML 内に埋め込みます。Worker はキャンセル・終了・タイムアウト時に破棄します。古い非同期処理の結果は request ID で無効化します。

krilla が反復グラデーションに使う PDF の Type 1 shading を正しく表示するため、プレビューには PDFium を採用しています。PDF.js は文字抽出を検証するテストでのみ使用します。

`work/`、ログ、生成物、`node_modules/` は Git 管理対象外です。作業方針用の `AGENTS.md` も `work/` に置き、リポジトリへ追加しません。

## 対応範囲

- 図形、線、グラデーション、テキストはベクターで出力します。PowerPoint 特有の影のみ画像化し、元の重なり順を保持します。
- SVG の `px` は 96 dpi、PDF の `pt` は 72 dpi として寸法を変換します。ページサイズは SVG の寸法です。SVG 内の余白を内容の外接矩形へ自動トリミングする機能はありません。
- SVG の要素と属性は許可リストで検査し、スクリプト、イベント属性、外部参照、再帰 SVG 画像を除去します。削除した要素はログに記録します。
- インライン style と presentation attribute に対応します。`<style>` スタイルシート、相対フォントウェイト、`font-stretch`、影の中のテキストは明示的にエラーにします。
- 不足書体、未収録文字、埋め込み禁止・サブセット禁止・bitmap-only フォントでは出力を停止します。可変フォントの軸指定や暗黙の CJK フォントフォールバックには対応していません。
- 入力 SVG は 20 MiB / 30,000 要素まで。巨大なページ、影、フォントにも処理量の制限があります。WASM 変換は 30 秒でタイムアウトします。
- PPT の影以外の一般的な SVG フィルターは krilla-svg 側で処理されます。SVG / PDF の仕様全体の互換性を保証するものではありません。

## ライセンス

[BSD 3-Clause](LICENSE.md)。同梱依存の通知は [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) と HTML 内に含まれます。Microsoft フォントは同梱しません。

依存を更新した際は `python3 tools/generate_licenses.py` で通知を再生成できます。この操作はロックされた Rust クレートのアーカイブを取得し、Cargo.lock の SHA-256 と照合します。通常のビルドではネットワーク取得しません。
