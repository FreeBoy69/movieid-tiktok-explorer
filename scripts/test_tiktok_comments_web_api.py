"""
Test TikTok web comment HTTP API (same style as collection fallback in tiktok_list.py).
Usage:
  python scripts/test_tiktok_comments_web_api.py <video_url> [comment_limit] [reply_limit]
"""

from __future__ import annotations

import json
import os
import sys

import requests

from tiktok_list import (
    _extract_video_id,
    _normalize_page_url,
    _resolve_short_url,
    _tiktok_json,
    _tiktok_web_headers,
    _tiktok_web_params,
)


def _comment_row(item: dict) -> dict:
    user = item.get("user") if isinstance(item.get("user"), dict) else {}
    return {
        "id": str(item.get("cid") or item.get("comment_id") or item.get("id") or ""),
        "text": str(item.get("text") or "").strip(),
        "authorUniqueId": str(user.get("unique_id") or user.get("uniqueId") or "").strip(),
        "likeCount": int(item.get("digg_count") or item.get("like_count") or 0),
        "replyCount": int(item.get("reply_comment_total") or item.get("reply_count") or 0),
    }


def _fetch_comment_page(
    video_id: str,
    referer: str,
    *,
    include_cookie: bool,
    use_env_user_agent: bool,
    cursor: int,
    count: int,
) -> dict:
    params = _tiktok_web_params(
        {
            "aweme_id": video_id,
            "cursor": str(cursor),
            "count": str(count),
            "item_id": video_id,
            "insert_ids": "",
            "rcFT": "",
            "is_non_personalized": "false",
        },
        include_ms_token=include_cookie,
        use_env_user_agent=use_env_user_agent,
    )
    response = requests.get(
        "https://www.tiktok.com/api/comment/list/",
        params=params,
        headers=_tiktok_web_headers(referer, include_cookie=include_cookie, use_env_user_agent=use_env_user_agent),
        timeout=30,
    )
    return _tiktok_json(response, "TikTok comment list")


def _fetch_reply_page(
    video_id: str,
    comment_id: str,
    referer: str,
    *,
    include_cookie: bool,
    use_env_user_agent: bool,
    cursor: int,
    count: int,
) -> dict:
    params = _tiktok_web_params(
        {
            "item_id": video_id,
            "comment_id": comment_id,
            "cursor": str(cursor),
            "count": str(count),
            "is_non_personalized": "false",
        },
        include_ms_token=include_cookie,
        use_env_user_agent=use_env_user_agent,
    )
    response = requests.get(
        "https://www.tiktok.com/api/comment/list/reply/",
        params=params,
        headers=_tiktok_web_headers(referer, include_cookie=include_cookie, use_env_user_agent=use_env_user_agent),
        timeout=30,
    )
    return _tiktok_json(response, "TikTok comment replies")


def _comments_via_web_api_attempt(
    url: str,
    comment_limit: int,
    reply_limit: int,
    include_cookie: bool,
    use_env_user_agent: bool,
) -> dict:
    normalized = _normalize_page_url(_resolve_short_url(url))
    video_id = _extract_video_id(normalized)
    if not video_id:
        raise RuntimeError("Could not extract TikTok video id from URL")

    page = _fetch_comment_page(
        video_id,
        normalized,
        include_cookie=include_cookie,
        use_env_user_agent=use_env_user_agent,
        cursor=0,
        count=min(comment_limit, 50),
    )
    raw_comments = page.get("comments") or []
    if not isinstance(raw_comments, list):
        raw_comments = []

    threads: list[dict] = []
    for item in raw_comments[:comment_limit]:
        if not isinstance(item, dict):
            continue
        row = _comment_row(item)
        replies: list[dict] = []
        if reply_limit > 0 and row["replyCount"] > 0 and row["id"]:
            try:
                reply_page = _fetch_reply_page(
                    video_id,
                    row["id"],
                    normalized,
                    include_cookie=include_cookie,
                    use_env_user_agent=use_env_user_agent,
                    cursor=0,
                    count=min(reply_limit, 30),
                )
                raw_replies = reply_page.get("comments") or []
                if isinstance(raw_replies, list):
                    replies = [_comment_row(r) for r in raw_replies[:reply_limit] if isinstance(r, dict)]
            except Exception:
                replies = []
        row["replies"] = replies
        threads.append(row)

    if not threads:
        raise RuntimeError("TikTok comment web API returned 0 comments")

    return {
        "source": "tiktok-comment-web-api",
        "videoId": video_id,
        "authorUniqueId": "",
        "threads": threads,
        "total": int(page.get("total") or len(threads)),
        "hasMore": bool(page.get("has_more") or page.get("hasMore")),
        "cursor": page.get("cursor"),
    }


def comments_via_web_api(url: str, comment_limit: int = 40, reply_limit: int = 12) -> dict:
    errors: list[str] = []
    attempts = [
        ("direct", False, False),
        ("session", True, True),
    ]
    for label, include_cookie, use_env_user_agent in attempts:
        try:
            result = _comments_via_web_api_attempt(
                url,
                comment_limit,
                reply_limit,
                include_cookie,
                use_env_user_agent,
            )
            result["source"] = f"tiktok-comment-web-api-{label}"
            return result
        except Exception as exc:
            errors.append(f"{label}: {exc}")
    raise RuntimeError("; ".join(errors))


def main() -> int:
    url = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    comment_limit = max(5, min(int(sys.argv[2]) if len(sys.argv) > 2 else 20, 50))
    reply_limit = max(0, min(int(sys.argv[3]) if len(sys.argv) > 3 else 8, 20))
    if not url:
        print(json.dumps({"error": "video url required"}))
        return 1
    try:
        result = comments_via_web_api(url, comment_limit, reply_limit)
        preview = {
            "ok": True,
            "source": result.get("source"),
            "videoId": result.get("videoId"),
            "threadCount": len(result.get("threads") or []),
            "total": result.get("total"),
            "hasMore": result.get("hasMore"),
            "sample": [
                {
                    "text": t.get("text", "")[:120],
                    "likes": t.get("likeCount"),
                    "replies": len(t.get("replies") or []),
                    "topReply": ((t.get("replies") or [{}])[0] or {}).get("text", "")[:120],
                }
                for t in (result.get("threads") or [])[:8]
            ],
        }
        print(json.dumps(preview, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
