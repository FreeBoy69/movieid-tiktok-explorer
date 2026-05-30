#!/usr/bin/env bash
set -e
cd /opt/autoyt/app
DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
KEY='https://www.tiktok.com/@c..williams41'
psql "$DBURL" -tAc "
SELECT json_agg(json_build_object(
  'id', v->>'id',
  'url', COALESCE(NULLIF(v->>'playUrl',''), 'https://www.tiktok.com/@' || COALESCE(NULLIF(v->>'authorHandle',''),'unknown') || '/video/' || (v->>'id')),
  'title', LEFT(COALESCE(v->>'title',''), 120)
))
FROM saved_tiktok_playlists p,
LATERAL jsonb_array_elements(p.playlist->'videos') v
WHERE p.key = '$KEY';
" | tr -d '\n'
