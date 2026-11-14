# Kuroko

[English](README.md) | 日本語

Kuroko は、PowerPoint でコピーした図を PDF として保存する小さなツールです。
論文やスライドの図を、LaTeX などで使う PDF にするために利用できます。

- **[Web 版を開く](https://shioyadan.github.io/kuroko2/)** — インストールは不要です。
- **[オフライン版をダウンロード](https://shioyadan.github.io/kuroko2/kuroko-latest.zip)** — ZIP を展開して `index.html` を開いてください。
- 図形や文字をベクターのまま保存するので、拡大しても鮮明です。影などの効果は画像として保存される場合があります。
- PDF のページサイズはコピーした図のサイズに合わせられます。
- 図とフォントの処理はすべて手元のブラウザで行われ、アップロードされません。

この版は、[従来の Kuroko](https://github.com/shioyadan/kuroko) をブラウザで使えるようにしたものです。Electron や「Microsoft Print to PDF」プリンターは不要です。

## 使い方

1. Chrome または Edge で [Kuroko](https://shioyadan.github.io/kuroko2/) を開きます。
2. PowerPoint で図を選択し、コピーします。
3. Kuroko に戻り、**Ctrl+V**（Mac では **⌘V**）を押すか、**Paste Objects** をクリックします。
4. フォントが不足している場合は、下記の手順で読み込みます。
5. PDF のプレビューを確認し、**Save PDF** または **Ctrl+S / ⌘S** で保存します。

**Auto Capture on Focus** をオンにすると、Kuroko のウィンドウに戻ったときに自動で貼り付けます。
SVG ファイルを直接開くことや、ウィンドウへドラッグ＆ドロップすることもできます。

### フォントの読み込み

図と同じ書体を PDF に使うため、初回にフォントの読み込みが必要になる場合があります。

- **Use Local Fonts** をクリックし、ブラウザのフォントへのアクセスを許可してください。
- 自動取得できない場合は、**Select Font Files…** で必要な TTF・OTF・TTC ファイルを選択してください。Windows のフォントは通常 `C:\Windows\Fonts` にあります。
- Aptos などの Office フォントが見つからない場合は、**Fonts → Office CloudFonts…** から `%LOCALAPPDATA%\Microsoft\FontCache` 内の `CloudFonts` フォルダーを選択してください。

不足フォントを読み込むと、自動的に PDF を作成します。「SVG preview · PDF pending」と表示されている間は、まだ PDF ができていません。読み込んだ図とフォントは、ページを閉じるか再読み込みするまで保持されます。

## 制約・困ったとき

- **貼り付けできない場合:** PowerPoint が SVG を提供するコピー内容に対応しています。コピーする図の選択を確認し、コピーし直してください。EMF や PNG だけのコピー内容には対応していません。SVG として保存して開く方法も使えます。
- **アクセス許可を求められる場合:** クリップボードやフォントの読み取りには、ブラウザの許可が必要です。オフライン版で制限される場合は、[Web 版](https://shioyadan.github.io/kuroko2/)を使うか、SVG とフォントのファイルを直接選択してください。
- **保存できない場合:** 必要なフォントや文字が不足している場合、またはフォントの埋め込みが禁止されている場合は、PDF の作成を停止します。画面のメッセージと **Log** を確認してください。
- **保存ダイアログが出ない場合:** ブラウザによっては PDF をダウンロードします。ブラウザのダウンロード先を確認してください。
- 一部の SVG の効果や書体指定には対応していません。保存前にプレビューを確認してください。SVG に含まれる余白は、そのまま PDF に残ります。

## ソースからのビルド

通常は [Web 版](https://shioyadan.github.io/kuroko2/)または[オフライン版](https://shioyadan.github.io/kuroko2/kuroko-latest.zip)をご利用ください。
ビルドや開発については [開発者向け文書](docs/development.md)を参照してください。

## ライセンス

Copyright (C) 2016–2026 Ryota Shioya

[3-Clause BSD License](LICENSE.md) で公開しています。
同梱ライブラリのライセンスは [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) とアプリ内の **About Kuroko → Licenses** に記載しています。Microsoft のフォントは同梱していません。
