#!/usr/bin/env bash
# Dumps the VPS Postgres as plain SQL for scripts/lingcode-cloud/import-db.mjs.
# Usage: VPS_SSH=root@212.95.34.95 scripts/lingcode-cloud/export-vps-db.sh [tmp/autoyt-vps.sql]
set -euo pipefail
cd "$(dirname "$0")/../.."
VPS=${VPS_SSH:-root@212.95.34.95}
OUT=${1:-tmp/autoyt-vps.sql}
mkdir -p "$(dirname "$OUT")"
ssh "$VPS" 'cd /opt/autoyt/app && DB=$(grep "^DATABASE_URL=" .env | cut -d= -f2-) && pg_dump "$DB" --schema=public --no-owner --no-acl --no-comments --clean --if-exists --inserts --rows-per-insert=200' > "$OUT"
echo "dump=$OUT size=$(du -k "$OUT" | cut -f1)KB statements=$(grep -c ';$' "$OUT")"
