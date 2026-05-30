#!/usr/bin/env bash
set -e
cd /opt/autoyt/app
apt-get install -y -qq libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 >/dev/null 2>&1 || true
PYTHON_PATH=/opt/autoyt/venv/bin/python /usr/bin/node scripts/test_tiktok_comment_hint.mjs 'https://www.tiktok.com/@user272358841430/video/7636970555379289358'
