# kuroko 2

English | [日本語](README.ja.md)

kuroko 2 is a small tool for saving figures copied from PowerPoint or Excel as PDF files.
A typical use is preparing figures for LaTeX papers and presentations.

- Getting started
    - **[Open the web app](https://shioyadan.github.io/kuroko2/)** — no installation required.
    - [Download the offline app](https://shioyadan.github.io/kuroko2/kuroko-latest.zip) — extract the ZIP and open `index.html`.
- Features
    - Shapes and text stay sharp as vectors. Effects such as shadows may be saved as images.
    - Each PDF page is sized to fit the copied figure.
    - PDF conversion happens locally in your browser. PDFs are sent to Overleaf only when you choose to upload them.
    - This is a browser-based successor to the [original Kuroko](https://github.com/shioyadan/kuroko). It does not require Electron or the Microsoft Print to PDF printer.


## How to use

1. Open [kuroko 2](https://shioyadan.github.io/kuroko2/) in Chrome or Edge.
2. Select and copy a figure in PowerPoint or Excel.
3. Return to kuroko 2 and press Ctrl+V (⌘V on Mac), or click Paste Objects.
4. If fonts are missing, check the substitute-font preview or load the originals as described below.
5. Check the PDF preview, then click Save PDF or press Ctrl+S / ⌘S.

The file name is editable just to the left of the menu. Fit to window and the preview zoom selector are also in the top toolbar.

You can open an SVG file directly or drag it into the window. The menu (☰) at the
top right contains Open SVG, Fonts, View source SVG, Save history, Overleaf and About kuroko 2.
Clipboard reading, PDF creation and preview rendering progress appear at the top
right of the toolbar. Use the × beside the progress message to cancel.


### Loading fonts

The fonts needed by your figure are loaded automatically when you paste it. On
first use, allow the browser to access your fonts if asked. Granted fonts are also
loaded automatically after a page reload.

If original fonts are missing, kuroko 2 looks for substitute fonts on your
computer, such as Arial or Times New Roman, and uses them to create the PDF. A red
message below the toolbar lists the missing fonts. You can save this PDF, but
letter shapes, spacing and layout may differ from the original. Click
Add fonts… in the message to load the originals. Menu → Fonts opens the same guide.

- If permission is needed, click Allow font access. If access is blocked or unavailable, the guide offers folder selection.
- Click Choose font folder… to find the missing fonts in that folder and its subfolders. For Office fonts such as Aptos, select the `CloudFonts` folder under `C:\Users\<username>\AppData\Local\Microsoft\FontCache`. Replace `<username>` with your Windows user folder name. Other installed fonts are usually in `C:\Windows\Fonts`.
- To select TTF, OTF, TTC or OTC files directly, expand Choose individual font files instead. If the guide is asking for permission, expand Add fonts from a folder or files instead first.

If no usable substitute can be loaded, allow local font access or select font
files in the same guide. Fonts are not bundled with kuroko 2.

Adding fonts automatically recreates the PDF. Once all original fonts are loaded
and the PDF is ready, the warning disappears and the guide closes. Closing a
permission prompt does not make it appear on every paste; use Add fonts… to retry.

Cambria Math bold is generated automatically from its regular font when no bold
face is available. The font guide shows Synthesized bold. Its appearance is
adjusted to approximate Windows rendering; no extra font file is needed.

While the preview says
“SVG preview · PDF pending,” the PDF is not ready yet. Loaded figures and fonts are kept only
until you close or reload the page; local fonts are loaded again automatically while access remains allowed. Manually selected font files and folders need to be selected again after a reload. Save history separately remembers names, previews and save destinations on this device.


### Editing and saving similar figures

Save a figure once with your chosen PDF name. When you paste a slightly edited
version, kuroko 2 compares it with your recent saves and automatically suggests a
name after the PDF is ready. Check the previous and current previews, then choose:

- Overwrite PDF to save to the previously selected file, when the browser can reuse that destination. Nothing is overwritten until you confirm.
- Save with this name when the previous destination is unavailable. The browser opens a save dialog or downloads a new copy.
- Save as… to choose a different name or destination, or Not now to continue without saving.

In Chrome and Edge, the save dialog starts in the folder of the last successfully
saved PDF, including after a reload when that destination is in your history.
No separate folder selection is needed. The Previously saved preview is stored
at up to 1200×900 pixels; older history entries gain the improved resolution when
you save them again.

Menu → Save history lets you forget entries, clear history, or turn off
automatic suggestions. It remembers up to 30 recent saves made with this feature;
it does not scan existing PDFs on your computer. Clearing history does not delete
PDF files. History is specific to the browser and site, and stays on your device.
In browsers that only download files, kuroko 2 cannot overwrite an earlier download
or know whether the download finished; the browser controls duplicate names.


### Using Overleaf

The local launcher can upload your generated PDF to an Overleaf project, or
download and preview PDFs already stored there. It requires Python 3 and Git;
on Windows, run it in WSL. This feature is available from the launcher's URL,
not from the hosted web app or an HTML file opened directly.

1. Enable Git access for your Overleaf project and configure authentication in the
   Git installation used by the launcher. Overleaf uses HTTPS with the username
   `git` and a Git authentication token; SSH keys and `ssh-add` are not used.
   Follow [Overleaf's authentication guide](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration/git-integration-authentication-tokens)
   to set up a Git credential helper. Confirm that `git ls-remote <Git URL>` works
   without prompting before connecting from kuroko 2. Git access requires an
   [eligible Overleaf plan](https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git-integration).
2. Extract the offline ZIP and run `./kuroko2.sh` from its folder. Keep
   `kuroko2.sh` and `index.html` together; the server is included in the script.
   Open the printed URL, normally `http://127.0.0.1:30080/`. If that port is
   occupied, it uses the next available port and prints the new URL.
3. Paste a figure and click Upload to Overleaf beside Save PDF. This button
   appears when the local launcher is available. If you are not connected, select
   a recent project or enter its Git URL and click Connect. Enter only the URL,
   such as `https://git.overleaf.com/<project-id>`, without a token.
4. Choose a folder and file name in the save dialog, check the preview, then click
   Upload PDF. Figure to upload always shows your current figure on the left.
   Selecting an existing PDF fills in its name and shows its first page on the
   right, under Currently in Overleaf. New destinations show Save as a new file.
   Replace PDF asks you to confirm with both previews in the same positions. The dialog closes
   after a successful upload. You can also enter a relative path such as
   `new-folder/figure.pdf` to create a new destination.

The last 10 successfully connected project URLs are remembered in this browser.
In Recent projects, click Name to give a project a display name, then Save name.
Rename changes it; saving an empty name returns to displaying the URL alone.
Names also appear while connected and are kept when you reopen the app. They do
not rename the project on Overleaf. Forget URL removes the entry from this list.
Connecting to a project still requires your click.
If the launcher uses a different port, that address has separate browser history.

After you upload a figure, the next similar figure can suggest the same destination
when you open Upload to Overleaf. The dialog shows the full path and a previous
preview, and you can choose another folder or name. Suggestions use the last 30
uploads, scoped to the connected project. Files changed or deleted on Overleaf
are excluded. Only paths, figure descriptors and previews are remembered, not full
PDFs or tokens. Storage is separate from local Save history and belongs to this
browser and site. If browser storage is unavailable, history lasts for this session.

Each upload commits and pushes only the chosen PDF. If the destination changed
on Overleaf after you selected it, review the updated PDF and confirm again.
Identical PDF bytes do not create another commit. Refresh retrieves the latest
project files. Menu → Overleaf also opens the project browser, where Download PDF
saves the selected project PDF locally.

The current pasted figure stays available while you preview a project PDF.
Only PDFs stored in the project are listed; Overleaf's compiled document is not
included. Connection state survives a browser reload while the launcher is
running. Change project or stop the launcher to remove its temporary local clone.
Credentials remain managed by Git, and are not entered or stored in the HTML app.

If a normal Overleaf fetch works but kuroko 2 cannot connect, restart the launcher
with `KUROKO_DEBUG=1 ./kuroko2.sh` and try Connect again. The terminal shows Git
commands, working directories, exit codes and error messages. Credential-bearing
URLs and headers are masked; PDF contents and Git configuration values are omitted.
The launcher inherits configured Git credential helpers and `GIT_ASKPASS`.
Settings stored only in an existing repository's `.git/config` do not apply to
kuroko 2's temporary clone.


## Known limitations and troubleshooting

- Cannot paste: the copied content must include SVG. Check the selected objects and copy them again in PowerPoint. Clipboard content containing only EMF or PNG is not supported. You can also save the figure as SVG and open that file.
- Permission prompts: clipboard and local font access require browser permission. If the offline app restricts these features, use the [web app](https://shioyadan.github.io/kuroko2/) or select SVG and font files directly.
- Cannot save: missing fonts use substitutes, but characters unavailable in the selected fonts or their substitutes can still prevent PDF creation. Restricted fonts cannot be embedded. Check the message on screen and the Log pane. If writing to the selected file fails, use Download PDF instead in the error message to save a new copy through your browser.
- No save dialog: some browsers download the PDF instead. Check your browser's download location.
- Saving to WSL from Windows: Chrome's file access restrictions can reject WSL folders after you confirm the save dialog. Save to a Windows folder and copy the PDF into WSL, or try Download PDF instead. See the [Chromium report](https://issues.chromium.org/issues/553114097).
- Some SVG effects and font settings are not supported. Check the preview before saving. Any whitespace included in the SVG is retained in the PDF.


## How to build

Most users should use the [web app](https://shioyadan.github.io/kuroko2/) or
[offline download](https://shioyadan.github.io/kuroko2/kuroko-latest.zip).
For building from source and contributing, see the [development guide](docs/development.md).


## License

Copyright (C) 2016–2026 Ryota Shioya

Released under the [3-Clause BSD License](LICENSE.md).
Bundled library notices are in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and
Menu → About kuroko 2 → Licenses in the app. Microsoft fonts are not included.
