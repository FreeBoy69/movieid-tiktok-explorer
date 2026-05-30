"""Extract TikTok comment API calls and cookies from a HAR export."""
from __future__ import annotations

import base64
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def decode_body(content: dict) -> str:
    text = content.get("text") or ""
    if not text and content.get("encoding") == "base64":
        text = base64.b64decode(content.get("text") or "").decode("utf-8", errors="replace")
    return text


def header_map(headers: list[dict]) -> dict[str, str]:
    out: dict[str, str] = {}
    for h in headers or []:
        name = str(h.get("name") or "").lower()
        if name:
            out[name] = str(h.get("value") or "")
    return out


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else r"c:\Users\evans\Downloads\www.tiktok.com.har")
    data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    entries = data.get("log", {}).get("entries") or []
    print(json.dumps({"entries": len(entries)}, indent=2))

    video_urls = []
    comment_calls = []
    ms_tokens = set()
    cookie_samples = []

    for e in entries:
        req = e.get("request") or {}
        url = req.get("url") or ""
        if "/video/" in url and "tiktok.com" in url and url.startswith("http"):
            video_urls.append(url.split("?")[0])
        qs = parse_qs(urlparse(url).query)
        if qs.get("msToken"):
            ms_tokens.add(qs["msToken"][0])
        if "comment/list" in url:
            resp = e.get("response") or {}
            content = resp.get("content") or {}
            body = decode_body(content)
            comments = 0
            first = ""
            parsed = None
            if body:
                try:
                    parsed = json.loads(body)
                    cs = parsed.get("comments") or []
                    comments = len(cs) if isinstance(cs, list) else 0
                    if comments and isinstance(cs[0], dict):
                        first = str(cs[0].get("text") or "")[:120]
                except ValueError:
                    parsed = {"bodyPrefix": body[:120]}
            hdrs = header_map(req.get("headers") or [])
            if hdrs.get("cookie") and len(cookie_samples) < 1:
                cookie_samples.append(hdrs["cookie"][:200] + "...")
            comment_calls.append(
                {
                    "method": req.get("method"),
                    "status": resp.get("status"),
                    "url": url,
                    "commentCount": comments,
                    "firstComment": first,
                    "hasXBogus": "X-Bogus" in url or "X-Gnarly" in url,
                    "queryKeys": sorted(qs.keys()),
                    "aweme_id": (qs.get("aweme_id") or qs.get("item_id") or [""])[0],
                }
            )

    print("\n=== video pages in har ===")
    for u in sorted(set(video_urls))[:20]:
        print(u)

    print("\n=== comment/list calls ===")
    print(json.dumps(comment_calls, indent=2, ensure_ascii=False))

    print("\n=== msToken samples ===")
    for t in list(ms_tokens)[:3]:
        print(f"len={len(t)}")

    if cookie_samples:
        print("\n=== cookie prefix ===")
        print(cookie_samples[0])

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
