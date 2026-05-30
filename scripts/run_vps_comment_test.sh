#!/usr/bin/env bash
set -euo pipefail
cd /opt/autoyt/app
URL="${1:-https://www.tiktok.com/@user272358841430/video/7627543273967537421}"
PYTHON=/opt/autoyt/venv/bin/python
export PYTHONPATH=/opt/autoyt/app/scripts
payload=$(printf '{"url":"%s","commentLimit":40,"replyLimit":12}' "$URL")

echo "=== one-shot tiktok_comments.py ==="
printf '%s' "$payload" | "$PYTHON" scripts/tiktok_comments.py || true

echo
echo "=== daemon fetch_comments ==="
PYTHON_PATH="$PYTHON" /usr/bin/node scripts/test_tiktok_comment_hint.mjs "$URL" || true
