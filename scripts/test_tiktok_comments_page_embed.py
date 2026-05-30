"""Probe TikTok video page HTML for embedded comments or signed comment API params."""

from __future__ import annotations

import json
import re
import sys

import requests

from tiktok_list import _extract_video_id, _normalize_page_url, _resolve_short_url, _tiktok_web_headers


def main() -> int:
    url = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    normalized = _normalize_page_url(_resolve_short_url(url))
    video_id = _extract_video_id(normalized)
    headers = _tiktok_web_headers(normalized, include_cookie=True, use_env_user_agent=True)
    headers["Accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    response = requests.get(normalized, headers=headers, timeout=30)
    html = response.text or ""
    out = {
        "videoId": video_id,
        "status": response.status_code,
        "htmlLen": len(html),
        "hasSigi": "__SIGI_STATE__" in html,
        "hasUniversal": "__UNIVERSAL_DATA_FOR_REHYDRATION__" in html,
        "commentApiUrls": re.findall(r"https://www\\.tiktok\\.com/api/comment/list/[^\"'\\s]+", html)[:3],
    }

    for marker in ("__SIGI_STATE__", "__UNIVERSAL_DATA_FOR_REHYDRATION__"):
        m = re.search(rf"{marker}\\s*=\\s*(\{{.*?\}});", html)
        if not m:
            continue
        try:
            data = json.loads(m.group(1))
            out[f"{marker}_keys"] = list(data.keys())[:20]
            item_module = data.get("ItemModule") or {}
            item = item_module.get(video_id) if video_id else None
            if isinstance(item, dict):
                out["itemCommentCount"] = item.get("commentCount")
            comment_module = data.get("CommentModule") or {}
            if comment_module:
                out["commentModuleKeys"] = list(comment_module.keys())[:10]
        except Exception as exc:
            out[f"{marker}_error"] = str(exc)

    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
