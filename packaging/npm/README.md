# noteral-app

Installs and opens [Noteral](https://github.com/neurh/Noteral), a quiet, local-first notes app for the desktop.

```sh
npm install -g noteral-app
noteral
```

Or without installing: `npx noteral-app`.

The first run downloads the Noteral release that matches this package's version for your
system (Windows, macOS or Linux, x64 or arm64), checks its SHA-256 checksum, and keeps it
in a cache folder. Later runs open it straight away.

```
noteral              open Noteral
noteral --path       print where the app is installed
noteral --uninstall  remove the downloaded app (your notes are kept)
noteral --version    print the version
```

Linux needs GTK 3 and WebKitGTK 4.1 (`sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0`
on Debian and Ubuntu).

Set `NOTERAL_CACHE_DIR` to change where the app is stored.
