"""
List TikTok videos for a profile, playlist/collection, or single video URL using TikTokApi.
stdin: JSON {"url": "<tiktok url>", "count": 30}
stdout: JSON { "title", "author", "videos": [...] } or {"error": "..."}
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from urllib.parse import parse_qs, unquote, urlparse

import requests

try:
    from TikTokApi import TikTokApi
    from TikTokApi.exceptions import EmptyResponseException
except ImportError:
    TikTokApi = None

    class EmptyResponseException(Exception):
        pass


def _read_input() -> tuple[str, int, str]:
    raw = sys.stdin.read()
    data = json.loads(raw) if raw.strip() else {}
    url = (data.get("url") or "").strip()
    count = int(data.get("count") or 30)
    # Optional seed used by the yt-dlp fallback when bare /@handle extraction fails —
    # resolves sec_uid from a single video and retries as `tiktokuser:SEC_UID`.
    seed_url = (data.get("seedVideoUrl") or "").strip()
    cap = int(os.environ.get("TIKTOK_LIST_MAX", "5000"))
    cap = max(30, min(cap, 10000))
    return url, max(1, min(count, cap)), seed_url


def _resolve_short_url(url: str) -> str:
    if re.search(r"(vm|vt)\.tiktok\.com", url, re.I):
        try:
            r = requests.head(url, allow_redirects=True, timeout=15)
            return r.url or url
        except requests.RequestException:
            return url
    return url


def _normalize_page_url(url: str) -> str:
    """Decode percent-encoding; support protocol-relative URLs."""
    s = url.strip()
    if s.startswith("//"):
        s = "https:" + s
    return unquote(s)


def _extract_username(url: str) -> str | None:
    m = re.search(r"tiktok\.com/@([^/?#\s]+)", url, re.I)
    if not m:
        return None
    return unquote(m.group(1).strip().lstrip("@"))


def _extract_search_query(url: str) -> str | None:
    if "tiktok.com/search" not in url.lower():
        return None
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    query = (qs.get("q") or qs.get("keyword") or [""])[0]
    query = unquote(str(query or "")).strip()
    return query or None


def _collection_name_from_url(url: str) -> str:
    try:
        path = unquote(urlparse(_normalize_page_url(url)).path)
    except Exception:
        return ""
    m = re.search(r"/collection/([^/?#]+)", path, re.I)
    if not m:
        return ""
    slug = m.group(1).strip()
    mix_id = _extract_mix_id(url) or ""
    if mix_id and slug.endswith(mix_id):
        slug = slug[: -len(mix_id)].rstrip("-_ ")
    return slug.replace("-", " ").strip()


def _tiktok_api_error_message(exc: BaseException) -> str:
    """
    TikTokApi raises EmptyResponseException with __str__ = 'None -> message' because
    error_code is None — that is not a URL-shape problem; TikTok returned an empty body.
    """
    if isinstance(exc, EmptyResponseException):
        return (
            "TikTok returned an empty response to the signed in-browser fetch (anti-bot / "
            "block). URL shape is usually fine once listing starts. Set TIKTOK_MS_TOKEN in "
            ".env.local from the ms_token cookie on tiktok.com, keep TIKTOK_HEADLESS=false "
            "or try TIKTOK_BROWSER=webkit, and consider a residential proxy. See "
            "https://github.com/davidteather/TikTok-Api#quick-start-guide"
        )
    message = str(exc) or "TikTokApi request failed"
    if "Resource temporarily unavailable" in message or "pthread_create" in message or "Zygote could not fork" in message:
        return "TikTok collection reprocess needs the browser extractor, but this cPanel server is refusing Chromium threads right now. Try again after server load drops, or move TikTok collection refreshes to a worker/VPS."
    if "BrowserType.launch" in message and "Target page, context or browser has been closed" in message:
        return "TikTok collection reprocess could not start the server browser. Try again after server load drops, or move collection refreshes to a worker/VPS."
    return message


def _truthy_env(name: str) -> bool:
    return (os.environ.get(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def _prefer_ytdlp_first() -> bool:
    driver = (os.environ.get("TIKTOK_LIST_DRIVER") or "").strip().lower()
    return (
        _truthy_env("TIKTOK_DISABLE_PLAYWRIGHT")
        or driver in {"ytdlp", "yt-dlp"}
        or (os.environ.get("NODE_ENV") or "").strip().lower() == "production"
    )


# Query keys only — avoid bare ``cid=`` (not the list snowflake). Same idea as tiktok-rewriter.
def _is_collection_url(url: str) -> bool:
    normalized = _normalize_page_url(url)
    if _extract_mix_id(normalized):
        return True
    try:
        parsed = urlparse(normalized)
        return bool(re.search(r"/(?:collection|collections|playlist|playlists?|mix)(?:/|$)", parsed.path, re.I))
    except Exception:
        return False


_COLLECTION_QUERY = re.compile(
    r"(?:[?&])(?:collection[_-]?id|list[_-]?id|mix[_-]?id|playlist[_-]?id|collectionId"
    r"|playlistId|mixId|mix_id)=([^&]+)",
    re.IGNORECASE,
)
_COLLECTION_PATH_DIGITS = re.compile(
    r"/(?:collection|collections|mix|playlist|playlists?)/(\d{6,30})(?=(?:$|[/?#]))",
    re.IGNORECASE,
)


def _digits_from_slug(segment: str) -> str | None:
    """``Title-7441837327472675591`` style path segments (tiktok-rewriter / TikTok web)."""
    if not segment or segment.isdigit():
        return None
    best = None
    for m in re.finditer(r"(\d{6,30})(?=\D*$)", segment):
        best = m.group(1)
    return best


def _last_collection_like_id_in_path(path: str) -> str | None:
    allm = re.findall(r"(?<![0-9])([0-9]{6,30})(?![0-9])", path)
    if not allm:
        return None
    for n in reversed(allm):
        if 10 <= len(n) <= 20:
            return n
    return allm[-1]


def _extract_collection_id_from_path(s: str) -> str | None:
    """Path-first collection / mix id (before query), aligned with tiktok-rewriter."""
    path = unquote(urlparse(s).path)
    pnorm = s.replace("\\", "/")
    segs = [x for x in path.split("/") if x]
    markers = frozenset(
        {
            "collection",
            "collections",
            "playlist",
            "playlists",
            "mix",
            "favorites",
            "favourite",
            "saved",
        }
    )
    for i, seg in enumerate(segs):
        sl = seg.lower()
        if sl not in markers and not (sl.startswith("collection") and len(sl) < 32):
            continue
        for j in range(i + 1, min(i + 8, len(segs) + 1)):
            if j >= len(segs):
                break
            cand = segs[j]
            if cand.isdigit() and 6 <= len(cand) <= 30:
                return cand
            ds = _digits_from_slug(cand)
            if ds:
                return ds
    m = _COLLECTION_PATH_DIGITS.search(pnorm)
    if m:
        return m.group(1)
    if re.search(
        r"/(collection|collections|playlist|playlists?|mix)(/|$|[^a-zA-Z0-9])",
        pnorm,
        re.IGNORECASE,
    ):
        got = _last_collection_like_id_in_path(path)
        if got:
            return got
    return None


def _extract_mix_id(url: str) -> str | None:
    if not url:
        return None
    s = unquote(url.strip())
    if re.fullmatch(r"\d{6,30}", s):
        return s
    if "tiktok.com" not in s.lower():
        return None
    from_path = _extract_collection_id_from_path(s)
    if from_path:
        return from_path
    m = _COLLECTION_QUERY.search(s)
    if m:
        raw = unquote(m.group(1).strip())
        if raw.isdigit() and 6 <= len(raw) <= 30:
            return raw
    return None


def _patch_tiktok_playlist_user_symbol() -> None:
    """
    TikTokApi.api.playlist references User in __extract_from_data under TYPE_CHECKING only;
    at runtime that raises ``name 'User' is not defined``. Patched in tiktok-rewriter
    backend/tiktok_api_list.py — apply before api.playlist(...).
    """
    import TikTokApi.api.playlist as playlist_mod

    if not hasattr(playlist_mod, "User"):
        from TikTokApi.api.user import User as _TikTokUser

        playlist_mod.User = _TikTokUser


def _extract_video_id(url: str) -> str | None:
    m = re.search(r"/video/(\d+)", url, re.I)
    return m.group(1) if m else None


def _num(v) -> int:
    if v is None:
        return 0
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _dimension_value(*values) -> int:
    for value in values:
        try:
            n = int(float(value))
        except (TypeError, ValueError):
            continue
        if 0 < n < 10000:
            return n
    return 0


def _duration_seconds(*values) -> int:
    for value in values:
        if isinstance(value, str):
            raw = value.strip()
            if re.fullmatch(r"\d{1,2}(?::\d{1,2}){1,2}", raw):
                parts = [int(part) for part in raw.split(":")]
                if len(parts) == 2:
                    return parts[0] * 60 + parts[1]
                if len(parts) == 3:
                    return parts[0] * 3600 + parts[1] * 60 + parts[2]
        try:
            n = float(value or 0)
        except (TypeError, ValueError):
            continue
        if n <= 0:
            continue
        return int(round(n / 1000 if n > 10000 else n))
    return 0


def _entry_dimensions(entry: dict) -> tuple[int, int]:
    width = _dimension_value(entry.get("width"), entry.get("video_width"), entry.get("thumbnail_width"))
    height = _dimension_value(entry.get("height"), entry.get("video_height"), entry.get("thumbnail_height"))
    if width and height:
        return width, height
    best: tuple[int, int] = (0, 0)
    for thumb in entry.get("thumbnails") or []:
        if not isinstance(thumb, dict):
            continue
        tw = _dimension_value(thumb.get("width"))
        th = _dimension_value(thumb.get("height"))
        if tw and th and tw * th > best[0] * best[1]:
            best = (tw, th)
    return best


def _timestamp_ms(value) -> int:
    if value in (None, ""):
        return 0
    if isinstance(value, (int, float)):
        n = float(value)
        return int(n if n > 100_000_000_000 else n * 1000)
    raw = str(value).strip()
    if not raw:
        return 0
    if re.fullmatch(r"\d{8}", raw):
        try:
            dt = datetime.strptime(raw, "%Y%m%d").replace(tzinfo=timezone.utc)
            return int(dt.timestamp() * 1000)
        except ValueError:
            return 0
    if re.fullmatch(r"\d+", raw):
        n = int(raw)
        return n if n > 100_000_000_000 else n * 1000
    try:
        normalized = raw.replace("Z", "+00:00")
        return int(datetime.fromisoformat(normalized).timestamp() * 1000)
    except ValueError:
        return 0


def _url_values(value) -> list[str]:
    if isinstance(value, str):
        raw = value.replace("\\u0026", "&").strip()
        if not raw.startswith("http"):
            return []
        parts = re.findall(r"https?://[^\s]+", raw)
        return parts or [raw]
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            out.extend(_url_values(item))
        return out
    if isinstance(value, dict):
        out: list[str] = []
        for key in ("urlList", "UrlList", "URLList", "url_list", "uri", "Uri", "url", "Url", "src", "Src"):
            out.extend(_url_values(value.get(key)))
        return out
    return []


def _bitrate_value(item: dict) -> int:
    for key in ("bitrate", "bitRate", "Bitrate"):
        try:
            return int(item.get(key) or 0)
        except (TypeError, ValueError):
            continue
    return 0


def _height_value(item: dict) -> int:
    for key in ("height", "Height", "playHeight", "PlayHeight", "play_height", "videoHeight", "VideoHeight", "video_height"):
        try:
            return int(item.get(key) or 0)
        except (TypeError, ValueError):
            continue
    raw = json.dumps(item, ensure_ascii=False).lower()
    matches = re.findall(r"([1-9]\d{2,3})p", raw)
    return max((int(match) for match in matches), default=0)


def _quality_value(item: dict) -> tuple[int, int]:
    return (_height_value(item), _bitrate_value(item))


def _media_url_candidates(video_meta: dict) -> list[str]:
    candidates: list[str] = []
    bitrate_items = (
        video_meta.get("bitRate")
        or video_meta.get("bitrateInfo")
        or video_meta.get("bitrate_info")
        or video_meta.get("BitrateInfo")
        or []
    )
    for bit in sorted(bitrate_items, key=_quality_value, reverse=True):
        if isinstance(bit, dict):
            for key in ("playAddr", "play_addr", "PlayAddr", "playAddrH264", "play_addr_h264", "playAddrH265", "play_addr_h265", "playAddrByteVC1", "playAddrByteVC2"):
                candidates.extend(_url_values(bit.get(key)))
    for key in ("PlayAddrStruct", "playAddrByteVC2", "playAddrByteVC1", "playAddrH265", "playAddrH264", "playAddr", "play_addr", "PlayAddr", "playApi", "playApiUrl"):
        candidates.extend(_url_values(video_meta.get(key)))
    for key in ("downloadAddr", "download_addr", "DownloadAddr"):
        candidates.extend(_url_values(video_meta.get(key)))

    seen: set[str] = set()
    ordered: list[str] = []
    for url in candidates:
        clean = str(url).replace("\\u0026", "&").strip()
        if not clean.startswith("http") or clean in seen:
            continue
        seen.add(clean)
        ordered.append(clean)
    return ordered


def _video_to_row(v) -> dict | None:
    d = v.as_dict
    raw_author = d.get("author")
    uploader_url = ""
    uid = ""
    nickname = ""

    if isinstance(raw_author, str):
        unique_id = raw_author
        nickname = raw_author
        uid = unique_id.lstrip("@") if unique_id else ""
        if uid:
            uploader_url = f"https://www.tiktok.com/@{uid}"
    elif isinstance(raw_author, dict):
        unique_id = raw_author.get("uniqueId") or ""
        nickname = raw_author.get("nickname") or unique_id
        uid = unique_id.lstrip("@") if unique_id else ""
        uploader_url = (raw_author.get("url") or raw_author.get("profileUrl") or "").strip()
        if uploader_url and not uploader_url.startswith("http"):
            uploader_url = ""
        if not uploader_url and uid:
            uploader_url = f"https://www.tiktok.com/@{uid}"

    stats = d.get("stats") or d.get("statsV2") or {}
    vid = str(d.get("id") or d.get("aweme_id") or "").strip()
    if not vid:
        for cand in (
            d.get("shareUrl"),
            d.get("share_url"),
            d.get("webVideoUrl"),
            d.get("videoUrl"),
        ):
            if not cand or not isinstance(cand, str):
                continue
            m = re.search(r"/video/(\d+)", cand, re.I)
            if m:
                vid = m.group(1)
                break
    if not vid or not vid.isdigit():
        return None
    # Collection items often omit uniqueId; recover @handle from share / video URLs.
    if not uid or uid == "user":
        for cand in (
            d.get("shareUrl"),
            d.get("share_url"),
            d.get("webVideoUrl"),
            d.get("videoUrl"),
        ):
            if not cand or not isinstance(cand, str):
                continue
            m = re.search(r"tiktok\.com/@([^/]+)/video/\d+", cand, re.I)
            if m:
                got = m.group(1).strip().lstrip("@")
                if got and got.lower() != "user":
                    uid = got
                    break
        if uid and uid != "user" and not uploader_url:
            uploader_url = f"https://www.tiktok.com/@{uid}"
    vm = d.get("video") or {}
    cover = vm.get("dynamicCover") or vm.get("cover") or vm.get("originCover") or ""
    media_urls = _media_url_candidates(vm)
    duration_seconds = _duration_seconds(
        vm.get("duration"),
        vm.get("durationSec"),
        vm.get("durationSeconds"),
        vm.get("duration_ms"),
        vm.get("durationMs"),
    )
    width = _dimension_value(vm.get("width"), vm.get("Width"), vm.get("videoWidth"), vm.get("video_width"), vm.get("playWidth"), vm.get("play_width"), d.get("width"))
    height = _dimension_value(vm.get("height"), vm.get("Height"), vm.get("videoHeight"), vm.get("video_height"), vm.get("playHeight"), vm.get("play_height"), d.get("height"))
    handle = uid if uid else "user"
    return {
        "id": vid,
        "title": (d.get("desc") or "")[:4000],
        "author": nickname,
        "authorHandle": handle,
        "uploaderUrl": uploader_url,
        "uploaderId": uid,
        "createdAt": _timestamp_ms(d.get("createTime") or d.get("create_time") or d.get("created_at")),
        "playUrl": f"https://www.tiktok.com/@{handle}/video/{vid}" if handle != "user" else f"https://www.tiktok.com/video/{vid}",
        "dynamicCover": cover,
        "durationSeconds": duration_seconds,
        "width": width,
        "height": height,
        "cleanPlaybackUrls": media_urls,
        "stats": {
            "diggCount": _num(stats.get("diggCount")),
            "shareCount": _num(stats.get("shareCount")),
            "commentCount": _num(stats.get("commentCount")),
            "playCount": _num(stats.get("playCount")),
        },
    }


def _video_dict_to_row(d: dict) -> dict | None:
    class _Video:
        as_dict = d

    return _video_to_row(_Video())


def _tikwm_video_to_row(item: dict) -> dict | None:
    if not isinstance(item, dict):
        return None
    vid = str(item.get("video_id") or item.get("id") or "").strip()
    if not vid.isdigit():
        return None
    author = item.get("author") if isinstance(item.get("author"), dict) else {}
    handle = str(author.get("unique_id") or item.get("author_unique_id") or item.get("unique_id") or "user").strip().lstrip("@")
    nickname = str(author.get("nickname") or handle or "").strip()
    play_url = f"https://www.tiktok.com/@{handle}/video/{vid}" if handle and handle != "user" else f"https://www.tiktok.com/video/{vid}"
    media_urls = []
    for key in ("play", "hdplay", "wmplay"):
        value = item.get(key)
        if isinstance(value, str) and value.startswith("http") and value not in media_urls:
            media_urls.append(value)
    return {
        "id": vid,
        "title": str(item.get("title") or item.get("desc") or "")[:4000],
        "author": nickname,
        "authorHandle": handle or "user",
        "uploaderUrl": f"https://www.tiktok.com/@{handle}" if handle and handle != "user" else "",
        "uploaderId": str(author.get("id") or ""),
        "createdAt": _timestamp_ms(item.get("create_time") or item.get("createTime")),
        "playUrl": play_url,
        "dynamicCover": item.get("ai_dynamic_cover") or item.get("cover") or item.get("origin_cover") or "",
        "durationSeconds": _duration_seconds(item.get("duration")),
        "width": _dimension_value(item.get("width"), item.get("video_width"), item.get("play_width"), item.get("wm_size", {}).get("width") if isinstance(item.get("wm_size"), dict) else None),
        "height": _dimension_value(item.get("height"), item.get("video_height"), item.get("play_height"), item.get("wm_size", {}).get("height") if isinstance(item.get("wm_size"), dict) else None),
        "cleanPlaybackUrls": media_urls,
        "stats": {
            "diggCount": _num(item.get("digg_count")),
            "shareCount": _num(item.get("share_count")),
            "commentCount": _num(item.get("comment_count")),
            "playCount": _num(item.get("play_count")),
        },
    }


def _env_int(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.environ.get(name) or default)
    except (TypeError, ValueError):
        value = default
    return max(low, min(value, high))


def _env_float(name: str, default: float, low: float, high: float) -> float:
    try:
        value = float(os.environ.get(name) or default)
    except (TypeError, ValueError):
        value = default
    return max(low, min(value, high))


def _search_target_count(count: int) -> int:
    return max(1, min(count, _env_int("TIKTOK_SEARCH_RESULT_MAX", 1000, 30, 5000)))


def _search_variants(query: str) -> list[str]:
    base = re.sub(r"\s+", " ", (query or "").strip())
    variants: list[str] = []

    def add(value: str) -> None:
        cleaned = re.sub(r"\s+", " ", (value or "").strip())
        if cleaned and cleaned.lower() not in {v.lower() for v in variants}:
            variants.append(cleaned)

    add(base)
    add(re.sub(r"(?i)\bai(?=[a-z0-9])", "ai ", base))
    add(re.sub(r"(?i)\bai\s+", "ai", base))
    add(re.sub(r"[#@]+", " ", base))
    add(
        re.sub(
            r"(?i)\b(cartoons|recaps|clips|stories|movies|animes)\b",
            lambda m: m.group(1)[:-1],
            base,
        )
    )
    return variants[: _env_int("TIKTOK_SEARCH_VARIANTS_MAX", 4, 1, 10)]


def _search_via_tikwm(url: str, count: int) -> dict:
    query = _extract_search_query(_normalize_page_url(url))
    if not query:
        raise RuntimeError("Not a TikTok search URL")
    target_count = _search_target_count(count)
    max_pages = _env_int("TIKTOK_TIKWM_SEARCH_MAX_PAGES", 40, 1, 200)
    page_delay = _env_float("TIKTOK_SEARCH_PAGE_DELAY", 1.1, 0, 10)
    videos: list[dict] = []
    seen: set[str] = set()
    last_error: str | None = None

    for search_query in _search_variants(query):
        cursor = 0
        empty_pages = 0
        for _ in range(max_pages):
            remaining = max(1, target_count - len(videos))
            response = None
            for attempt in range(4):
                response = requests.get(
                    "https://www.tikwm.com/api/feed/search",
                    params={"keywords": search_query, "count": str(min(30, remaining)), "cursor": str(cursor), "hd": "1"},
                    headers={
                        "User-Agent": os.environ.get("TIKTOK_USER_AGENT")
                        or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                        "Accept": "application/json, text/plain, */*",
                    },
                    timeout=30,
                )
                text = response.text or ""
                if "1 request/second" not in text and "Free Api Limit" not in text:
                    break
                time.sleep(1.25 + attempt * 0.75)
            if response is None:
                last_error = "TikWM search did not return a response"
                break
            if response.status_code >= 400:
                last_error = f"TikWM search returned HTTP {response.status_code}"
                break
            data = response.json()
            if int(data.get("code") or 0) != 0:
                last_error = data.get("msg") or "TikWM search failed"
                break
            payload = data.get("data") if isinstance(data.get("data"), dict) else {}
            items = payload.get("videos") or []
            added = 0
            for item in items:
                row = _tikwm_video_to_row(item)
                if row is None or row["id"] in seen:
                    continue
                seen.add(row["id"])
                videos.append(row)
                added += 1
                if len(videos) >= target_count:
                    break
            if added == 0:
                empty_pages += 1
            else:
                empty_pages = 0
            if len(videos) >= target_count or not payload.get("hasMore") or not items or empty_pages >= 2:
                break
            next_cursor = int(payload.get("cursor") or cursor + len(items) or cursor + 30)
            if next_cursor == cursor:
                break
            cursor = next_cursor
            if page_delay:
                time.sleep(page_delay)
        if len(videos) >= target_count:
            break
    if not videos:
        raise RuntimeError(last_error or "TikWM search returned 0 entries")
    return {"title": f"Search: {query}", "author": "TikTok search", "videos": videos, "source": "tikwm-search-deep"}


def _search_via_web_api(url: str, count: int) -> dict:
    query = _extract_search_query(_normalize_page_url(url))
    if not query:
        raise RuntimeError("Not a TikTok search URL")
    target_count = _search_target_count(count)
    max_pages = _env_int("TIKTOK_WEB_SEARCH_MAX_PAGES", 40, 1, 200)
    page_delay = _env_float("TIKTOK_SEARCH_PAGE_DELAY", 1.1, 0, 10)
    cookie = (os.environ.get("TIKTOK_COOKIE_HEADER") or os.environ.get("TIKTOK_COOKIES") or "").strip()
    ms_token = (os.environ.get("TIKTOK_MS_TOKEN") or os.environ.get("ms_token") or "").strip()
    if not cookie and ms_token:
        cookie = f"msToken={ms_token}; ms_token={ms_token}"
    headers = {
        "User-Agent": os.environ.get("TIKTOK_USER_AGENT")
        or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": f"https://www.tiktok.com/search?q={query}",
    }
    if cookie:
        headers["Cookie"] = cookie
    videos: list[dict] = []
    seen: set[str] = set()
    for search_query in _search_variants(query):
        cursor = 0
        search_id = ""
        empty_pages = 0
        for _ in range(max_pages):
            params = {
                "keyword": search_query,
                "cursor": str(cursor),
                "from_page": "search",
                "count": str(min(30, max(1, target_count - len(videos)))),
                "web_search_code": '{"tiktok":{"client_params_x":{"search_engine":{"ies_mt_user_live_video_card_use_libra":1,"mt_search_general_user_live_card":1}},"search_server":{}}}',
            }
            if search_id:
                params["search_id"] = search_id
            response = requests.get(
                "https://www.tiktok.com/api/search/item/full/",
                params=params,
                headers=headers,
                timeout=30,
            )
            if response.status_code >= 400:
                raise RuntimeError(f"TikTok search API returned HTTP {response.status_code}")
            data = response.json()
            items = data.get("item_list") or []
            added = 0
            for item in items:
                row = _video_dict_to_row(item) if isinstance(item, dict) else None
                if row is None or row["id"] in seen:
                    continue
                seen.add(row["id"])
                videos.append(row)
                added += 1
                if len(videos) >= target_count:
                    break
            if added == 0:
                empty_pages += 1
            else:
                empty_pages = 0
            if len(videos) >= target_count or not data.get("has_more") or empty_pages >= 2:
                break
            next_cursor = int(data.get("cursor") or cursor + len(items) or cursor + 30)
            if next_cursor == cursor:
                break
            cursor = next_cursor
            search_id = data.get("rid") or search_id
            if page_delay:
                time.sleep(page_delay)
        if len(videos) >= target_count:
            break
    if not videos:
        raise RuntimeError("TikTok search returned 0 entries")
    return {"title": f"Search: {query}", "author": "TikTok search", "videos": videos, "source": "tiktok-search-api-deep"}


def _tiktok_cookie_header() -> str:
    cookie = (os.environ.get("TIKTOK_COOKIE_HEADER") or os.environ.get("TIKTOK_COOKIES") or "").strip()
    ms_token = (os.environ.get("TIKTOK_MS_TOKEN") or os.environ.get("ms_token") or "").strip()
    if not cookie and ms_token:
        cookie = f"msToken={ms_token}; ms_token={ms_token}"
    return cookie


def _tiktok_web_user_agent(use_env: bool = True) -> str:
    return (
        (os.environ.get("TIKTOK_USER_AGENT") if use_env else "")
        or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )


def _tiktok_web_headers(referer: str, include_cookie: bool = True, use_env_user_agent: bool = True) -> dict:
    headers = {
        "User-Agent": _tiktok_web_user_agent(use_env_user_agent),
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://www.tiktok.com",
        "Referer": referer or "https://www.tiktok.com/",
    }
    cookie = _tiktok_cookie_header() if include_cookie else ""
    if cookie:
        headers["Cookie"] = cookie
    return headers


def _tiktok_web_params(extra: dict | None = None, include_ms_token: bool = True, use_env_user_agent: bool = True) -> dict:
    ua = _tiktok_web_user_agent(use_env_user_agent)
    params = {
        "aid": "1988",
        "app_language": os.environ.get("TIKTOK_APP_LANGUAGE") or "en",
        "app_name": "tiktok_web",
        "browser_language": os.environ.get("TIKTOK_BROWSER_LANGUAGE") or "en-US",
        "browser_name": "Mozilla",
        "browser_online": "true",
        "browser_platform": os.environ.get("TIKTOK_BROWSER_PLATFORM") or "Win32",
        "browser_version": ua,
        "channel": "tiktok_web",
        "cookie_enabled": "true",
        "device_platform": "web_pc",
        "focus_state": "true",
        "from_page": "playlist",
        "history_len": "3",
        "is_fullscreen": "false",
        "is_page_visible": "true",
        "language": os.environ.get("TIKTOK_LANGUAGE") or "en",
        "os": os.environ.get("TIKTOK_OS") or "windows",
        "priority_region": "",
        "referer": "",
        "region": os.environ.get("TIKTOK_REGION") or "US",
        "screen_height": os.environ.get("TIKTOK_SCREEN_HEIGHT") or "1080",
        "screen_width": os.environ.get("TIKTOK_SCREEN_WIDTH") or "1920",
        "tz_name": os.environ.get("TIKTOK_TZ_NAME") or "Africa/Nairobi",
        "webcast_language": os.environ.get("TIKTOK_WEBCAST_LANGUAGE") or "en",
    }
    ms_token = (os.environ.get("TIKTOK_MS_TOKEN") or os.environ.get("ms_token") or "").strip() if include_ms_token else ""
    if ms_token:
        params["msToken"] = ms_token
    device_id = (os.environ.get("TIKTOK_DEVICE_ID") or "").strip()
    if device_id:
        params["device_id"] = device_id
    if extra:
        params.update(extra)
    return params


def _tiktok_json(response: requests.Response, label: str) -> dict:
    if response.status_code >= 400:
        raise RuntimeError(f"{label} returned HTTP {response.status_code}")
    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError(f"{label} returned a non-JSON response") from exc
    status_code = data.get("statusCode", data.get("status_code", 0))
    try:
        status_num = int(status_code or 0)
    except (TypeError, ValueError):
        status_num = 0
    if status_num != 0:
        raise RuntimeError(data.get("statusMsg") or data.get("status_msg") or f"{label} returned status {status_code}")
    return data


def _collection_via_web_api_attempt(url: str, count: int, include_cookie: bool, use_env_user_agent: bool) -> dict:
    normalized = _normalize_page_url(_resolve_short_url(url))
    mix_id = _extract_mix_id(normalized)
    if not mix_id:
        raise RuntimeError("Could not parse TikTok collection id")

    headers = _tiktok_web_headers(normalized, include_cookie=include_cookie, use_env_user_agent=use_env_user_agent)
    include_ms_token = include_cookie
    detail = _tiktok_json(
        requests.get(
            "https://www.tiktok.com/api/mix/detail/",
            params=_tiktok_web_params({"mixId": mix_id}, include_ms_token=include_ms_token, use_env_user_agent=use_env_user_agent),
            headers=headers,
            timeout=30,
        ),
        "TikTok collection detail",
    )
    mix_info = detail.get("mixInfo") if isinstance(detail.get("mixInfo"), dict) else {}
    creator = mix_info.get("creator") if isinstance(mix_info.get("creator"), dict) else {}
    title = str(mix_info.get("name") or "Playlist")
    author = str(creator.get("nickname") or creator.get("uniqueId") or _extract_username(normalized) or "")

    videos: list[dict] = []
    seen: set[str] = set()
    cursor = "0"
    for _ in range(max(1, (count + 29) // 30 + 2)):
        page_size = str(min(30, max(1, count - len(videos))))
        data = _tiktok_json(
            requests.get(
                "https://www.tiktok.com/api/mix/item_list/",
                params=_tiktok_web_params(
                    {"mixId": mix_id, "count": page_size, "cursor": str(cursor)},
                    include_ms_token=include_ms_token,
                    use_env_user_agent=use_env_user_agent,
                ),
                headers=headers,
                timeout=30,
            ),
            "TikTok collection items",
        )
        items = data.get("itemList") or data.get("item_list") or []
        if not isinstance(items, list) or not items:
            break
        for item in items:
            row = _video_dict_to_row(item) if isinstance(item, dict) else None
            if row is None or row["id"] in seen:
                continue
            seen.add(row["id"])
            videos.append(row)
            if len(videos) >= count:
                break
        if len(videos) >= count or not data.get("hasMore", data.get("has_more")):
            break
        cursor = str(data.get("cursor") or len(videos))
    if not videos:
        raise RuntimeError("TikTok collection web API returned 0 entries")
    return {"title": title, "author": author, "videos": videos, "source": "tiktok-collection-api"}


def _collection_via_web_api(url: str, count: int) -> dict:
    errors: list[str] = []
    attempts = [
        ("direct", False, False),
        ("session", True, True),
    ]
    for label, include_cookie, use_env_user_agent in attempts:
        try:
            result = _collection_via_web_api_attempt(url, count, include_cookie, use_env_user_agent)
            result["source"] = f"tiktok-collection-api-{label}"
            return result
        except Exception as exc:
            errors.append(f"{label}: {exc}")
    raise RuntimeError("; ".join(errors))


def _user_display_name(user) -> str:
    if user is None:
        return ""
    d = getattr(user, "as_dict", None) or {}
    if isinstance(d, dict) and "userInfo" in d:
        u = d["userInfo"].get("user") or {}
        return u.get("nickname") or u.get("uniqueId") or getattr(user, "username", "") or ""
    if isinstance(d, dict):
        return d.get("nickname") or getattr(user, "username", "") or ""
    return getattr(user, "username", "") or ""


def _patch_first_goto_only():
    """
    TikTok-Api calls ``page.goto()`` BEFORE ``set_default_navigation_timeout()``, so the
    very first navigation uses Playwright's 30s default with ``wait_until='load'`` —
    TikTok often never reaches 'load', so the session creation times out.

    Patch ONLY ``page.goto``; leave ``wait_for_load_state('networkidle')`` alone so
    stealth / msToken initialisation completes the same way as tiktok-rewriter.
    """
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


async def _run(url: str, count: int) -> dict:
    """
    Matches tiktok-rewriter/backend/tiktok_api_list.py: minimal TikTokApi.create_sessions
    (ms_tokens, num_sessions, sleep_after, browser). The only Playwright tweak is a
    narrow ``page.goto`` patch so the initial navigation doesn't hit the 30s default
    (TikTok-Api sets the real timeout AFTER the first goto). We do NOT touch
    ``wait_for_load_state`` / ``evaluate`` — those are required for stealth + msToken
    cookie init, otherwise signed requests return empty responses.

    No upfront ``user.info()`` either — we rely on ``user.videos()`` /
    ``playlist.info()`` to initialise lazily, same as the rewriter backend does.
    """
    url = _normalize_page_url(_resolve_short_url(url))
    if TikTokApi is None:
        raise RuntimeError(
            "TikTokApi is not installed. Install requirements or use TIKTOK_LIST_DRIVER=ytdlp."
        )
    ms_token = (os.environ.get("TIKTOK_MS_TOKEN") or os.environ.get("ms_token") or "").strip() or None
    mix_id = _extract_mix_id(url)
    username = _extract_username(url)
    video_id = _extract_video_id(url)
    search_query = _extract_search_query(url)

    sleep_after = int(os.environ.get("TIKTOK_SLEEP_AFTER", "3"))
    sleep_after = max(1, min(sleep_after, 60))
    browser = os.environ.get("TIKTOK_BROWSER", "chromium")

    restore_goto = _patch_first_goto_only()
    try:
        async with TikTokApi() as api:
            try:
                await api.create_sessions(
                    ms_tokens=[ms_token],
                    num_sessions=1,
                    sleep_after=sleep_after,
                    browser=browser,
                )
            except Exception as exc:
                hint = (
                    " (Server-side Playwright.) Set TIKTOK_MS_TOKEN in .env.local from the"
                    " ms_token cookie on tiktok.com; optionally TIKTOK_SLEEP_AFTER=8 or"
                    " TIKTOK_BROWSER=webkit — see"
                    " https://github.com/davidteather/TikTok-Api#quick-start-guide"
                )
                raise RuntimeError(f"{exc}{hint}") from exc

            videos: list[dict] = []
            title = ""
            author = ""

            if search_query:
                title = f"Search: {search_query}"
                author = "TikTok search"
                async for v in api.search.search_type(search_query, "item", count=count):
                    row = _video_to_row(v)
                    if row is not None:
                        videos.append(row)

            elif mix_id:
                _patch_tiktok_playlist_user_symbol()
                pl = api.playlist(id=str(mix_id))
                await pl.info()
                title = pl.name or "Playlist"
                cr = pl.creator
                author = (
                    _user_display_name(cr) if cr else (username or "")
                ) or (username or "")
                async for v in pl.videos(count=count):
                    row = _video_to_row(v)
                    if row is not None:
                        videos.append(row)

            elif video_id:
                v = api.video(url=url)
                await v.info()
                row = _video_to_row(v)
                if row is not None:
                    videos.append(row)
                title = "Video"
                a = v.author
                author = _user_display_name(a) if a else (username or "")

            elif username:
                # Rewriter skips the upfront `u.info()` — `user.videos()` calls it lazily.
                # One extra signed /api/user/detail/ call is a common bot-detection trigger.
                u = api.user(username)
                title = f"@{username}"
                async for v in u.videos(count=count):
                    row = _video_to_row(v)
                    if row is not None:
                        videos.append(row)
                if not author and videos:
                    author = videos[0].get("author") or username
                if not author:
                    author = username

            else:
                return {
                    "error": "Could not parse TikTok URL. Use a profile (e.g. https://www.tiktok.com/@user), a playlist/collection link, or a video URL."
                }

            return {"title": title, "author": author, "videos": videos}
    finally:
        restore_goto()


def _ytdlp_videos(url: str, count: int) -> dict:
    """
    yt-dlp flat extraction fallback — same strategy tiktok-rewriter/backend/server.py
    uses when `fetch_profile_playlist` throws. Reliable for @profile and /video/ links;
    collection/playlist URLs may or may not resolve depending on yt-dlp coverage.
    """
    import yt_dlp  # type: ignore

    count = max(1, min(count, 10000))
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
        "playliststart": 1,
        "playlistend": count,
        "socket_timeout": 60,
        "retries": 3,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        raise RuntimeError("yt-dlp returned no data for this URL")

    mix_id = _extract_mix_id(url) if _is_collection_url(url) else None
    if mix_id:
        extractor = str(info.get("extractor") or "").lower()
        extracted_id = str(info.get("id") or "").strip()
        if extractor != "tiktok:collection" or extracted_id != str(mix_id):
            raise RuntimeError(
                "yt-dlp did not return the exact TikTok collection; refusing profile fallback."
            )

    # Profile page: info is a playlist with `entries`. Single video: info IS the entry.
    raw_entries = info.get("entries") if isinstance(info, dict) else None
    if raw_entries is None and isinstance(info, dict) and info.get("id"):
        raw_entries = [info]
    raw_entries = raw_entries or []

    url_username = _extract_username(url)
    top_uploader_url = info.get("uploader_url") if isinstance(info, dict) else ""
    top_handle = _extract_username(top_uploader_url or "") or url_username or ""
    top_uploader = (info.get("uploader") if isinstance(info, dict) else "") or top_handle

    def _handle_for(entry: dict) -> str:
        # yt-dlp's per-entry `uploader_id` on TikTok is the numeric user id, not the
        # @handle; the pretty handle lives in `uploader_url` (or `webpage_url`).
        for candidate in (entry.get("uploader_url"), entry.get("webpage_url"), entry.get("url")):
            got = _extract_username(str(candidate or ""))
            if got:
                return got
        return top_handle or "user"

    videos: list[dict] = []
    for e in raw_entries:
        if not isinstance(e, dict):
            continue
        vid = str(e.get("id") or "").strip()
        if not vid.isdigit():
            m = re.search(r"/video/(\d+)", str(e.get("webpage_url") or e.get("url") or ""), re.I)
            if m:
                vid = m.group(1)
        if not vid:
            continue
        handle = _handle_for(e)
        nickname = e.get("uploader") or top_uploader or handle
        uploader_url = (
            e.get("uploader_url")
            or (f"https://www.tiktok.com/@{handle}" if handle and handle != "user" else "")
        )
        thumb = e.get("thumbnail")
        if not thumb:
            thumbs = e.get("thumbnails") or []
            if thumbs:
                thumb = thumbs[-1].get("url")
        width, height = _entry_dimensions(e)
        videos.append(
            {
                "id": vid,
                "title": (e.get("title") or "")[:4000],
                "author": nickname,
                "authorHandle": handle,
                "uploaderUrl": uploader_url,
                "uploaderId": handle,
                "createdAt": _timestamp_ms(e.get("timestamp") or e.get("release_timestamp") or e.get("upload_date") or e.get("modified_timestamp")),
                "durationSeconds": _duration_seconds(e.get("duration"), e.get("duration_string")),
                "width": width,
                "height": height,
                "playUrl": (
                    f"https://www.tiktok.com/@{handle}/video/{vid}"
                    if handle and handle != "user"
                    else f"https://www.tiktok.com/video/{vid}"
                ),
                "dynamicCover": thumb or "",
                "stats": {
                    "diggCount": 0,
                    "shareCount": 0,
                    "commentCount": 0,
                    "playCount": _num(e.get("view_count")),
                },
            }
        )

    title = ""
    collection_title = _collection_name_from_url(url) if mix_id else ""
    if collection_title:
        title = collection_title
    elif mix_id and isinstance(info, dict) and info.get("title"):
        title = info["title"]
    elif top_handle:
        title = f"@{top_handle}"
    elif isinstance(info, dict) and info.get("title"):
        title = info["title"]
    else:
        title = "Videos"
    author = top_uploader or (videos[0].get("author") if videos else (url_username or ""))
    return {"title": title, "author": author, "videos": videos, "source": "yt-dlp"}


async def _search_via_tiktok_api(url: str, count: int) -> dict:
    query = _extract_search_query(_normalize_page_url(url))
    if not query:
        raise RuntimeError("Not a TikTok search URL")
    result = await _run(url, count)
    result["source"] = result.get("source") or "tiktok-search"
    return result


async def _ytdlp_fallback_async(url: str, count: int) -> dict:
    return await asyncio.to_thread(_ytdlp_videos, url, count)


def _ytdlp_videos_via_seed(seed_video_url: str, count: int) -> dict:
    """
    Secondary yt-dlp fallback for when `@handle` profile extraction fails with
    "Unable to extract secondary user ID". yt-dlp's tiktok:user extractor also accepts
    ``tiktokuser:SEC_UID`` inputs (documented in its own error), so we pull ``channel_id``
    (== sec_uid) out of a single video from that creator and retry through that path.
    Entries from ``tiktokuser:*`` are sparse (no webpage_url / uploader_url), so we
    reconstruct play URLs + author fields from the seed video's metadata.
    """
    import yt_dlp  # type: ignore

    count = max(1, min(count, 10000))
    with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True}) as ydl:
        seed_info = ydl.extract_info(seed_video_url, download=False)
    if not isinstance(seed_info, dict):
        raise RuntimeError("Could not resolve seed video metadata")
    sec_uid = seed_info.get("channel_id") or ""
    if not sec_uid:
        raise RuntimeError("Seed video has no sec_uid (channel_id) — cannot retry via tiktokuser:")
    handle = (
        _extract_username(seed_info.get("uploader_url") or "")
        or (seed_info.get("uploader") or "").lstrip("@")
        or _extract_username(seed_video_url)
        or ""
    )
    nickname = seed_info.get("uploader") or handle
    uploader_url = (
        seed_info.get("uploader_url")
        or (f"https://www.tiktok.com/@{handle}" if handle else "")
    )

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
        "playliststart": 1,
        "playlistend": count,
        "socket_timeout": 60,
        "retries": 3,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        plinfo = ydl.extract_info(f"tiktokuser:{sec_uid}", download=False)
    raw_entries = (plinfo or {}).get("entries") or []

    videos: list[dict] = []
    for e in raw_entries:
        if not isinstance(e, dict):
            continue
        vid = str(e.get("id") or "").strip()
        if not vid.isdigit():
            continue
        thumb = e.get("thumbnail")
        if not thumb:
            thumbs = e.get("thumbnails") or []
            if thumbs:
                thumb = thumbs[-1].get("url")
        width, height = _entry_dimensions(e)
        videos.append(
            {
                "id": vid,
                "title": (e.get("title") or "")[:4000],
                "author": nickname or handle or "user",
                "authorHandle": handle or "user",
                "uploaderUrl": uploader_url,
                "uploaderId": handle or "user",
                "createdAt": _timestamp_ms(e.get("timestamp") or e.get("release_timestamp") or e.get("upload_date") or e.get("modified_timestamp")),
                "durationSeconds": _duration_seconds(e.get("duration"), e.get("duration_string")),
                "width": width,
                "height": height,
                "playUrl": (
                    f"https://www.tiktok.com/@{handle}/video/{vid}"
                    if handle
                    else f"https://www.tiktok.com/video/{vid}"
                ),
                "dynamicCover": thumb or "",
                "stats": {
                    "diggCount": 0,
                    "shareCount": 0,
                    "commentCount": 0,
                    "playCount": _num(e.get("view_count")),
                },
            }
        )

    return {
        "title": f"@{handle}" if handle else "Videos",
        "author": nickname or handle or "",
        "videos": videos,
        "source": "yt-dlp-tiktokuser",
    }


async def _ytdlp_via_seed_async(seed_video_url: str, count: int) -> dict:
    return await asyncio.to_thread(_ytdlp_videos_via_seed, seed_video_url, count)


async def main():
    try:
        url, count, seed_url = _read_input()
        if not url:
            print(json.dumps({"error": "url is required"}))
            return
        transient = (
            "Execution context was destroyed",
            "most likely because of a navigation",
        )
        primary_error: BaseException | None = None
        fb_error: BaseException | None = None
        collection_web_error: BaseException | None = None
        search_url = _extract_search_query(_normalize_page_url(url))
        collection_url = _is_collection_url(url)
        video_url = bool(_extract_video_id(_normalize_page_url(url)))

        if search_url:
            try:
                result = await asyncio.to_thread(_search_via_tikwm, url, count)
                if result.get("videos"):
                    print(json.dumps(result))
                    return
                raise RuntimeError("TikWM search returned 0 entries")
            except Exception as tikwm_search_err:
                try:
                    result = await asyncio.to_thread(_search_via_web_api, url, count)
                    if result.get("videos"):
                        print(json.dumps(result))
                        return
                    raise RuntimeError("TikTok web search returned 0 entries")
                except Exception as web_search_err:
                    print(json.dumps({"error": f"TikTok search failed via TikWM and TikTok web API: TikWM: {tikwm_search_err}; TikTok web: {web_search_err}"}))
                    return

        if collection_url or video_url or _prefer_ytdlp_first():
            try:
                result = await _ytdlp_fallback_async(url, count)
                if result.get("videos"):
                    print(json.dumps(result))
                    return
                raise RuntimeError("yt-dlp returned 0 entries")
            except Exception as fb_err:
                fb_error = fb_err

            needs_seed_retry = seed_url and (
                "secondary user ID" in str(fb_error or "")
                or "tiktokuser:" in str(fb_error or "")
            )
            if needs_seed_retry:
                try:
                    result = await _ytdlp_via_seed_async(seed_url, count)
                    if result.get("videos"):
                        print(json.dumps(result))
                        return
                    raise RuntimeError("yt-dlp (tiktokuser:) returned 0 entries")
                except Exception as seed_err:
                    fb_error = RuntimeError(f"{fb_error}; seed retry: {seed_err}")

            if _truthy_env("TIKTOK_DISABLE_PLAYWRIGHT"):
                print(json.dumps({"error": f"yt-dlp fallback failed: {fb_error}"}))
                return

        if collection_url:
            try:
                result = await asyncio.to_thread(_collection_via_web_api, url, count)
                if result.get("videos"):
                    print(json.dumps(result))
                    return
                raise RuntimeError("TikTok collection web API returned 0 entries")
            except Exception as web_collection_err:
                collection_web_error = web_collection_err

        for attempt in range(2):
            try:
                result = await _run(url, count)
                print(json.dumps(result))
                return
            except Exception as e:
                if attempt == 0 and any(m in str(e) for m in transient):
                    await asyncio.sleep(2.5)
                    continue
                primary_error = e
                break

        # tiktok-rewriter behaviour: when TikTok-Api (Playwright) fails for a profile or
        # video URL, fall back to yt-dlp flat extraction. Keeps the explorer responsive
        # even when TikTok is bot-blocking the signed in-browser fetch.
        if collection_url:
            primary_msg = _tiktok_api_error_message(primary_error) if primary_error else ""
            if collection_web_error and primary_msg:
                primary_msg = f"TikTok collection web API failed: {collection_web_error}; browser fallback failed: {primary_msg}"
            elif collection_web_error:
                primary_msg = f"TikTok collection web API failed: {collection_web_error}"
            print(json.dumps({"error": primary_msg or "Could not reprocess this TikTok collection without returning a profile fallback."}))
            return

        if fb_error is None:
            try:
                result = await _ytdlp_fallback_async(url, count)
                if result.get("videos"):
                    print(json.dumps(result))
                    return
                raise RuntimeError("yt-dlp returned 0 entries")
            except Exception as fb_err:
                fb_error = fb_err

        # Second-level fallback for "Unable to extract secondary user ID" (yt-dlp can't
        # read sec_uid from the bare @handle page, but it CAN from any one video). The
        # frontend forwards the clicked video's playUrl as `seedVideoUrl` for this.
        needs_seed_retry = seed_url and (
            "secondary user ID" in str(fb_error or "")
            or "tiktokuser:" in str(fb_error or "")
        )
        if needs_seed_retry:
            try:
                result = await _ytdlp_via_seed_async(seed_url, count)
                if result.get("videos"):
                    print(json.dumps(result))
                    return
                raise RuntimeError("yt-dlp (tiktokuser:) returned 0 entries")
            except Exception as seed_err:
                fb_error = RuntimeError(f"{fb_error}; seed retry: {seed_err}")

        primary_msg = _tiktok_api_error_message(primary_error) if primary_error else ""
        combined = (
            f"{primary_msg} (yt-dlp fallback also failed: {fb_error})".strip()
            if primary_msg
            else f"yt-dlp fallback failed: {fb_error}"
        )
        print(json.dumps({"error": combined}))
    except Exception as e:
        print(json.dumps({"error": _tiktok_api_error_message(e)}))


if __name__ == "__main__":
    asyncio.run(main())
