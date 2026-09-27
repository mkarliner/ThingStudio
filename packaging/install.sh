#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Thingstudio installer for macOS and Linux (packaging/install.sh, MVP item 7 step 3).
#
#   curl -fsSL https://github.com/mkarliner/ThingStudio/releases/latest/download/install.sh | sh
#
# Downloads the bundle for this machine from a GitHub release, checks it against the release's SHA256SUMS,
# unpacks it under ~/.local/share/thingstudio, and links `thingstudio` into ~/.local/bin. Rerunning it
# upgrades; the previous version is kept for one upgrade so a running copy isn't pulled out from under
# itself. Needs nothing but sh, curl, tar and a SHA-256 tool, all present on macOS and mainstream Linux.
# Never touches ~/.thingstudio (your flows and settings).
#
#   sh install.sh --uninstall     remove the program (keeps ~/.thingstudio)
#
# Environment overrides: THINGSTUDIO_VERSION (e.g. v0.1.0; default: latest release),
# THINGSTUDIO_HOME (install folder), THINGSTUDIO_BIN (where the command goes),
# THINGSTUDIO_DOWNLOAD_BASE (release download URL; for testing).
#
# Everything runs inside main(), called on the last line, so a download cut off halfway runs nothing.

set -u

REPO="mkarliner/ThingStudio"
HOME_DIR="${THINGSTUDIO_HOME:-$HOME/.local/share/thingstudio}"
BIN_DIR="${THINGSTUDIO_BIN:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
fail() {
  printf 'Thingstudio install failed: %s\n' "$*" >&2
  exit 1
}

detect_platform() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Darwin)
      os=macos
      # A shell running under Rosetta reports x86_64 on Apple Silicon; install the native build.
      if [ "$arch" = x86_64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ]; then
        arch=arm64
      fi
      case "$arch" in
        arm64) ;;
        x86_64) ;;
        *) arch="" ;;
      esac
      ;;
    Linux)
      os=linux
      case "$arch" in
        x86_64 | amd64) arch=x86_64 ;;
        aarch64 | arm64) arch=aarch64 ;;
        *) arch="" ;;
      esac
      ;;
    *) arch="" ;;
  esac
  if [ -z "$arch" ]; then
    fail "no Thingstudio build for $(uname -s) $(uname -m). Builds exist for macOS (Apple Silicon, Intel) and Linux (x86_64, aarch64). See https://github.com/$REPO/releases"
  fi
  PLATFORM="$os-$arch"
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "'$1' is needed but not installed."
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    fail "no SHA-256 tool (sha256sum or shasum) found, so the download can't be checked."
  fi
}

resolve_version() {
  if [ -n "${THINGSTUDIO_VERSION:-}" ]; then
    VERSION="$THINGSTUDIO_VERSION"
    return
  fi
  # github.com/<repo>/releases/latest redirects to .../releases/tag/<tag>; no API call, no JSON to parse.
  url=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest") ||
    fail "couldn't reach github.com to find the latest release. Check your internet connection."
  VERSION="${url##*/}"
  case "$VERSION" in
    v[0-9]*) ;;
    *) fail "couldn't work out the latest release (got '$url'). Is there a published release at https://github.com/$REPO/releases ?" ;;
  esac
}

download() {
  # $1 url, $2 output file, $3 what to say if it fails; $4 "quiet" for small files (no progress bar)
  if [ "${4:-}" = quiet ]; then
    curl -fsSL --retry 3 --connect-timeout 20 -o "$2" "$1" || fail "$3 ($1)"
  else
    curl -fL --progress-bar --retry 3 --connect-timeout 20 -o "$2" "$1" || fail "$3 ($1)"
  fi
}

uninstall() {
  removed=""
  if [ -L "$BIN_DIR/thingstudio" ]; then
    case "$(readlink "$BIN_DIR/thingstudio")" in
      "$HOME_DIR"/*) rm -f "$BIN_DIR/thingstudio" && removed="$BIN_DIR/thingstudio" ;;
    esac
  fi
  if [ -d "$HOME_DIR" ]; then
    rm -rf "$HOME_DIR" && removed="$removed $HOME_DIR"
  fi
  if [ -z "$removed" ]; then
    say "Thingstudio isn't installed in $HOME_DIR. Nothing removed."
  else
    say "Removed:$removed"
  fi
  say "Your flows and settings in ~/.thingstudio were left alone. Delete that folder yourself if you want them gone."
}

path_hint() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) return ;;
  esac
  shell_name=$(basename "${SHELL:-sh}")
  case "$shell_name" in
    zsh) rc="$HOME/.zshrc" ;;
    bash) if [ "$(uname -s)" = Darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
    *) rc="your shell's startup file" ;;
  esac
  say ""
  say "$BIN_DIR isn't on your PATH yet. To fix that, run:"
  say "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> $rc"
  say "then open a new terminal. Until then, start Thingstudio with: $BIN_DIR/thingstudio"
}

serial_hint() {
  [ "$(uname -s)" = Linux ] || return 0
  groups_now=$(id -nG 2>/dev/null)
  for g in dialout uucp; do
    if getent group "$g" >/dev/null 2>&1; then
      case " $groups_now " in
        *" $g "*) return 0 ;;
      esac
      say ""
      say "To use USB boards, your account needs to be in the '$g' group. Run:"
      say "  sudo usermod -aG $g $(id -un)"
      say "then log out and back in."
      return 0
    fi
  done
}

main() {
  if [ "${1:-}" = "--uninstall" ]; then
    uninstall
    return
  fi
  need curl
  need tar
  detect_platform
  if [ -n "${THINGSTUDIO_DOWNLOAD_BASE:-}" ]; then
    [ -n "${THINGSTUDIO_VERSION:-}" ] || fail "THINGSTUDIO_DOWNLOAD_BASE needs THINGSTUDIO_VERSION set too."
    VERSION="$THINGSTUDIO_VERSION"
    base="$THINGSTUDIO_DOWNLOAD_BASE"
  else
    resolve_version
    base="https://github.com/$REPO/releases/download/$VERSION"
  fi
  name="thingstudio-${VERSION#v}-$PLATFORM"
  archive="$name.tar.gz"

  say "Installing Thingstudio $VERSION for $PLATFORM"
  mkdir -p "$HOME_DIR" || fail "can't create $HOME_DIR"
  tmp=$(mktemp -d "$HOME_DIR/.download.XXXXXX") || fail "can't create a temporary folder in $HOME_DIR"
  trap 'rm -rf "$tmp"' EXIT INT TERM

  download "$base/$archive" "$tmp/$archive" \
    "couldn't download Thingstudio $VERSION for $PLATFORM. Check the version exists at https://github.com/$REPO/releases"
  download "$base/SHA256SUMS" "$tmp/SHA256SUMS" "couldn't download the release's SHA256SUMS" quiet
  want=$(grep " $archive\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)
  [ -n "$want" ] || fail "$archive isn't listed in the release's SHA256SUMS."
  got=$(sha256 "$tmp/$archive")
  [ "$got" = "$want" ] || fail "$archive is corrupt or has been altered (SHA-256 $got, expected $want). Nothing was installed."

  mkdir -p "$HOME_DIR/versions"
  tar -xzf "$tmp/$archive" -C "$tmp" || fail "couldn't unpack $archive"
  [ -x "$tmp/$name/thingstudio" ] || fail "$archive doesn't contain a thingstudio launcher."
  rm -rf "$HOME_DIR/versions/$name"
  mv "$tmp/$name" "$HOME_DIR/versions/$name" || fail "couldn't move the new version into $HOME_DIR/versions"

  # Switch `current` to the new version in one rename, so there's never a moment without one. A plain
  # `mv` would follow the old link and move the new one inside it: GNU mv needs -T, BSD (macOS) mv -h.
  previous=""
  [ -L "$HOME_DIR/current" ] && previous=$(basename "$(readlink "$HOME_DIR/current")")
  rm -f "$HOME_DIR/current.new"
  ln -s "versions/$name" "$HOME_DIR/current.new" || fail "couldn't create a link in $HOME_DIR"
  mv -T "$HOME_DIR/current.new" "$HOME_DIR/current" 2>/dev/null ||
    mv -h "$HOME_DIR/current.new" "$HOME_DIR/current" 2>/dev/null ||
    { rm -f "$HOME_DIR/current" && mv "$HOME_DIR/current.new" "$HOME_DIR/current"; } ||
    fail "couldn't switch $HOME_DIR/current to the new version"
  [ "$(readlink "$HOME_DIR/current")" = "versions/$name" ] ||
    fail "$HOME_DIR/current doesn't point at the new version after switching"

  # Keep the new version and the one it replaced; remove anything older.
  for dir in "$HOME_DIR"/versions/*; do
    b=$(basename "$dir")
    [ "$b" = "$name" ] || [ "$b" = "$previous" ] || rm -rf "$dir"
  done

  mkdir -p "$BIN_DIR" || fail "can't create $BIN_DIR"
  target="$HOME_DIR/current/thingstudio"
  if [ -e "$BIN_DIR/thingstudio" ] && [ ! -L "$BIN_DIR/thingstudio" ]; then
    say "Note: $BIN_DIR/thingstudio already exists and isn't a link, so it was left alone."
    say "      Start Thingstudio with: $target"
  else
    ln -sfn "$target" "$BIN_DIR/thingstudio" || fail "couldn't link $BIN_DIR/thingstudio"
  fi

  "$target" --help >/dev/null 2>&1 || fail "the installed copy doesn't start. Run $target --help to see why."

  say "Installed to $HOME_DIR/versions/$name"
  path_hint
  serial_hint
  say ""
  say "Start it with: thingstudio"
  say "Stop it with Ctrl-C. Run this installer again to upgrade."
  say "Docs: https://docs.thingstudio.net/"
}

main "$@"
