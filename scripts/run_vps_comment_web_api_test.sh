#!/usr/bin/env bash
set -euo pipefail
cd /opt/autoyt/app
export PYTHONPATH=/opt/autoyt/app/scripts
export TIKTOK_MS_TOKEN="$(grep '^TIKTOK_MS_TOKEN=' .env | cut -d= -f2- | tr -d '\r' || true)"
export TIKTOK_COOKIE_HEADER="$(grep '^TIKTOK_COOKIE_HEADER=' .env | cut -d= -f2- | tr -d '\r' || true)"
export TIKTOK_SLEEP_AFTER=8
export TIKTOK_BROWSER=webkit
PYTHON=/opt/autoyt/venv/bin/python

echo "ms_token_len=${#TIKTOK_MS_TOKEN}"
echo "cookie_len=${#TIKTOK_COOKIE_HEADER}"

for url in \
  'https://www.tiktok.com/@user272358841430/video/7627543273967537421' \
  'https://www.tiktok.com/@user272358841430/video/7636970555379289358'
do
  echo "=== $url ==="
  "$PYTHON" scripts/test_tiktok_comments_web_api.py "$url" 20 8 || true
  "$PYTHON" scripts/test_tiktok_comments_web_api_raw.py "$url" || true
  echo
done
