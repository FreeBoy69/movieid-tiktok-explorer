"""
Fetch TikTok video comments and replies for Movie ID comment hints.
stdin: JSON {"url": "<tiktok video url>", "commentLimit": 40, "replyLimit": 12}
stdout: JSON {"videoId", "authorUniqueId", "threads": [...]} or {"error": "..."}
"""

from __future__ import annotations

import asyncio
import json
import sys

from tiktok_comment_fetch import fetch_comments_once, read_request, write_response


async def main() -> None:
    data = read_request()
    url = (data.get("url") or "").strip()
    comment_limit = max(5, min(int(data.get("commentLimit") or 40), 80))
    reply_limit = max(0, min(int(data.get("replyLimit") or 12), 30))
    if not url:
        write_response({"error": "url is required"})
        return
    try:
        result = await fetch_comments_once(url, comment_limit, reply_limit)
        write_response(result)
    except Exception as exc:
        write_response({"error": str(exc) or "TikTok comment fetch failed"})


if __name__ == "__main__":
    asyncio.run(main())
