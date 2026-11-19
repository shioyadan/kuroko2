# kuroko 2

English | [日本語](README.ja.md)

kuroko 2 saves figures and charts you create in PowerPoint or Excel as PDFs you can include in LaTeX documents.

- Getting started
    - [Web app](https://shioyadan.github.io/kuroko2/)
        - Open the link in your browser to get started. PDF conversion runs entirely in your browser without contacting external servers.
    - [Offline app](https://shioyadan.github.io/kuroko2/kuroko-latest.zip)
        - Extract the downloaded ZIP and open `index.html`.
- Features
    - Shapes and text stay sharp as vectors. Effects such as shadows may be saved as images.
    - Uploading to Overleaf requires the offline app. Only the Overleaf feature uses the local server, which runs Git on your computer to transfer files.


## How to use

1. Open [kuroko 2](https://shioyadan.github.io/kuroko2/) in Chrome or Edge.
2. Select and copy a figure in PowerPoint or Excel.
3. Return to kuroko 2 and press Ctrl+V (⌘V on Mac), or click Paste Objects.
4. Check the PDF preview, then click Save PDF or press Ctrl+S (⌘S on Mac).
    - If fonts are missing, check the preview with substitute fonts or click Add fonts… to load the originals.


### Connecting to Overleaf

Run `./kuroko2.sh` from the extracted folder and open the URL it prints. From there you can upload the PDF you just created to an Overleaf project, or preview and download PDFs already in the project. This feature requires Python 3 and Git. On Windows, run the script in WSL. The hosted web app and an HTML file opened directly cannot connect to Overleaf.

Make sure Git can access your Overleaf project from the environment where you run the script. To cache your token for eight hours after successful authentication, run the following command.

```sh
git config --global credential.https://git.overleaf.com.helper 'cache --timeout=28800'
```


## Known limitations and troubleshooting

- When saving from Windows to a WSL folder, Chrome may deny access even after you confirm the save dialog. Save to a Windows folder and copy the PDF into WSL, or try Download PDF instead.


## How to build

Most users should use the [web app](https://shioyadan.github.io/kuroko2/) or
[offline download](https://shioyadan.github.io/kuroko2/kuroko-latest.zip).
For build instructions and development details, see the [development guide](docs/development.md).


## License

Copyright (C) 2016–2026 Ryota Shioya

Released under the [3-Clause BSD License](LICENSE.md).
Bundled library notices are in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and
Menu → About kuroko 2 → Licenses in the app. Microsoft fonts are not included.
