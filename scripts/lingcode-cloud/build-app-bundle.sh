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
cp data/premium-niche-library.json data/prompt-library.json "$STAGE/data/"
cp -R dist/. "$STAGE/dist/"
for f in src/utils/*.js; do
  case "$f" in *.test.*) ;; *) cp "$f" "$STAGE/src/utils/" ;; esac
done
cp scripts/transcribe.py scripts/tiktok_list.py scripts/tiktok_comments.py \
   scripts/tiktok_api_daemon.py scripts/caption_cleanup.py scripts/tiktok_comment_fetch.py \
   scripts/subtitle_style.py scripts/render_motion.py "$STAGE/scripts/"
# server.js statically imports these at startup. A missing one is not a degraded
# feature -- Node fails module resolution and the container never becomes healthy.
cp scripts/detect-video-scenes.mjs scripts/render-avatar-remake.mjs \
   scripts/render-voiceover-subtitles.mjs "$STAGE/scripts/"
if [ -d server ]; then
  mkdir -p "$STAGE/server"
  cp server/*.js "$STAGE/server/"
fi
# Served to container-compute workers at run time via /internal/job-transcribe.mjs.
# The compute job runs a managed image, so its code has to come from here.
mkdir -p "$STAGE/scripts/lingcode-cloud"
cp scripts/lingcode-cloud/job-transcribe.mjs scripts/lingcode-cloud/job-exec.mjs "$STAGE/scripts/lingcode-cloud/"
# LingCode hosted-app intake rejects Node bundles that have no top-level .py file
# (`hosted_app_invalid_source: no .py files found at the top level`), even when
# runtime is node. Keep a tiny marker module at the tarball root.
cat > "$STAGE/lingcode_runtime.py" <<'PY'
"""Marker for LingCode Cloud hosted-app intake.

AutoYT runs as Node (server.js). Python helpers live under scripts/ and are
spawned by the Node process. This file exists so source validation accepts the
bundle.
"""
__all__ = []
PY

# Resolve every relative import reachable from server.js inside the staged tree.
# Node resolves static ESM imports before running a line of code, so an omitted
# local module is a hard startup crash ("container did not become healthy").
node -e '
const fs = require("fs"), path = require("path");
const root = process.argv[1];
const seen = new Set(), missing = [];
const walk = (file) => {
  if (seen.has(file)) return;
  seen.add(file);
  let src;
  try { src = fs.readFileSync(file, "utf8"); } catch { return; }
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*"(\.[^"]+)"/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (fs.existsSync(target)) walk(target);
    else missing.push(path.relative(root, file) + "  ->  " + m[1]);
  }
};
walk(path.join(root, "server.js"));
if (missing.length) {
  console.error("bundle is missing modules server.js imports:");
  for (const m of missing) console.error("  " + m);
  process.exit(1);
}
console.log("import check: " + seen.size + " local modules resolved");
' "$STAGE"

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
