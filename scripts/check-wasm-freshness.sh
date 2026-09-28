#!/usr/bin/env bash
# Fails when the vendored parsanol wasm no longer matches the parsanol-rs
# checkout it must track. The vendor dir carries a BUILT_FROM marker with
# the rs commit the current wasm was built from; when parsanol-rs moves,
# re-vendor (see the marker's second line for the build command) and
# commit the new wasm together with the marker.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
VENDOR="$HERE/../vendor/parsanol-wasm"
RS_DIR="${PARSANOL_RS:-$HERE/../../../parsanol/parsanol-rs}"

if [ ! -f "$VENDOR/BUILT_FROM" ]; then
  echo "wasm-freshness: FAIL — $VENDOR/BUILT_FROM marker is missing" >&2
  exit 1
fi

built_from="$(head -1 "$VENDOR/BUILT_FROM")"
if [ ! -d "$RS_DIR/.git" ]; then
  echo "wasm-freshness: SKIP — parsanol-rs checkout not found at $RS_DIR"
  exit 0
fi
rs_head="$(git -C "$RS_DIR" rev-parse HEAD)"

if [ "$built_from" != "$rs_head" ]; then
  echo "wasm-freshness: FAIL — vendored wasm built from ${built_from:0:12} but parsanol-rs is at ${rs_head:0:12}." >&2
  echo "  Rebuild and re-vendor: see the command in $VENDOR/BUILT_FROM," >&2
  echo "  then update the marker to the new HEAD." >&2
  exit 1
fi
echo "wasm-freshness: ok (built from ${rs_head:0:12})"
