#!/usr/bin/env bash
set -euo pipefail
cd /opt/autoyt/app
export PYTHONPATH=/opt/autoyt/app/scripts
export TIKTOK_MS_TOKEN="$(grep '^TIKTOK_MS_TOKEN=' .env | cut -d= -f2- | tr -d '\r' || true)"
export TIKTOK_COOKIE_HEADER="$(grep '^TIKTOK_COOKIE_HEADER=' .env | cut -d= -f2- | tr -d '\r' || true)"
PYTHON=/opt/autoyt/venv/bin/python
$PYTHON scripts/test_tiktok_comments_page_embed.py 'https://www.tiktok.com/@user272358841430/video/7627543273967537421'
