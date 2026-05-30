"""
One-time TikTok login into a persistent Playwright Chromium profile.

Usage:
  py -3 scripts/tiktok_profile_login.py

A visible browser opens. Log in to TikTok (solve captcha if prompted).
When sessionid is detected, the profile is saved and the script exits.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PROFILE_DIR = Path(
    __import__("os").environ.get("MODE_A_PROFILE", str(ROOT / "tmp" / "tiktok-browser-profile"))
)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
)


def has_session(context) -> bool:
    for c in context.cookies():
        if c.get("name") in ("sessionid", "sessionid_ss") and c.get("value"):
            return True
    return False


def main() -> int:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    print(f"profile_dir={PROFILE_DIR}")
    print("Opening browser — log in to TikTok. Close the window or press Ctrl+C when done.")

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=False,
            viewport={"width": 1366, "height": 768},
            locale="en-US",
            timezone_id="Africa/Nairobi",
            user_agent=USER_AGENT,
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.goto("https://www.tiktok.com/login", wait_until="domcontentloaded", timeout=60_000)

        deadline = time.time() + 600
        while time.time() < deadline:
            if has_session(context):
                print("sessionid detected — profile saved.")
                context.close()
                return 0
            try:
                page.wait_for_timeout(2000)
            except Exception:
                break

        context.close()
        print("No sessionid detected within 10 minutes.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
