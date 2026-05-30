"""Extract TikTok cookies from Chrome/Edge by copying cookie DB then decrypting."""
from __future__ import annotations

import base64
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

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


def chrome_key(user_data: Path) -> bytes:
    import win32crypt

    local_state = json.loads((user_data / "Local State").read_text(encoding="utf-8"))
    encrypted_key = base64.b64decode(local_state["os_crypt"]["encrypted_key"])
    return win32crypt.CryptUnprotectData(encrypted_key[5:], None, None, None, 0)[1]


def decrypt_cookie(key: bytes, blob: bytes) -> str:
    import win32crypt
    from Cryptodome.Cipher import AES

    if blob[:3] in (b"v10", b"v11"):
        nonce = blob[3:15]
        ciphertext = blob[15:-16]
        tag = blob[-16:]
        cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
        return cipher.decrypt_and_verify(ciphertext, tag).decode("utf-8")
    return win32crypt.CryptUnprotectData(blob, None, None, None, 0)[1].decode("utf-8")


def read_profile(user_data: Path, profile: str) -> dict[str, str]:
    cookies_path = user_data / profile / "Network" / "Cookies"
    if not cookies_path.exists():
        cookies_path = user_data / profile / "Cookies"
    if not cookies_path.exists():
        return {}

    key = chrome_key(user_data)
    fd, tmp_name = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        shutil.copy2(cookies_path, tmp)
        conn = sqlite3.connect(tmp)
        try:
            rows = conn.execute(
                "SELECT name, encrypted_value, host_key FROM cookies WHERE host_key LIKE '%tiktok%'"
            ).fetchall()
        finally:
            conn.close()
    finally:
        tmp.unlink(missing_ok=True)

    out: dict[str, str] = {}
    for name, enc, _host in rows:
        if name not in WANTED and not name.lower().startswith("ms"):
            continue
        try:
            out[name] = decrypt_cookie(key, enc)
        except Exception:
            continue
    return out


def main() -> int:
    local = Path(os.environ["LOCALAPPDATA"])
    candidates = [
        local / "Google/Chrome/User Data",
        local / "Microsoft/Edge/User Data",
        local / "BraveSoftware/Brave-Browser/User Data",
    ]
    merged: dict[str, str] = {}
    errors: list[str] = []

    for user_data in candidates:
        if not user_data.exists():
            continue
        profiles = ["Default"]
        profiles += [p.name for p in user_data.iterdir() if p.is_dir() and p.name.startswith("Profile")]
        for profile in profiles:
            try:
                found = read_profile(user_data, profile)
                if found:
                    merged.update(found)
            except Exception as exc:
                errors.append(f"{user_data.name}/{profile}: {exc}")

    if not merged:
        print(json.dumps({"ok": False, "error": "No TikTok cookies found", "details": errors}))
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
