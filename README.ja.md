# kuroko 2

[English](README.md) | 日本語

kuroko 2 は、PowerPoint や Execel でコピーした図を PDF として保存する小さなツールです。
論文やスライドの図を、LaTeX などで使う PDF にするために利用できます。

- 使い方
    - **[Web 版を開く](https://shioyadan.github.io/kuroko2/)** — インストールは不要です。
    - [オフライン版をダウンロード](https://shioyadan.github.io/kuroko2/kuroko-latest.zip) — ZIP を展開して `index.html` を開いてください。
        - Overleaf へのアップロード機能を使うためにはオフライン版が必要です。
- 特徴
    - 図形や文字をベクターのまま保存するので、拡大しても鮮明です。影などの効果は画像として保存される場合があります。
    - PDF への変換は手元のブラウザ上に完全に閉じて行い、一切サーバー等と通信しません。
        - Overleaf への送信はローカルで動作する git コマンドを介して行います。この場合のみ、ローカルで立ち上げたサーバーと通信します。


## 使い方

1. Chrome または Edge で [kuroko 2](https://shioyadan.github.io/kuroko2/) を開きます。
2. PowerPoint や Excel で図を選択し、コピーします。
3. kuroko 2 に戻り、Ctrl+V（Mac では ⌘V）を押すか、Paste Objects をクリックします。
4. フォントが不足している場合は、代替フォントのプレビューを確認するか、以降で説明する手順で元のフォントを読み込みます。
5. PDF のプレビューを確認し、Save PDF または Ctrl+S / ⌘S で保存します。


### Overleaf と接続する

ローカルのスクリプトから起動した場合、生成した PDF を Overleaf のプロジェクトにアップロードしたり、プロジェクト内の PDF を取得してプレビュー・ダウンロードしたりできます。
Python 3 と Git が必要です。Windows では WSL から起動してください。この機能は起動スクリプトが表示する URL で使えます。Web 版や、HTML を直接開いた場合は利用できません。

この機能は、ローカルで動作する git コマンドを通じてファイルを操作します。したがって，ローカルで動作する git が Overleaf に可能な状態にしておいてください。以下のようなキャッシュ時間の変更を行うことで，一度認証されたトークンがキャッシュされるようになります。

```
git config --global credential.https://git.overleaf.com.helper 'cache --timeout=28800'
```

## 制約・困ったとき

- Windows から WSL に保存する場合: Chrome のファイルアクセス制限により、保存を確定しても WSL フォルダーへのアクセスが拒否されることがあります。Windows 側のフォルダーに保存して WSL にコピーするか、Download PDF instead を試してください。


## ソースからのビルド

通常は [Web 版](https://shioyadan.github.io/kuroko2/)または[オフライン版](https://shioyadan.github.io/kuroko2/kuroko-latest.zip)をご利用ください。
ビルドや開発については [開発者向け文書](docs/development.md)を参照してください。


## ライセンス

Copyright (C) 2016–2026 Ryota Shioya

[3-Clause BSD License](LICENSE.md) で公開しています。
同梱ライブラリのライセンスは [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) とアプリ内の メニュー → About kuroko 2 → Licenses に記載しています。Microsoft のフォントは同梱していません。
