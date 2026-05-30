"""Extract session params from HAR and test comment web API with browser-accurate query params."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests


def load_entries(path: Path) -> list[dict]:
    data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
    return data.get("log", {}).get("entries") or []


def pick_template(entries: list[dict]) -> tuple[dict, str]:
    for e in entries:
        url = e.get("request", {}).get("url") or ""
        if "www.tiktok.com/api/" not in url:
            continue
        if e.get("response", {}).get("status") != 200:
            continue
        qs = parse_qs(urlparse(url).query)
        flat = {k: v[0] for k, v in qs.items() if v}
        if flat.get("device_id") and flat.get("verifyFp"):
            hdrs = {h["name"].lower(): h["value"] for h in e.get("request", {}).get("headers") or [] if h.get("name")}
            ua = hdrs.get("user-agent") or flat.get("browser_version") or ""
            return flat, ua
    raise RuntimeError("No suitable template request found in HAR")


def cookie_header_from_env() -> str:
    env_path = Path(__file__).resolve().parents[1] / "tmp" / "vps-tiktok-cookies.env"
    if not env_path.exists():
        return ""
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("TIKTOK_COOKIE_HEADER="):
            return line.split("=", 1)[1].strip()
    return ""


def main() -> int:
    har = Path(sys.argv[1] if len(sys.argv) > 1 else r"c:\Users\evans\Downloads\www.tiktok.com.har")
    video_id = sys.argv[2] if len(sys.argv) > 2 else "7636970555379289358"
    entries = load_entries(har)
    template, user_agent = pick_template(entries)
    cookie = cookie_header_from_env()
    if not cookie:
        raise RuntimeError("No TIKTOK_COOKIE_HEADER found in tmp/vps-tiktok-cookies.env")

    referer = f"https://www.tiktok.com/@user272358841430/video/{video_id}"
    params = dict(template)
    params.update(
        {
            "aweme_id": video_id,
            "item_id": video_id,
            "cursor": "0",
            "count": "20",
            "insert_ids": "",
            "rcFT": "",
            "is_non_personalized": "false",
            "referer": referer,
            "root_referer": referer,
        }
    )
    for key in ("group_list", "clear_unread", "max_time", "user_id", "app_key", "appkey"):
        params.pop(key, None)

    headers = {
        "User-Agent": user_agent,
        "Accept": "application/json, text/plain, */*",
        "Referer": referer,
        "Origin": "https://www.tiktok.com",
        "Cookie": cookie,
    }

    response = requests.get("https://www.tiktok.com/api/comment/list/", params=params, headers=headers, timeout=30)
    out = {
        "harEntries": len(entries),
        "hasCommentListCapture": any("comment/list" in (e.get("request", {}).get("url") or "") for e in entries),
        "harHasCookies": any((e.get("request", {}).get("cookies") or []) for e in entries),
        "usedHarParams": ["device_id", "verifyFp", "odinId", "msToken", "X-Bogus", "X-Gnarly"],
        "videoId": video_id,
        "status": response.status_code,
        "bodyLen": len(response.text or ""),
        "contentType": response.headers.get("content-type", ""),
    }
    body = response.text or ""
    if body:
        try:
            data = response.json()
            out["statusCode"] = data.get("statusCode", data.get("status_code"))
            out["statusMsg"] = data.get("statusMsg", data.get("status_msg"))
            comments = data.get("comments") or []
            out["commentCount"] = len(comments) if isinstance(comments, list) else 0
            if out["commentCount"]:
                c0 = comments[0]
                out["firstComment"] = str(c0.get("text") or "")[:120]
                out["firstLikes"] = c0.get("digg_count")
        except ValueError:
            out["bodyPrefix"] = body[:200]
    else:
        out["bodyPrefix"] = ""

    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
