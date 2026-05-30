#!/usr/bin/env bash
set -euo pipefail
cd /opt/autoyt/app
URL="${1:-https://www.tiktok.com/@user272358841430/video/7627543273967537421}"
PYTHON=/opt/autoyt/venv/bin/python
export PYTHONPATH=/opt/autoyt/app/scripts

if grep -q '^TIKTOK_MS_TOKEN=.\+' .env 2>/dev/null; then echo "ms_token=present"; else echo "ms_token=missing"; fi
if grep -q '^TIKTOK_COOKIE_HEADER=.\+' .env 2>/dev/null; then echo "cookie_header=present"; else echo "cookie_header=missing"; fi

payload=$(printf '{"url":"%s","commentLimit":20,"replyLimit":8}' "$URL")

for browser in webkit chromium; do
  echo "=== browser=$browser sleep=8 ==="
  TIKTOK_BROWSER="$browser" TIKTOK_SLEEP_AFTER=8 printf '%s' "$payload" | "$PYTHON" scripts/tiktok_comments.py 2>&1 | head -c 2000 || true
  echo
done

echo "=== tiktok list sanity (1 video url) ==="
printf '{"url":"%s","count":1}' "$URL" | "$PYTHON" scripts/tiktok_list.py 2>&1 | head -c 1200 || true
echo
