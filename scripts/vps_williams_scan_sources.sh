#!/usr/bin/env bash
set -e
cd /opt/autoyt/app
DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)

SLUG='c-williams41'
KEY=$(psql "$DBURL" -tAc "SELECT key FROM saved_tiktok_playlists WHERE slug='$SLUG' ORDER BY updated_at DESC LIMIT 1;" | tr -d '[:space:]')

if [ -z "$KEY" ]; then
  echo "Playlist not found for slug $SLUG"
  psql "$DBURL" -c "SELECT slug, key, analyzed_url FROM saved_tiktok_playlists WHERE slug ILIKE '%williams%' LIMIT 10;"
  exit 1
fi

echo "SLUG=$SLUG"
echo "KEY=$KEY"
echo
echo "VIDEO COUNT:"
psql "$DBURL" -tAc "SELECT jsonb_array_length(playlist->'videos') FROM saved_tiktok_playlists WHERE key='$KEY';"
echo
echo "ANALYZED COUNT:"
psql "$DBURL" -tAc "SELECT COUNT(*) FROM saved_tiktok_post_analyses WHERE playlist_key='$KEY';"
echo
echo "SOURCE BREAKDOWN:"
psql "$DBURL" -c "
WITH rows AS (
  SELECT CASE
    WHEN result->>'identificationSource' IN ('comment-reply', 'comment-corpus') THEN result->>'identificationSource'
    WHEN result->'commentHint'->>'format' = 'comment_corpus_tmdb' THEN 'comment-corpus'
    WHEN result->'commentHint'->>'source' = 'comment_reply'
      OR COALESCE(result->'commentHint'->>'format', '') <> '' THEN 'comment-reply'
    WHEN result->'evidence'->>'reasoning' ILIKE '%TikTok comment reply%' THEN 'comment-reply'
    WHEN result->'evidence'->>'reasoning' ILIKE '%comment corpus%' THEN 'comment-corpus'
    WHEN result->>'identificationSource' = 'cache' THEN 'cache'
    ELSE 'ai-video'
  END AS source
  FROM saved_tiktok_post_analyses
  WHERE playlist_key = '$KEY'
)
SELECT source, COUNT(*) FROM rows GROUP BY source ORDER BY COUNT(*) DESC;
"
