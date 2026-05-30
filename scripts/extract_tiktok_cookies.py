"""Extract TikTok cookies from local Chrome/Edge profiles."""
from __future__ import annotations

import json
import sys

WANTED = {
    "msToken",
    "ms_token",
    "ttwid",
    "uid_tt",
    "uid_tt_ss",
    "uid_tt_ss_tt_open",
    "uid_tt_tt_open",
    "tt-target-idc",
    "tt-target-idc-sign",
    "tt_ticket_guard_has_set_public_key",
    "sessionid",
    "sessionid_ss",
    "sid_tt",
    "sid_guard",
    "odin_tt",
}


def extract(browser: str) -> dict[str, str]:
    import browser_cookie3

    loader = getattr(browser_cookie3, browser, None)
    if loader is None:
        return {}
    out: dict[str, str] = {}
    try:
        for cookie in loader(domain_name="tiktok.com"):
            name = cookie.name
            if name in WANTED or name.lower().startswith("ms"):
                out[name] = cookie.value
    except Exception as exc:
        print(f"{browser}_error={exc}", file=sys.stderr)
    return out


def main() -> int:
    merged: dict[str, str] = {}
    for browser in ("chrome", "edge", "firefox", "brave"):
        merged.update(extract(browser))

    if not merged:
        print(json.dumps({"ok": False, "error": "No TikTok cookies found in Chrome/Edge/Firefox/Brave"}))
        return 1

    header = "; ".join(f"{k}={v}" for k, v in merged.items())
    ms = merged.get("msToken") or merged.get("ms_token") or ""
    print(
        json.dumps(
            {
                "ok": True,
                "cookie_count": len(merged),
                "has_ms_token": bool(ms),
                "names": sorted(merged.keys()),
                "ms_token_len": len(ms),
                "cookie_header": header,
                "ms_token": ms,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
