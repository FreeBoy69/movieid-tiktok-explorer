"""Shared TikTok comment fetch helpers for one-shot and daemon modes."""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from urllib.parse import unquote

import requests

try:
    from TikTokApi import TikTokApi
except ImportError:
    TikTokApi = None


def _resolve_short_url(url: str) -> str:
    if re.search(r"(vm|vt)\.tiktok\.com", url, re.I):
        try:
            response = requests.head(url, allow_redirects=True, timeout=15)
            return response.url or url
        except requests.RequestException:
            return url
    return url


def _normalize_page_url(url: str) -> str:
    value = url.strip()
    if value.startswith("//"):
        value = "https:" + value
    return unquote(value)


def extract_video_id(url: str) -> str | None:
    match = re.search(r"/video/(\d+)", url, re.I)
    return match.group(1) if match else None


def _author_unique_id(author) -> str:
    if author is None:
        return ""
    for attr in ("unique_id", "uniqueId", "unique_id_str"):
        value = getattr(author, attr, None)
        if value:
            return str(value).strip()
    data = getattr(author, "as_dict", None) or {}
    if isinstance(data, dict):
        return str(data.get("unique_id") or data.get("uniqueId") or "").strip()
    return ""


def _comment_row(comment, replies: list[dict]) -> dict:
    return {
        "id": str(getattr(comment, "id", "") or ""),
        "text": str(getattr(comment, "text", "") or "").strip(),
        "authorUniqueId": _author_unique_id(getattr(comment, "author", None)),
        "likeCount": int(getattr(comment, "likes_count", 0) or 0),
        "replies": replies,
    }


def _patch_first_goto_only():
    from playwright.async_api import Page as PlaywrightPage

    nav_timeout = int(os.environ.get("TIKTOK_TIMEOUT_MS", "90000"))
    orig_goto = PlaywrightPage.goto

    async def goto_patched(self, url, **kwargs):
        if isinstance(url, str) and url.startswith("http"):
            kwargs.setdefault("wait_until", "domcontentloaded")
            kwargs.setdefault("timeout", nav_timeout)
        return await orig_goto(self, url, **kwargs)

    PlaywrightPage.goto = goto_patched

    def restore():
        PlaywrightPage.goto = orig_goto

    return restore


async def create_tiktok_api_session():
    if TikTokApi is None:
        raise RuntimeError("TikTokApi is not installed. Install requirements.txt on the server.")
    ms_token = (os.environ.get("TIKTOK_MS_TOKEN") or os.environ.get("ms_token") or "").strip() or None
    sleep_after = max(1, min(int(os.environ.get("TIKTOK_SLEEP_AFTER", "3")), 60))
    browser = os.environ.get("TIKTOK_BROWSER", "chromium")
    restore_goto = _patch_first_goto_only()
    try:
        api = TikTokApi()
        await api.__aenter__()
        await api.create_sessions(
            ms_tokens=[ms_token],
            num_sessions=1,
            sleep_after=sleep_after,
            browser=browser,
        )
        return api
    finally:
        restore_goto()


async def close_tiktok_api_session(api) -> None:
    if api is None:
        return
    try:
        await api.__aexit__(None, None, None)
    except Exception:
        pass


async def fetch_comments_with_api(api, url: str, comment_limit: int = 40, reply_limit: int = 12) -> dict:
    url = _normalize_page_url(_resolve_short_url(url))
    video_id = extract_video_id(url)
    if not video_id:
        raise ValueError("Could not extract TikTok video id from URL.")
    video = api.video(id=video_id, url=url)
    author_unique_id = ""
    try:
        info = getattr(video, "as_dict", None) or {}
        if isinstance(info, dict):
            author_unique_id = str((info.get("author") or {}).get("uniqueId") or (info.get("author") or {}).get("unique_id") or "").strip()
    except Exception:
        author_unique_id = ""

    threads: list[dict] = []
    async for comment in video.comments(count=comment_limit):
        replies: list[dict] = []
        if reply_limit > 0:
            try:
                async for reply in comment.replies(count=reply_limit):
                    replies.append({
                        "id": str(getattr(reply, "id", "") or ""),
                        "text": str(getattr(reply, "text", "") or "").strip(),
                        "authorUniqueId": _author_unique_id(getattr(reply, "author", None)),
                        "likeCount": int(getattr(reply, "likes_count", 0) or 0),
                    })
            except Exception:
                replies = []
        threads.append(_comment_row(comment, replies))

    return {
        "videoId": video_id,
        "authorUniqueId": author_unique_id,
        "threads": threads,
    }


async def fetch_comments_once(url: str, comment_limit: int = 40, reply_limit: int = 12) -> dict:
    api = await create_tiktok_api_session()
    try:
        return await fetch_comments_with_api(api, url, comment_limit, reply_limit)
    finally:
        await close_tiktok_api_session(api)


def read_request() -> dict:
    raw = sys.stdin.read()
    return json.loads(raw) if raw.strip() else {}


def write_response(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()
