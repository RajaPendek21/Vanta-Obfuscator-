#!/usr/bin/env sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DEST="$ROOT/vendor/obscura"
PIN="742770554151d82c6a12ae6e24a0e47471bc467c"

if [ -d "$DEST/.git" ]; then
  CURRENT="$(git -C "$DEST" rev-parse HEAD)"
  if [ "$CURRENT" = "$PIN" ]; then
    python3 -m pip install -r "$DEST/requirements.txt"
    echo "Obscura is already at pinned revision $PIN"
    exit 0
  fi
  echo "vendor/obscura exists at $CURRENT; refusing to overwrite it." >&2
  exit 1
fi
if [ -e "$DEST" ]; then
  echo "vendor/obscura exists but is not a Git checkout; move it before bootstrapping." >&2
  exit 1
fi
mkdir -p "$ROOT/vendor"
git init "$DEST"
git -C "$DEST" remote add origin https://github.com/vo3pal/obscura.git
git -C "$DEST" fetch --depth 1 origin "$PIN"
git -C "$DEST" checkout --detach FETCH_HEAD
ACTUAL="$(git -C "$DEST" rev-parse HEAD)"
if [ "$ACTUAL" != "$PIN" ]; then
  echo "Fetched Obscura revision $ACTUAL, expected $PIN." >&2
  exit 1
fi
python3 -m pip install -r "$DEST/requirements.txt"
echo "Bootstrapped Obscura at $PIN"
