"""Wait for Chrome cookie DB, extract TikTok cookies, write VPS env fragment."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTRACT = ROOT / "scripts" / "extract_tiktok_cookies_chrome.py"
OUT_JSON = ROOT / "tmp" / "tiktok-cookies-extract.json"
OUT_ENV = ROOT / "tmp" / "vps-tiktok-cookies.env"


def run_extract() -> dict:
    proc = subprocess.run([sys.executable, str(EXTRACT)], capture_output=True, text=True)
    text = (proc.stdout or "").strip()
    if not text:
        raise RuntimeError(proc.stderr or "extract script produced no output")
    return json.loads(text)


def main() -> int:
    result: dict | None = None
    for attempt in range(12):
        try:
            result = run_extract()
            if result.get("ok"):
                break
        except Exception as exc:
            result = {"ok": False, "error": str(exc)}
        if attempt < 11:
            time.sleep(5)
    if not result or not result.get("ok"):
        print(json.dumps(result or {"ok": False, "error": "unknown"}))
        return 1

    header = result["cookie_header"]
    ms = result.get("ms_token") or ""
    lines = [
        f"TIKTOK_COOKIE_HEADER={header}",
        "TIKTOK_SLEEP_AFTER=8",
        "TIKTOK_BROWSER=webkit",
    ]
    if ms:
        lines.insert(1, f"TIKTOK_MS_TOKEN={ms}")
    OUT_ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
    OUT_JSON.write_text(json.dumps({**result, "cookie_header": "***redacted***", "ms_token": "***redacted***"}, indent=2), encoding="utf-8")
    print(json.dumps({"ok": True, "env_file": str(OUT_ENV), "has_ms_token": bool(ms), "names": result.get("names")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
