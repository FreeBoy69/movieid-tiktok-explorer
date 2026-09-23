"""Render an isolated, self-contained motion document to MP4 or GIF."""
import argparse
import pathlib
import subprocess
import tempfile
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright


def render(source, output, width, height, seconds):
    fps = 24 if output.suffix == ".mp4" else 15
    html = source.read_text()
    policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'"
    html = html.replace("<head>", f'<head><meta http-equiv="Content-Security-Policy" content="{policy}">', 1)
    with tempfile.TemporaryDirectory(prefix="motion-frames-") as scratch, sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={"width": width, "height": height}, service_workers="block")
        context.route("**/*", lambda route: route.abort())
        page = context.new_page()
        epoch = datetime(2026, 1, 1, tzinfo=timezone.utc)
        page.clock.install(time=epoch)
        page.clock.pause_at(epoch)
        page.set_content(html, wait_until="load")
        for frame in range(round(seconds * fps)):
            timestamp = frame * 1000 / fps
            if frame:
                page.clock.run_for(round(frame * 1000 / fps) - round((frame - 1) * 1000 / fps))
            page.evaluate("t => document.getAnimations().forEach(a => { a.pause(); a.currentTime = t; })", timestamp)
            page.screenshot(path=str(pathlib.Path(scratch) / f"{frame:05d}.png"), timeout=15000)
        browser.close()
        args = ["ffmpeg", "-y", "-v", "error", "-framerate", str(fps), "-i", str(pathlib.Path(scratch) / "%05d.png")]
        if output.suffix == ".gif":
            args += ["-filter_complex", "split[a][b];[a]palettegen[p];[b][p]paletteuse", "-loop", "0"]
        else:
            args += ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
        subprocess.run(args + [str(output)], check=True, timeout=180)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=pathlib.Path)
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--width", type=int, default=1280)
    parser.add_argument("--height", type=int, default=720)
    parser.add_argument("--seconds", type=float, default=8)
    args = parser.parse_args()
    if args.output.suffix not in (".mp4", ".gif") or not 1 <= args.seconds <= 20:
        parser.error("Choose MP4 or GIF and a duration between 1 and 20 seconds")
    render(args.source, args.output, args.width, args.height, args.seconds)
