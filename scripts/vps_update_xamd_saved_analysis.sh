#!/usr/bin/env bash
set -e
cd /opt/autoyt/app
DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
VIDEO_ID='7453046798265928990'
SLUG='ypdkbkhfdht-story-7453046798265928990'

RESULT=$(psql "$DBURL" -tAc "SELECT result::text FROM movie_identification_cache WHERE tiktok_video_id='${VIDEO_ID}' ORDER BY updated_at DESC LIMIT 1")
if [ -z "$RESULT" ] || [ "$RESULT" = "null" ]; then
  echo "No movie cache result for ${VIDEO_ID}"
  exit 1
fi

psql "$DBURL" -v result="$RESULT" <<SQL
UPDATE saved_tiktok_post_analyses
SET result = :'result'::jsonb,
    analyzed_at = now(),
    updated_at = now()
WHERE post_slug = '${SLUG}';
SQL

echo "UPDATED saved analysis:"
psql "$DBURL" -tAc "SELECT post_slug, result->>'title', result->>'year' FROM saved_tiktok_post_analyses WHERE post_slug='${SLUG}'"
