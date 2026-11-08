#!/bin/sh
# Installs a Thingstudio release's online demo on the demo server, and switches to it.
#
#   tools/deploy_demo.sh v0.13.0          download, check, unpack, switch to it
#   tools/deploy_demo.sh --file demo.zip 0.13.0-test   install a zip you copied here (local build, CI artifact)
#   tools/deploy_demo.sh --rollback v0.12.1   switch back to a version already unpacked
#   tools/deploy_demo.sh --list           show the unpacked versions and which one is live
#
# The demo zip (thingstudio-demo-<version>.zip) and SHA256SUMS come from the GitHub release, which has to be
# published: a draft's files aren't downloadable without a token, and this script holds none. The zip's SHA-256
# must match SHA256SUMS or nothing changes. Each version goes in <root>/releases/<version>/; <root>/current is a
# symlink to the live one, switched in one step, so a visitor never sees half a release. The web server serves
# <root>/current (packaging/demo-server/Caddyfile). Old versions stay until you delete them.
#
# Settings (environment): THINGSTUDIO_DEMO_ROOT (default /srv/thingstudio-demo), THINGSTUDIO_DEMO_REPO
# (default mkarliner/ThingStudio), THINGSTUDIO_DEMO_DOWNLOAD_BASE (default the repo's release downloads; a
# file:// URL works for testing). Needs curl, unzip, and sha256sum or shasum.
# Plan: docs/working-notes/online-editor-demo-scoping.md, "Hosting and operations".

set -eu

ROOT=${THINGSTUDIO_DEMO_ROOT:-/srv/thingstudio-demo}
REPO=${THINGSTUDIO_DEMO_REPO:-mkarliner/ThingStudio}
BASE=${THINGSTUDIO_DEMO_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download}

say() { printf '%s\n' "$*"; }
fail() { printf 'deploy_demo: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

# "v0.13.0" or "0.13.0" -> "0.13.0"; refuses anything that isn't a plain version, since it becomes a path.
plain_version() {
  v=${1#v}
  case $v in
    "" | *[!0-9A-Za-z.+-]* | .* ) fail "not a version: $1" ;;
  esac
  printf '%s' "$v"
}

live_version() {
  if [ -L "$ROOT/current" ]; then
    basename "$(readlink "$ROOT/current")"
  fi
}

# Points <root>/current at releases/<version> in one rename.
switch_to() {
  [ -f "$ROOT/releases/$1/index.html" ] || fail "$ROOT/releases/$1 has no index.html; nothing switched"
  previous=$(live_version)
  ln -sfn "releases/$1" "$ROOT/current.new"
  # GNU mv replaces the link itself with -T; BSD mv does the same with -h.
  mv -T "$ROOT/current.new" "$ROOT/current" 2>/dev/null || mv -fh "$ROOT/current.new" "$ROOT/current"
  say "live: $1${previous:+ (was $previous; back with: $0 --rollback $previous)}"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

deploy() {
  version=$(plain_version "$1")
  tag="v$version"
  file="thingstudio-demo-$version.zip"
  dest="$ROOT/releases/$version"

  if [ -d "$dest" ]; then
    say "$dest is already unpacked; switching to it"
    switch_to "$version"
    return
  fi

  mkdir -p "$ROOT/releases"
  work=$(mktemp -d "$ROOT/.incoming.XXXXXX")
  trap 'rm -rf "$work"' EXIT INT TERM

  say "downloading $file and SHA256SUMS from $BASE/$tag/"
  curl -fsSL -o "$work/$file" "$BASE/$tag/$file" || fail "couldn't download $BASE/$tag/$file (is the release published?)"
  curl -fsSL -o "$work/SHA256SUMS" "$BASE/$tag/SHA256SUMS" || fail "couldn't download $BASE/$tag/SHA256SUMS"

  expected=$(awk -v f="$file" '$2 == f || $2 == "*" f { print $1 }' "$work/SHA256SUMS")
  [ -n "$expected" ] || fail "SHA256SUMS has no line for $file"
  got=$(sha256_of "$work/$file")
  [ "$got" = "$expected" ] || fail "$file has SHA-256 $got, but SHA256SUMS says $expected; nothing changed"
  say "SHA-256 matches: $got"
  install_zip "$work/$file" "$version"
}

# --file: a zip that isn't from a published release, so there's no SHA256SUMS to check it against. Its SHA-256 is
# printed, to compare with what the build or CI run reported.
deploy_file() {
  zip=$1
  version=$(plain_version "$2")
  [ -f "$zip" ] || fail "no such file: $zip"
  [ ! -d "$ROOT/releases/$version" ] || fail "$ROOT/releases/$version already exists; pick another name, or --rollback to it"
  mkdir -p "$ROOT/releases"
  work=$(mktemp -d "$ROOT/.incoming.XXXXXX")
  trap 'rm -rf "$work"' EXIT INT TERM
  say "installing $zip as $version (SHA-256 $(sha256_of "$zip"); not checked against a release)"
  install_zip "$zip" "$version"
}

# Unpacks a checked zip into releases/<version> and switches to it. Needs $work.
install_zip() {
  dest="$ROOT/releases/$2"
  # unzip refuses absolute paths and ../ in entries; the check after it catches a zip that isn't a demo.
  unzip -q "$1" -d "$work/unpacked"
  [ -f "$work/unpacked/index.html" ] || fail "$1 has no index.html at its top; nothing changed"
  chmod -R a+rX "$work/unpacked"
  mv "$work/unpacked" "$dest"
  switch_to "$2"
}

list() {
  live=$(live_version)
  [ -d "$ROOT/releases" ] || { say "nothing unpacked in $ROOT/releases"; return; }
  for d in "$ROOT"/releases/*/; do
    [ -d "$d" ] || continue
    v=$(basename "$d")
    if [ "$v" = "$live" ]; then say "$v  (live)"; else say "$v"; fi
  done
}

case ${1:-} in
  "" | -h | --help) usage ;;
  --list) list ;;
  --file)
    [ $# -eq 3 ] || usage
    deploy_file "$2" "$3"
    ;;
  --rollback)
    [ $# -eq 2 ] || usage
    switch_to "$(plain_version "$2")"
    ;;
  -*) usage ;;
  *)
    [ $# -eq 1 ] || usage
    deploy "$1"
    ;;
esac
