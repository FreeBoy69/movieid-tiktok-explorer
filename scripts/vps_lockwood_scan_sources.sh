#!/usr/bin/env bash
set -e
cd /opt/autoyt/app
DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)

# Find playlist key for lockwoodmusic-mech-anime
echo "PLAYLIST:"
psql "$DBURL" -tAc "
SELECT key, slug, analyzed_url, jsonb_array_length(playlist->'videos') AS videos
FROM saved_tiktok_playlists
WHERE slug LIKE '%lockwoodmusic%' OR key LIKE '%lockwoodmusic%'
LIMIT 5;
"

PLAYLIST_KEY=$(psql "$DBURL" -tAc "
SELECT key FROM saved_tiktok_playlists
WHERE slug LIKE '%lockwoodmusic-mech-anime%' OR slug LIKE '%lockwoodmusic%'
ORDER BY updated_at DESC NULLS LAST
LIMIT 1;
" | tr -d '[:space:]')

if [ -z "$PLAYLIST_KEY" ]; then
  echo "No playlist found"
  exit 1
fi

echo "KEY=$PLAYLIST_KEY"
echo
echo "SOURCE BREAKDOWN:"
psql "$DBURL" -c "
WITH rows AS (
  SELECT
    post_slug,
    result->>'title' AS title,
    result->>'identificationSource' AS stored_source,
    result->'commentHint'->>'source' AS hint_source,
    result->'commentHint'->>'format' AS hint_format,
    result->'commentHint'->>'replyText' AS reply_text,
    result->'evidence'->>'reasoning' AS reasoning,
    CASE
      WHEN result->>'identificationSource' IN ('comment-reply', 'comment-corpus') THEN result->>'identificationSource'
      WHEN result->'commentHint'->>'format' = 'comment_corpus_tmdb'
        OR result->'commentHint'->>'source' = 'comment_corpus_tmdb' THEN 'comment-corpus'
      WHEN result->'commentHint'->>'source' = 'comment_reply'
        OR COALESCE(result->'commentHint'->>'format', '') <> '' THEN 'comment-reply'
      WHEN result->'evidence'->>'reasoning' ILIKE '%TikTok comment reply%' THEN 'comment-reply'
      WHEN result->'evidence'->>'reasoning' ILIKE '%comment corpus%' THEN 'comment-corpus'
      WHEN result->>'identificationSource' = 'cache' THEN 'cache'
      WHEN result->>'identificationSource' = 'ai-video' THEN 'ai-video'
      ELSE 'ai-video-or-unknown'
    END AS resolved_source
  FROM saved_tiktok_post_analyses
  WHERE playlist_key = '$PLAYLIST_KEY'
)
SELECT resolved_source, COUNT(*) AS count
FROM rows
GROUP BY resolved_source
ORDER BY count DESC;
"

echo
echo "TOTAL ANALYZED:"
psql "$DBURL" -tAc "SELECT COUNT(*) FROM saved_tiktok_post_analyses WHERE playlist_key = '$PLAYLIST_KEY';"

echo
echo "COMMENT-BASED TITLES:"
psql "$DBURL" -c "
SELECT
  post_slug,
  result->>'title' AS title,
  CASE
    WHEN result->>'identificationSource' IN ('comment-reply', 'comment-corpus') THEN result->>'identificationSource'
    WHEN result->'commentHint'->>'format' = 'comment_corpus_tmdb' THEN 'comment-corpus'
    WHEN result->'commentHint'->>'source' = 'comment_reply'
      OR COALESCE(result->'commentHint'->>'format', '') <> '' THEN 'comment-reply'
    WHEN result->'evidence'->>'reasoning' ILIKE '%TikTok comment reply%' THEN 'comment-reply'
    WHEN result->'evidence'->>'reasoning' ILIKE '%comment corpus%' THEN 'comment-corpus'
    ELSE NULL
  END AS source,
  LEFT(COALESCE(result->'commentHint'->>'replyText', result->'evidence'->>'reasoning', ''), 80) AS evidence
FROM saved_tiktok_post_analyses
WHERE playlist_key = '$PLAYLIST_KEY'
  AND (
    result->>'identificationSource' IN ('comment-reply', 'comment-corpus')
    OR result->'commentHint'->>'source' IS NOT NULL
    OR COALESCE(result->'commentHint'->>'format', '') <> ''
    OR result->'evidence'->>'reasoning' ILIKE '%TikTok comment%'
  )
ORDER BY analyzed_at DESC;
"
