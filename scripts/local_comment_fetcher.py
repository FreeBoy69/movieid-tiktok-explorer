"""
Mode A: persistent Playwright profile → capture TikTok comment XHRs.

Setup (once):
  py -3 scripts/tiktok_profile_login.py

Fetch:
  py -3 scripts/local_comment_fetcher.py <video_url> [video_url ...]

Env:
  MODE_A_PROFILE   profile dir (default tmp/tiktok-browser-profile)
  MODE_A_HEADLESS  true|false (default true after login)
  MODE_A_COMMENT_LIMIT  top-level comments (default 40)
  MODE_A_REPLY_LIMIT    replies per thread (default 12)
  MODE_A_REPLY_THREADS  threads to expand via /api/comment/list/reply/ (default 10)
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import (
    BrowserContext,
    Page,
    Request,
    Response,
    TimeoutError as PWTimeoutError,
    sync_playwright,
)

try:
    from playwright_stealth import Stealth  # type: ignore
except ImportError:
    Stealth = None  # type: ignore

from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[1]
PROFILE_DIR = Path(os.environ.get("MODE_A_PROFILE", str(ROOT / "tmp" / "tiktok-browser-profile")))
COMMENT_LIMIT = max(5, min(int(os.environ.get("MODE_A_COMMENT_LIMIT") or "40"), 80))
REPLY_LIMIT = max(0, min(int(os.environ.get("MODE_A_REPLY_LIMIT") or "12"), 30))
REPLY_THREADS = max(0, min(int(os.environ.get("MODE_A_REPLY_THREADS") or "10"), 30))

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)

VIDEO_ID_RE = re.compile(r"/video/(\d+)")

BLOCK_RESOURCE_TYPES = {"media", "font"}
BLOCK_URL_SUBSTRINGS = (
    ".mp4",
    ".m3u8",
    ".ts",
    ".webm",
    ".mp3",
    ".aac",
    "/media-video-",
    "/media-audio-",
)


def has_session(context: BrowserContext) -> bool:
    for c in context.cookies():
        if c.get("name") in ("sessionid", "sessionid_ss") and c.get("value"):
            return True
    return False


def video_id_of(url: str) -> str:
    match = VIDEO_ID_RE.search(url)
    return match.group(1) if match else ""


def should_block(request: Request) -> bool:
    if request.resource_type in BLOCK_RESOURCE_TYPES:
        return True
    url = request.url.lower()
    return any(sub in url for sub in BLOCK_URL_SUBSTRINGS)


def comment_row(item: dict) -> dict:
    user = item.get("user") if isinstance(item.get("user"), dict) else {}
    return {
        "id": str(item.get("cid") or item.get("comment_id") or ""),
        "text": str(item.get("text") or "").strip(),
        "authorUniqueId": str(user.get("unique_id") or user.get("uniqueId") or "").strip(),
        "likeCount": int(item.get("digg_count") or 0),
        "replyCount": int(item.get("reply_comment_total") or 0),
    }


def open_comments_panel(page: Page) -> str:
    """Open desktop/mobile comment UI; return strategy label or empty string."""
    for attempt in range(2):
        if attempt:
            page.wait_for_timeout(2000)

        def try_desktop_tab() -> None:
            tab = page.get_by_role("tab", name=re.compile(r"^Comments\b", re.I)).first
            tab.click(timeout=4000)

        def try_comment_count_button() -> None:
            page.locator('[data-e2e="comment-icon"], [data-e2e="browse-comment-count"]').first.click(timeout=4000)

        def try_aria_comment_button() -> None:
            page.locator('button[aria-label*="comment" i]').first.click(timeout=4000)

        def try_side_tab_text() -> None:
            page.locator('[role="tab"]:has-text("Comments")').first.click(timeout=4000)

        def try_comment_action_button() -> None:
            page.locator('button:has-text("Read or add comments"), button:has-text("comments")').first.click(timeout=4000)

        for label, fn in (
            ("desktop-tab", try_desktop_tab),
            ("side-tab-text", try_side_tab_text),
            ("comment-icon", try_comment_count_button),
            ("aria-comment", try_aria_comment_button),
            ("action-button", try_comment_action_button),
        ):
            try:
                fn()
                page.wait_for_timeout(1200)
                return label
            except Exception:
                continue
    return ""


def scroll_comment_panel(page: Page) -> None:
    selectors = (
        '[data-e2e="comment-list"]',
        '[data-e2e="comment-list-container"]',
        'div[class*="CommentListContainer"]',
        'div[class*="DivCommentListContainer"]',
        '[data-e2e="comment-level-1"]',
    )
    for sel in selectors:
        loc = page.locator(sel).first
        try:
            if loc.count() > 0 and loc.is_visible(timeout=500):
                loc.evaluate("(el) => { el.scrollTop = (el.scrollTop || 0) + 900; }")
                return
        except Exception:
            continue
    page.mouse.wheel(0, 900)


def expand_replies(page: Page, max_threads: int = REPLY_THREADS, top_list: list[dict] | None = None) -> int:
    """Click visible 'View N replies' controls to trigger /api/comment/list/reply/."""
    if max_threads <= 0:
        return 0

    expanded = expand_replies_scoped(page, max_threads)
    if expanded >= max_threads:
        page.wait_for_timeout(1500)
        return expanded

    patterns = (
        re.compile(r"view\s+\d+\s+repl", re.I),
        re.compile(r"\d+\s+repl(?:ies|y)", re.I),
    )
    for pattern in patterns:
        loc = page.get_by_text(pattern)
        try:
            count = loc.count()
        except Exception:
            count = 0
        for i in range(min(count, max_threads - expanded)):
            item = loc.nth(i)
            try:
                item.scroll_into_view_if_needed(timeout=2000)
                item.click(timeout=2500)
                page.wait_for_timeout(900)
                expanded += 1
            except Exception:
                continue
        if expanded:
            break

    if expanded >= max_threads:
        page.wait_for_timeout(1500)
        return expanded

    selectors = (
        '[data-e2e="view-more-1"]',
        '[data-e2e="comment-view-more"]',
        'span[data-e2e="view-more-1"]',
    )
    for sel in selectors:
        loc = page.locator(sel)
        try:
            count = loc.count()
        except Exception:
            continue
        for i in range(min(count, max_threads - expanded)):
            try:
                loc.nth(i).scroll_into_view_if_needed(timeout=2000)
                loc.nth(i).click(timeout=2500)
                page.wait_for_timeout(900)
                expanded += 1
            except Exception:
                continue
        if expanded:
            break

    if expanded:
        page.wait_for_timeout(1500)
    return expanded


def expand_replies_scoped(page: Page, max_threads: int) -> int:
    """Expand replies inside each top-level comment block."""
    expanded = 0
    items = page.locator('[data-e2e="comment-level-1"]')
    try:
        count = items.count()
    except Exception:
        return 0

    for i in range(count):
        if expanded >= max_threads:
            break
        item = items.nth(i)
        view_more = item.locator(
            '[data-e2e="view-more-1"], '
            '[data-e2e="comment-view-more"], '
            'button:has-text("View"), '
            'span:has-text("repl")'
        ).first
        try:
            if view_more.count() == 0:
                continue
            view_more.scroll_into_view_if_needed(timeout=2000)
            view_more.click(timeout=3000)
            page.wait_for_timeout(1000)
            expanded += 1
        except Exception:
            continue
    return expanded


def flatten_query(url: str) -> dict[str, str]:
    qs = parse_qs(urlparse(url).query, keep_blank_values=True)
    return {k: (v[0] if v else "") for k, v in qs.items()}


def fetch_reply_api_in_page(
    page: Page,
    video_id: str,
    comment_id: str,
    *,
    template_url: str,
    count: int,
) -> dict:
    """Call /api/comment/list/reply/ from the page using a captured signed URL template."""
    params = flatten_query(template_url)
    params["item_id"] = video_id
    params["comment_id"] = comment_id
    params["cursor"] = "0"
    params["count"] = str(count)
    params.pop("aweme_id", None)
    return page.evaluate(
        """async ({ params }) => {
            const u = new URL("/api/comment/list/reply/", window.location.origin);
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
            }
            const res = await fetch(u.toString(), {
                credentials: "include",
                headers: { accept: "application/json, text/plain, */*" },
            });
            const text = await res.text();
            let data = null;
            try { data = JSON.parse(text); } catch (_) {}
            return { status: res.status, bodyLen: text.length, data };
        }""",
        {"params": params},
    )


def fetch_replies_via_api(
    page: Page,
    video_id: str,
    threads: list[dict],
    *,
    template_url: str,
    max_threads: int,
    reply_limit: int,
    store_reply,
    saw_reply: dict,
) -> int:
    """Headless-friendly reply fetch using in-page /api/comment/list/reply/."""
    if not template_url or max_threads <= 0 or reply_limit <= 0:
        return 0

    fetched = 0
    candidates = [c for c in threads if c.get("replyCount", 0) > 0 and c.get("id")][:max_threads]
    for thread in candidates:
        comment_id = thread["id"]
        try:
            result = fetch_reply_api_in_page(
                page,
                video_id,
                comment_id,
                template_url=template_url,
                count=min(reply_limit, 30),
            )
        except Exception:
            continue
        if int(result.get("status") or 0) != 200:
            continue
        data = result.get("data") if isinstance(result.get("data"), dict) else {}
        comments = data.get("comments") or []
        if not isinstance(comments, list) or not comments:
            continue
        saw_reply["v"] = True
        fetched += 1
        for c in comments:
            if isinstance(c, dict):
                store_reply(comment_id, comment_row(c))
        page.wait_for_timeout(350)
    return fetched


def fetch_video_comments(page: Page, url: str, max_seconds: int = 40, debug_path: Path | None = None, *, headless: bool = True) -> dict:
    video_id = video_id_of(url)
    top_by_id: dict[str, dict] = {}
    replies: dict[str, list[dict]] = {}
    reply_ids_seen: dict[str, set[str]] = {}
    saw_top = {"v": False}
    saw_reply = {"v": False}
    seen_comment_urls: list[str] = []
    top_template_url = {"v": ""}
    open_strategy = ""

    def store_reply(parent_id: str, row: dict) -> None:
        if not parent_id or not row["id"]:
            return
        bucket = replies.setdefault(parent_id, [])
        seen = reply_ids_seen.setdefault(parent_id, set())
        if row["id"] in seen:
            return
        seen.add(row["id"])
        bucket.append(row)

    def on_response(resp: Response) -> None:
        u = resp.url
        if "/api/comment/list/" not in u:
            return
        is_reply = "/api/comment/list/reply" in u
        body = ""
        try:
            body = resp.text()
        except Exception:
            pass
        tag = "reply" if is_reply else "top"
        seen_comment_urls.append(f"{tag} {resp.status} bodyLen={len(body)} {u[:120]}")
        if resp.status != 200 or not body:
            return
        try:
            data = resp.json()
        except Exception:
            return
        comments = data.get("comments") or []
        if not isinstance(comments, list):
            return
        if is_reply:
            saw_reply["v"] = True
            qs = parse_qs(urlparse(u).query)
            parent = str((qs.get("comment_id") or qs.get("item_id") or [""])[0] or "")
            for c in comments:
                if not isinstance(c, dict):
                    continue
                row = comment_row(c)
                pid = parent or str(c.get("reply_id") or c.get("reply_to_reply_id") or c.get("parent_comment_id") or "")
                store_reply(pid, row)
        else:
            saw_top["v"] = True
            if not top_template_url["v"]:
                top_template_url["v"] = u
            for c in comments:
                if isinstance(c, dict):
                    row = comment_row(c)
                    if row["id"]:
                        top_by_id[row["id"]] = row

    page.on("response", on_response)
    page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    try:
        page.wait_for_load_state("networkidle", timeout=15_000)
    except Exception:
        pass

    open_strategy = open_comments_panel(page)
    if headless:
        page.wait_for_timeout(2500)

    try:
        page.wait_for_selector(
            '[data-e2e="comment-level-1"], [data-e2e="comment-list-item"], [data-e2e="comment-list"]',
            timeout=12_000,
        )
    except Exception:
        if not saw_top["v"]:
            open_strategy = open_comments_panel(page) or open_strategy
            page.wait_for_timeout(2500)

    top_wait_deadline = time.time() + 18
    while time.time() < top_wait_deadline and not saw_top["v"]:
        page.wait_for_timeout(600)
        try:
            scroll_comment_panel(page)
        except Exception:
            pass

    if debug_path:
        try:
            page.wait_for_timeout(2000)
            page.screenshot(path=str(debug_path), full_page=False)
        except Exception:
            pass

    deadline = time.time() + max_seconds
    last_top = -1
    stable = 0
    while time.time() < deadline:
        page.wait_for_timeout(1500)
        try:
            scroll_comment_panel(page)
        except Exception:
            pass
        top_count = len(top_by_id)
        if top_count == last_top:
            stable += 1
        else:
            stable = 0
            last_top = top_count
        if stable >= 3 and top_by_id:
            break

    top_list = sorted(top_by_id.values(), key=lambda c: c.get("likeCount", 0), reverse=True)
    reply_candidates = [c for c in top_list if c.get("replyCount", 0) > 0]
    expanded = expand_replies(page, max_threads=min(REPLY_THREADS, max(len(reply_candidates), 1)))

    reply_deadline = time.time() + 15
    while time.time() < reply_deadline and reply_candidates:
        before = sum(len(v) for v in replies.values())
        try:
            scroll_comment_panel(page)
        except Exception:
            pass
        page.wait_for_timeout(1200)
        after = sum(len(v) for v in replies.values())
        if after > before:
            before = after
            continue
        if saw_reply["v"] and after > 0:
            break
        if expanded == 0:
            break

    api_fetched = 0
    if reply_candidates and not saw_reply["v"] and top_template_url["v"]:
        api_fetched = fetch_replies_via_api(
            page,
            video_id,
            top_list,
            template_url=top_template_url["v"],
            max_threads=REPLY_THREADS,
            reply_limit=REPLY_LIMIT,
            store_reply=store_reply,
            saw_reply=saw_reply,
        )
        if api_fetched:
            seen_comment_urls.append(f"reply-api-fetch count={api_fetched}")

    page.remove_listener("response", on_response)
    threads = []
    for c in top_list[:COMMENT_LIMIT]:
        thread_replies = replies.get(c["id"], [])[:REPLY_LIMIT]
        c = dict(c)
        c["replies"] = thread_replies
        threads.append(c)

    reply_api_hits = [h for h in seen_comment_urls if h.startswith("reply ")]
    return {
        "videoId": video_id,
        "title": (page.title() or "")[:80],
        "loggedIn": "Log in" not in (page.content() or "")[:5000],
        "openStrategy": open_strategy,
        "expandedReplyThreads": expanded,
        "replyApiFetchCount": api_fetched,
        "sawTopCommentResponse": saw_top["v"],
        "sawReplyCommentResponse": saw_reply["v"],
        "commentApiHits": seen_comment_urls[:8],
        "replyApiHits": reply_api_hits[:6],
        "threadCount": len(threads),
        "replyThreadCount": sum(1 for t in threads if t["replies"]),
        "replyCount": sum(len(t["replies"]) for t in threads),
        "threads": threads,
    }


def launch_context(p, headless: bool) -> BrowserContext:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    args = ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
    if headless:
        args.append("--headless=new")
    else:
        args += ["--window-size=1366,768"]
    context = p.chromium.launch_persistent_context(
        user_data_dir=str(PROFILE_DIR),
        headless=headless,
        viewport={"width": 1366, "height": 768},
        locale="en-US",
        timezone_id="Africa/Nairobi",
        user_agent=USER_AGENT,
        args=args,
    )
    if Stealth is not None:
        try:
            Stealth().apply_stealth_sync(context)
        except Exception as exc:
            print(f"stealth_apply_failed={exc}", file=sys.stderr)
    return context


def main() -> int:
    urls = [u.strip() for u in sys.argv[1:] if u.strip()]
    if not urls:
        print("usage: local_comment_fetcher.py <video_url> [...]")
        print("first run: py -3 scripts/tiktok_profile_login.py")
        return 2

    if not PROFILE_DIR.exists():
        print(f"profile missing — run: py -3 scripts/tiktok_profile_login.py", file=sys.stderr)
        return 2

    headless = (os.environ.get("MODE_A_HEADLESS") or "true").lower() not in ("false", "0", "no")
    results = []

    with sync_playwright() as p:
        context = launch_context(p, headless=headless)
        if not has_session(context):
            context.close()
            print("no sessionid in profile — run tiktok_profile_login.py first", file=sys.stderr)
            return 2

        for i, url in enumerate(urls):
            if i:
                time.sleep(2)
            page = context.new_page()
            page.route("**/*", lambda route, req: route.abort() if should_block(req) else route.continue_())
            try:
                dbg = ROOT / "tmp" / f"mode_a_debug_{i}.png"
                result = fetch_video_comments(page, url, debug_path=dbg, headless=headless)
                result["profileDir"] = str(PROFILE_DIR)
                result["headless"] = headless
            except PWTimeoutError as exc:
                result = {"videoId": video_id_of(url), "error": f"timeout: {exc}"}
            except Exception as exc:
                result = {"videoId": video_id_of(url), "error": str(exc)}
            finally:
                try:
                    page.close()
                except Exception:
                    pass
            results.append({"url": url, **result})

        context.close()

    for r in results:
        threads = r.get("threads") or []
        preview = []
        for t in threads[:5]:
            item = {
                "text": t.get("text", "")[:120],
                "likes": t.get("likeCount"),
                "replies": len(t.get("replies") or []),
            }
            if t.get("replies"):
                item["topReply"] = (t["replies"][0].get("text") or "")[:120]
            preview.append(item)
        output = dict(r)
        output["preview"] = preview
        print(json.dumps(output, ensure_ascii=True))

    return 0 if any(r.get("threadCount") for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
