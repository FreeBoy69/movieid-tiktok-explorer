#!/usr/bin/env bash
set -e
cd /opt/autoyt/app
DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
echo SERVICE_STATUS
systemctl is-active autoyt
systemctl is-active nginx
echo POSTGRES_COUNTS
psql "$DBURL" -tAc "select 'tables=' || count(*) from information_schema.tables where table_schema='public'"
psql "$DBURL" -tAc "select 'playlists=' || count(*) from saved_tiktok_playlists" || true
echo SWAP_STATUS
swapon --show
echo HTTP_STATUS
curl -sS -o /dev/null -w 'local=%{http_code}\n' http://127.0.0.1:3000/
curl -sS -o /dev/null -w 'ip=%{http_code}\n' http://212.95.34.95/
curl -sS -H 'Host: autoyt.cc' -o /dev/null -w 'host=%{http_code}\n' http://127.0.0.1/
echo NGINX_LISTEN
ss -ltnp | grep ':80\|:3000' || true