#!/usr/bin/env bash
# Builds the frontend and packs the minimal source tarball for the LingCode Cloud hosted app.
# Hosted-app intake limits: <= 500 files, <= 100 MiB uncompressed, <= 5 MiB per file.
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=${1:-tmp/lingcode-app-source.tgz}

if [ "${SKIP_BUILD:-0}" = "1" ] && [ -f dist/index.html ]; then
  echo "SKIP_BUILD=1: reusing existing dist/"
else
  npm run build >/dev/null
fi
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/src/utils" "$STAGE/scripts" "$STAGE/data" "$STAGE/dist"
cp package.json package-lock.json server.js requirements.txt "$STAGE/"
cp data/premium-niche-library.json "$STAGE/data/"
cp -R dist/. "$STAGE/dist/"
for f in src/utils/*.js; do
  case "$f" in *.test.*) ;; *) cp "$f" "$STAGE/src/utils/" ;; esac
done
cp scripts/transcribe.py scripts/tiktok_list.py scripts/tiktok_comments.py \
   scripts/tiktok_api_daemon.py scripts/caption_cleanup.py scripts/tiktok_comment_fetch.py "$STAGE/scripts/"

count=$(find "$STAGE" -type f | wc -l | tr -d ' ')
kb=$(du -sk "$STAGE" | cut -f1)
big=$(find "$STAGE" -type f -size +5M || true)
if [ "$count" -gt 500 ] || [ "$kb" -gt 102400 ] || [ -n "$big" ]; then
  echo "bundle exceeds hosted-app limits: files=$count size=${kb}KB big=[$big]" >&2
  exit 1
fi
mkdir -p "$(dirname "$OUT")"
tar -czf "$OUT" -C "$STAGE" .
echo "bundle=$OUT files=$count uncompressed=${kb}KB compressed=$(du -k "$OUT" | cut -f1)KB"
