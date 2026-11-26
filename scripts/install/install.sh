#!/bin/sh
# Noteral installer for macOS and Linux.
#
#   curl -fsSL https://github.com/neurh/Noteral/releases/latest/download/install.sh | sh
#
# Options (or environment variables):
#   --version vX.Y.Z   NOTERAL_VERSION   install a specific release (default: latest)
#   --uninstall        NOTERAL_UNINSTALL=1  remove Noteral (your notes are kept)
#   --no-deps          NOTERAL_NO_DEPS=1    Linux: don't install GTK/WebKitGTK
#
# Installs without root:
#   macOS  /Applications/Noteral.app (or ~/Applications if not writable)
#   Linux  ~/.local/share/noteral, ~/.local/bin/noteral, a menu entry and icon
set -eu

# Everything runs inside main so a cut-off download never runs half a script.
main() {
REPO="neurh/Noteral"
VERSION="${NOTERAL_VERSION:-latest}"
UNINSTALL="${NOTERAL_UNINSTALL:-}"
NO_DEPS="${NOTERAL_NO_DEPS:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="${2:?--version needs a value}"; shift 2 ;;
    --version=*) VERSION="${1#*=}"; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --no-deps) NO_DEPS=1; shift ;;
    -h | --help) sed -n '2,13p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
fail() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

OS=$(uname -s)
ARCH=$(uname -m)
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
BIN_DIR="$HOME/.local/bin"

case "$OS" in
  Darwin) PLATFORM=macos; ASSET="noteral-macos-universal.zip" ;;
  Linux)
    PLATFORM=linux
    case "$ARCH" in
      x86_64 | amd64) ARCH=amd64 ;;
      aarch64 | arm64) ARCH=arm64 ;;
      *) fail "Noteral has no Linux build for $ARCH yet (amd64 and arm64 are available)." ;;
    esac
    ASSET="noteral-linux-$ARCH.tar.gz" ;;
  *) fail "Unsupported system: $OS. On Windows run: irm https://github.com/$REPO/releases/latest/download/install.ps1 | iex" ;;
esac

mac_app_dir() {
  if [ -d /Applications/Noteral.app ] || [ -w /Applications ]; then echo /Applications; else echo "$HOME/Applications"; fi
}

uninstall() {
  say "Removing Noteral"
  if [ "$PLATFORM" = macos ]; then
    for d in /Applications "$HOME/Applications"; do
      [ -d "$d/Noteral.app" ] && rm -rf "$d/Noteral.app" && info "removed $d/Noteral.app"
    done
  else
    rm -rf "$DATA_HOME/noteral"
    rm -f "$BIN_DIR/noteral" "$DATA_HOME/applications/noteral.desktop" "$DATA_HOME/icons/hicolor/512x512/apps/noteral.png"
    has update-desktop-database && update-desktop-database -q "$DATA_HOME/applications" 2>/dev/null || true
    info "removed $DATA_HOME/noteral"
  fi
  info "Your notes were not touched."
  exit 0
}
[ -n "$UNINSTALL" ] && uninstall

if [ "$VERSION" = latest ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  case "$VERSION" in v*) ;; *) VERSION="v$VERSION" ;; esac
  BASE="https://github.com/$REPO/releases/download/$VERSION"
fi

download() {
  if has curl; then curl -fL --proto '=https' --tlsv1.2 --retry 3 -sS -o "$2" "$1"
  elif has wget; then wget -q -O "$2" "$1"
  else fail "curl or wget is needed to download Noteral."; fi
}

sha256() {
  if has sha256sum; then sha256sum "$1" | cut -d' ' -f1
  elif has shasum; then shasum -a 256 "$1" | cut -d' ' -f1
  else echo ""; fi
}

# Linux: GTK 3 and WebKitGTK 4.1 are needed at runtime.
linux_deps() {
  if has ldconfig && ldconfig -p 2>/dev/null | grep -q 'libwebkit2gtk-4.1.so.0' && ldconfig -p 2>/dev/null | grep -q 'libgtk-3.so.0'; then
    return 0
  fi
  if has apt-get; then cmd="apt-get install -y libgtk-3-0 libwebkit2gtk-4.1-0"
  elif has dnf; then cmd="dnf install -y gtk3 webkit2gtk4.1"
  elif has zypper; then cmd="zypper --non-interactive install libgtk-3-0 libwebkit2gtk-4_1-0"
  elif has pacman; then cmd="pacman -S --needed --noconfirm gtk3 webkit2gtk-4.1"
  else
    info "Noteral needs GTK 3 and WebKitGTK 4.1. Install them with your package manager."
    return 0
  fi
  if [ -n "$NO_DEPS" ]; then
    info "Noteral needs GTK 3 and WebKitGTK 4.1. Install them with: sudo $cmd"
    return 0
  fi
  say "Installing GTK 3 and WebKitGTK 4.1"
  if [ "$(id -u)" -eq 0 ]; then sh -c "$cmd" </dev/null
  elif has sudo; then
    if has apt-get; then sudo apt-get update -qq || true; fi
    sudo sh -c "$cmd" </dev/null || info "Could not install them. Run: sudo $cmd"
  else info "Run as root: $cmd"; fi
}

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t noteral)
trap 'rm -rf "$TMP"' EXIT INT TERM

say "Downloading Noteral ($VERSION, $PLATFORM $ARCH)"
download "$BASE/$ASSET" "$TMP/$ASSET" || fail "Download failed: $BASE/$ASSET"

if download "$BASE/SHA256SUMS.txt" "$TMP/SHA256SUMS.txt" 2>/dev/null; then
  want=$(grep " $ASSET\$" "$TMP/SHA256SUMS.txt" | cut -d' ' -f1 || true)
  got=$(sha256 "$TMP/$ASSET")
  if [ -n "$want" ] && [ -n "$got" ]; then
    [ "$want" = "$got" ] || fail "Checksum mismatch for $ASSET. Try again, or download it from https://github.com/$REPO/releases"
    info "checksum ok"
  fi
fi

if [ "$PLATFORM" = macos ]; then
  dest=$(mac_app_dir)
  mkdir -p "$dest"
  ditto -x -k "$TMP/$ASSET" "$TMP/app"
  rm -rf "$dest/Noteral.app"
  ditto "$TMP/app/Noteral.app" "$dest/Noteral.app"
  # The app is not notarized yet; clear the download quarantine so it opens.
  xattr -dr com.apple.quarantine "$dest/Noteral.app" 2>/dev/null || true
  say "Noteral is installed in $dest/Noteral.app"
  info "Open it from Launchpad, Spotlight, or: open \"$dest/Noteral.app\""
  exit 0
fi

linux_deps
app="$DATA_HOME/noteral"
mkdir -p "$TMP/x" && tar -xzf "$TMP/$ASSET" -C "$TMP/x"
rm -rf "$app" && mkdir -p "$DATA_HOME" && mv "$TMP/x/noteral" "$app"
chmod +x "$app/noteral"
mkdir -p "$BIN_DIR" "$DATA_HOME/applications" "$DATA_HOME/icons/hicolor/512x512/apps"
ln -sf "$app/noteral" "$BIN_DIR/noteral"
cp "$app/noteral.png" "$DATA_HOME/icons/hicolor/512x512/apps/noteral.png"
sed "s#^Exec=.*#Exec=$app/noteral#" "$app/noteral.desktop" > "$DATA_HOME/applications/noteral.desktop"
has update-desktop-database && update-desktop-database -q "$DATA_HOME/applications" 2>/dev/null || true
has gtk-update-icon-cache && gtk-update-icon-cache -q -t "$DATA_HOME/icons/hicolor" 2>/dev/null || true

say "Noteral is installed"
info "Open it from your app menu, or run: noteral"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) info "Add $BIN_DIR to your PATH to run 'noteral' from a terminal." ;;
esac
}

main "$@"
