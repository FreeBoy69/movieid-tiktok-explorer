#!/usr/bin/env bash
set -e
cd /opt/autoyt/app
DBURL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
echo "COMMENT_CACHE:"
psql "$DBURL" -tAc "SELECT tiktok_video_id, jsonb_array_length(payload->'threads') FROM tiktok_comment_cache WHERE tiktok_video_id='7453046798265928990'"
echo "MOVIE_CACHE:"
psql "$DBURL" -tAc "SELECT tiktok_video_id, result->>'title' FROM movie_identification_cache WHERE tiktok_video_id='7453046798265928990' ORDER BY updated_at DESC LIMIT 3"
echo "SAVED_ANALYSES:"
psql "$DBURL" -tAc "SELECT post_slug, result->>'title' FROM saved_tiktok_post_analyses WHERE post_slug LIKE '%7453046798265928990%' LIMIT 5"
