"""Raw TikTok comment web API probe — shows HTTP status and body prefix."""

from __future__ import annotations

import json
import sys

import requests

from tiktok_list import (
    _extract_video_id,
    _normalize_page_url,
    _resolve_short_url,
    _tiktok_web_headers,
    _tiktok_web_params,
)


def main() -> int:
    url = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    normalized = _normalize_page_url(_resolve_short_url(url))
    video_id = _extract_video_id(normalized)
    if not video_id:
        print(json.dumps({"error": "no video id"}))
        return 1

    attempts = [
        ("direct", False, False),
        ("session", True, True),
    ]
    out = {"videoId": video_id, "attempts": []}
    for label, include_cookie, use_env_user_agent in attempts:
        params = _tiktok_web_params(
            {
                "aweme_id": video_id,
                "cursor": "0",
                "count": "20",
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
            headers=_tiktok_web_headers(
                normalized,
                include_cookie=include_cookie,
                use_env_user_agent=use_env_user_agent,
            ),
            timeout=30,
        )
        body = response.text or ""
        item = {
            "label": label,
            "status": response.status_code,
            "contentType": response.headers.get("content-type", ""),
            "bodyPrefix": body[:400],
            "jsonOk": False,
        }
        try:
            data = response.json()
            item["jsonOk"] = True
            item["statusCode"] = data.get("statusCode", data.get("status_code"))
            item["statusMsg"] = data.get("statusMsg", data.get("status_msg"))
            comments = data.get("comments") or []
            item["commentCount"] = len(comments) if isinstance(comments, list) else 0
            if item["commentCount"]:
                first = comments[0]
                if isinstance(first, dict):
                    item["firstComment"] = str(first.get("text") or "")[:120]
        except ValueError:
            pass
        out["attempts"].append(item)

    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
