"""
Persistent TikTok-Api session daemon for comment fetches.
Protocol: one JSON object per line on stdin, one JSON object per line on stdout.

Request: {"id":"1","action":"fetch_comments","url":"...","commentLimit":40,"replyLimit":12}
Response: {"id":"1","ok":true,"data":{...}} or {"id":"1","ok":false,"error":"..."}
"""

from __future__ import annotations

import asyncio
import json
import sys

from tiktok_comment_fetch import (
    close_tiktok_api_session,
    create_tiktok_api_session,
    fetch_comments_with_api,
)


class TikTokCommentDaemon:
    def __init__(self) -> None:
        self.api = None
        self.lock = asyncio.Lock()

    async def ensure_session(self) -> None:
        if self.api is not None:
            return
        self.api = await create_tiktok_api_session()

    async def reset_session(self) -> None:
        await close_tiktok_api_session(self.api)
        self.api = None

    async def fetch_comments(self, url: str, comment_limit: int, reply_limit: int) -> dict:
        async with self.lock:
            await self.ensure_session()
            try:
                return await fetch_comments_with_api(self.api, url, comment_limit, reply_limit)
            except Exception:
                await self.reset_session()
                await self.ensure_session()
                return await fetch_comments_with_api(self.api, url, comment_limit, reply_limit)

    async def close(self) -> None:
        await self.reset_session()


async def handle_request(daemon: TikTokCommentDaemon, request: dict) -> dict:
    req_id = str(request.get("id") or "")
    action = str(request.get("action") or "").strip().lower()
    if action == "ping":
        await daemon.ensure_session()
        return {"id": req_id, "ok": True, "data": {"ready": True}}
    if action == "shutdown":
        await daemon.close()
        return {"id": req_id, "ok": True, "data": {"shutdown": True}}
    if action == "fetch_comments":
        url = str(request.get("url") or "").strip()
        if not url:
            return {"id": req_id, "ok": False, "error": "url is required"}
        comment_limit = max(5, min(int(request.get("commentLimit") or 40), 80))
        reply_limit = max(0, min(int(request.get("replyLimit") or 12), 30))
        data = await daemon.fetch_comments(url, comment_limit, reply_limit)
        return {"id": req_id, "ok": True, "data": data}
    return {"id": req_id, "ok": False, "error": f"unknown action: {action or 'missing'}"}


async def main() -> None:
    daemon = TikTokCommentDaemon()
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, sys.stdin.readline)
        if not line:
            break
        raw = line.strip()
        if not raw:
            continue
        request = json.loads(raw)
        try:
            response = await handle_request(daemon, request)
        except Exception as exc:
            response = {
                "id": str(request.get("id") or ""),
                "ok": False,
                "error": str(exc) or "TikTok comment daemon request failed",
            }
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()
        if str(request.get("action") or "").strip().lower() == "shutdown":
            break
    await daemon.close()


if __name__ == "__main__":
    asyncio.run(main())
