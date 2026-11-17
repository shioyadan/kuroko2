# kuroko 2

[English](README.md) | 日本語

kuroko 2 は、PowerPoint や Execel でコピーした図を PDF として保存する小さなツールです。
論文やスライドの図を、LaTeX などで使う PDF にするために利用できます。

- 使い方
    - **[Web 版を開く](https://shioyadan.github.io/kuroko2/)** — インストールは不要です。
    - [オフライン版をダウンロード](https://shioyadan.github.io/kuroko2/kuroko-latest.zip) — ZIP を展開して `index.html` を開いてください。
- 特徴
    - 図形や文字をベクターのまま保存するので、拡大しても鮮明です。影などの効果は画像として保存される場合があります。
    - PDF のページサイズはコピーした図のサイズに合わせられます。
    - PDF への変換は手元のブラウザ上で行います。Overleaf への送信は、アップロードを選んだ場合だけ行います。
    - これは、[従来の Kuroko](https://github.com/shioyadan/kuroko) をブラウザで使えるようにしたものです。Electron や「Microsoft Print to PDF」プリンターは不要です。


## 使い方

1. Chrome または Edge で [kuroko 2](https://shioyadan.github.io/kuroko2/) を開きます。
2. PowerPoint や Excel で図を選択し、コピーします。
3. kuroko 2 に戻り、Ctrl+V（Mac では ⌘V）を押すか、Paste Objects をクリックします。
4. フォントが不足している場合は、代替フォントのプレビューを確認するか、以降で説明する手順で元のフォントを読み込みます。
5. PDF のプレビューを確認し、Save PDF または Ctrl+S / ⌘S で保存します。

ファイル名はメニュー左側で編集できます。Fit to window とプレビュー倍率の選択も上部ツールバーにあります。

SVG ファイルを直接開くことや、ウィンドウへドラッグ＆ドロップすることもできます。右上のメニュー（☰）には Open SVG、Fonts、View source SVG、Save history、Overleaf、About kuroko 2 をまとめています。
クリップボードの読み取り・PDF 作成・プレビュー描画の進捗は、ツールバー右上に表示します。横の × で処理をキャンセルできます。


### フォントの読み込み

図に必要なフォントは、貼り付けたときに自動で読み込みます。初回にブラウザからフォントへのアクセスを求められたら、許可してください。許可後は、ページの再読み込み後も自動で取得します。

元のフォントが不足している場合は、PC 内の Arial や Times New Roman などから代替フォントを探し、PDF を作成します。ツールバーの下に、足りないフォントを赤いメッセージで表示します。そのまま保存できますが、元の図とは文字の形・幅・配置が変わる場合があります。元のフォントを読み込むには、メッセージ内の Add fonts… をクリックしてください。メニュー → Fonts からも同じ案内を開けます。

- 許可が必要な場合は Allow font access をクリックします。アクセスがブロックされている場合や自動取得に対応していない場合は、フォルダー選択へ案内します。
- Choose font folder… でフォルダーを選ぶと、その中とサブフォルダーから不足フォントを探します。Aptos などの Office フォントは `C:\Users\<ユーザー名>\AppData\Local\Microsoft\FontCache` 内の `CloudFonts` フォルダーを選択してください。`<ユーザー名>` は、Windows のユーザーフォルダー名に置き換えてください。通常のフォントは `C:\Windows\Fonts` にあります。
- TTF・OTF・TTC・OTC ファイルを直接選ぶ場合は、Choose individual font files instead を開いてください。許可の案内が表示されている場合は、先に Add fonts from a folder or files instead を開きます。

使用できる代替フォントも読み込めない場合は、同じ案内画面からローカルフォントへのアクセスを許可するか、フォントファイルを選択してください。kuroko 2 にフォントは同梱していません。

フォントを追加すると自動で PDF を作り直します。元のフォントがすべて揃い、PDF ができると警告が消えて案内画面が閉じます。許可の確認を閉じても、貼り付けるたびに繰り返し表示しません。再試行する場合は Add fonts… から進んでください。

Cambria Math の太字が必要な場合、太字のフォントがなければ通常版から自動で合成します。フォント欄には Synthesized bold と表示されます。Windows の描画に近づけるよう調整しており、追加のフォントファイルは不要です。

「SVG preview · PDF pending」と表示されている間は、まだ PDF ができていません。読み込んだ図とフォントは、ページを閉じるか再読み込みするまで保持されます。ローカルフォントへのアクセスが許可されていれば、再読み込み後に必要なフォントを再取得します。手動で選んだフォントファイルやフォルダーは、再読み込み後に選び直してください。保存履歴には、名前・プレビュー・保存先を別途この端末内に記憶します。


### 似た図を編集して繰り返し保存する

最初の図を好きな PDF ファイル名で保存してください。少し編集した図を貼り付けると、PDF の作成後に保存履歴と比較し、似た図のファイル名を自動で提案します。前回と今回のプレビューを確認して、次のいずれかを選べます。

- Overwrite PDF: 前回の保存先を再利用できる場合、そのファイルに上書きします。確認するまでは書き換えません。
- Save with this name: 保存先を再利用できない場合、候補名で保存ダイアログを開くか、新しいコピーをダウンロードします。
- Save as…: 別の名前・保存先を選択します。Not now は保存せずに閉じます。

Chrome・Edge の保存ダイアログは、直近に保存が成功した PDF のフォルダーから開きます。保存先が履歴に残っていれば、ページを再読み込みした後も復元します。フォルダーを別途選択する必要はありません。Previously saved のプレビューは最大 1200×900 ピクセルで記憶します。以前の履歴の画質は、その図を再度保存したときに更新されます。

メニュー → Save history から履歴の削除や、自動提案のオン・オフを切り替えられます。この機能で保存した直近 30 件を記憶する方式で、PC 内の既存 PDF を自動で探すものではありません。履歴を削除しても PDF ファイルは削除されません。履歴はブラウザとサイトごとに、この端末内だけに保存されます。
ダウンロード方式のブラウザでは、以前のファイルへの自動上書きやダウンロード完了の確認はできず、同名ファイルの扱いはブラウザに従います。


### Overleaf と接続する

ローカル起動では、生成した PDF を Overleaf のプロジェクトにアップロードしたり、プロジェクト内の PDF を取得してプレビュー・ダウンロードしたりできます。Python 3 と Git が必要です。Windows では WSL から起動してください。この機能は起動スクリプトが表示する URL で使えます。Web 版や、HTML を直接開いた場合は利用できません。

1. Overleaf のプロジェクトで Git 接続を利用できることを確認し、起動元で使う Git の認証を設定します。Overleaf は HTTPS 接続で、ユーザー名 `git` と Git 認証トークンを使います。SSH 鍵や `ssh-add` は使いません。[Overleaf の認証ガイド](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration/git-integration-authentication-tokens)に従って Git の credential helper を設定し、`git ls-remote <Git URL>` が入力を求めずに成功する状態にしてください。Git 接続には[対応する Overleaf のプラン](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration)が必要です。
2. オフライン版の ZIP を展開し、そのフォルダーで `./kuroko2.sh` を実行します。表示された URL（通常は `http://127.0.0.1:30080/`）を開きます。
3. メニュー → Overleaf でプロジェクトの Git URL を入力し、Connect をクリックします。`https://git.overleaf.com/<project-id>` のような URL だけを入力し、トークンは含めないでください。
4. 一覧で PDF を選ぶと、最初のページをプレビューできます。Download PDF でダウンロードできます。生成した図をアップロードする場合は `figures/figure.pdf` のようなプロジェクト内の相対パスを入力し、Upload PDF をクリックします。一覧で既存の PDF を選ぶと、そのパスを再利用できます。上書きする場合は Replace PDF で確認します。

アップロード時は、指定した PDF だけを変更してコミット・push します。選択後に Overleaf 側で同じファイルが変更されていた場合は、更新後の PDF を確認してから再度確定してください。PDF のバイト列が同じなら新たなコミットは作りません。Refresh でプロジェクトの最新状態を取得できます。アップロードは、ローカル保存の Save history とは別に扱います。

プロジェクト内の PDF をプレビューしても、貼り付けた図は保持されます。一覧に出るのはプロジェクトに保存された PDF で、Overleaf がコンパイルした論文 PDF は含みません。起動スクリプトが動いている間は、ブラウザを再読み込みしても接続を復元できます。Disconnect またはスクリプトの終了で、一時的なローカル clone を削除します。認証情報は Git が管理し、HTML には入力・保存しません。


## 制約・困ったとき

- 貼り付けできない場合: PowerPoint が SVG を提供するコピー内容に対応しています。コピーする図の選択を確認し、コピーし直してください。EMF や PNG だけのコピー内容には対応していません。SVG として保存して開く方法も使えます。
- アクセス許可を求められる場合: クリップボードやフォントの読み取りには、ブラウザの許可が必要です。オフライン版で制限される場合は、[Web 版](https://shioyadan.github.io/kuroko2/)を使うか、SVG とフォントのファイルを直接選択してください。
- 保存できない場合: 不足フォントには代替フォントを使いますが、選択したフォントや代替フォントに必要な文字が含まれていない場合は、PDF の作成を停止します。埋め込みが禁止されたフォントは使用できません。画面のメッセージと Log を確認してください。選択したファイルへの書き込みに失敗した場合は、エラー表示内の Download PDF instead から、ブラウザのダウンロードで新しいコピーを保存できます。
- 保存ダイアログが出ない場合: ブラウザによっては PDF をダウンロードします。ブラウザのダウンロード先を確認してください。
- Windows から WSL に保存する場合: Chrome のファイルアクセス制限により、保存を確定しても WSL フォルダーへのアクセスが拒否されることがあります。Windows 側のフォルダーに保存して WSL にコピーするか、Download PDF instead を試してください。[Chromium の報告](https://issues.chromium.org/issues/553114097)も参照してください。
- 一部の SVG の効果や書体指定には対応していません。保存前にプレビューを確認してください。SVG に含まれる余白は、そのまま PDF に残ります。


## ソースからのビルド

通常は [Web 版](https://shioyadan.github.io/kuroko2/)または[オフライン版](https://shioyadan.github.io/kuroko2/kuroko-latest.zip)をご利用ください。
ビルドや開発については [開発者向け文書](docs/development.md)を参照してください。


## ライセンス

Copyright (C) 2016–2026 Ryota Shioya

[3-Clause BSD License](LICENSE.md) で公開しています。
同梱ライブラリのライセンスは [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) とアプリ内の メニュー → About kuroko 2 → Licenses に記載しています。Microsoft のフォントは同梱していません。
