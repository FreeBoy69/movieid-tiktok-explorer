#!/usr/bin/env python3
"""Movie to Recap media worker.

Runs on the media worker (the VPS, which declares the "movie" capability). Long work runs
detached from the call that starts it, so an app deploy never kills a 40-minute job; the app
starts a stage, then polls `status` and pulls files with `fetch`.

Every project lives in MOVIE_RECAP_DIR/<project>/ (default /var/tmp/autoyt-recaps):
  movie.*          the source film (downloaded once, reused by render)
  status.json      {"stage", "state": running|done|failed, "message", "progress", "error"}
  analysis.json    duration, sampled shots, scene cuts, transcript
  sheets/NNN.jpg   contact sheets of 12 numbered shots (4x3) for the vision model
  render/          per-format outputs

Commands (all print one JSON object on stdout):
  start-analyze --project ID (--url URL | --file PATH) [--options JSON]
  start-render  --project ID --plan PATH --audio-dir DIR
  status        --project ID [--out DIR]     (with --out, copies finished analysis files there)
  fetch         --project ID --name FILE --out DIR
  measure       --out DIR                    (seconds of every audio file in DIR)
  tighten       --out DIR [--tempo 1.1]      (trimmed, faster copies of every clip, with their lengths)
  stop          --project ID
  cleanup       --project ID
"""
import argparse
import html
import json
import os
import random
import re
import shutil
import signal
import subprocess
import sys
import threading
import urllib.parse
import time

ROOT = os.environ.get("MOVIE_RECAP_DIR") or (
    "/var/tmp/autoyt-recaps" if os.path.isdir("/var/tmp") and os.access("/var/tmp", os.W_OK) else os.path.join(os.environ.get("TMPDIR", "/tmp"), "autoyt-recaps")
)
SHOT_EVERY = 3.0  # one sampled frame every 3 s of film: the cut catalogue
SHEET_COLS, SHEET_ROWS = 4, 3
TILE_W = 256
KEEP_DAYS = 4
PROJECT_ID = re.compile(r"^[A-Za-z0-9_-]{6,80}$")


def emit(value):
    sys.stdout.write(json.dumps(value))
    sys.stdout.flush()


def project_dir(project):
    if not PROJECT_ID.match(project or ""):
        raise SystemExit(emit({"error": "invalid project id"}))
    return os.path.join(ROOT, project)


def read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return default


def write_json(path, value):
    partial = f"{path}.{os.getpid()}.part"
    with open(partial, "w", encoding="utf-8") as handle:
        json.dump(value, handle)
    os.replace(partial, path)


def set_status(pdir, **fields):
    current = read_json(os.path.join(pdir, "status.json"), {}) or {}
    current.update(fields)
    current["updatedAt"] = time.time()
    write_json(os.path.join(pdir, "status.json"), current)


def run(cmd, timeout=None):
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout)
    if result.returncode != 0:
        tail = "\n".join(line for line in (result.stderr or "").splitlines() if line.strip())[-1500:]
        raise RuntimeError(f"{os.path.basename(cmd[0])} failed: {tail}")
    return result.stdout


def which_ytdlp():
    found = shutil.which("yt-dlp")
    return [found] if found else [sys.executable, "-m", "yt_dlp"]


def probe_duration(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path], timeout=120)
    return float(out.strip() or 0)


def probe_height(movie):
    """The picture's height in pixels (rotation ignored), or 0 when unreadable."""
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=height", "-of", "csv=p=0", movie],
                           capture_output=True, text=True, timeout=60)
    try:
        return int(probe.stdout.strip().split()[0])
    except (ValueError, IndexError):
        return 0


def movie_path(pdir):
    for name in sorted(os.listdir(pdir)):
        if name.startswith("movie.") and not name.endswith(".part"):
            return os.path.join(pdir, name)
    return ""


def sweep_old():
    if not os.path.isdir(ROOT):
        return
    cutoff = time.time() - KEEP_DAYS * 86400
    for name in os.listdir(ROOT):
        full = os.path.join(ROOT, name)
        try:
            if os.path.isdir(full) and os.path.getmtime(full) < cutoff:
                shutil.rmtree(full, ignore_errors=True)
        except OSError:
            pass


def spawn_detached(pdir, command, extra):
    # The calling exec's scratch folder is deleted when it returns, so run a copy kept with the project.
    script = os.path.join(pdir, "movie_recap.py")
    shutil.copyfile(os.path.abspath(__file__), script)
    log = open(os.path.join(pdir, f"{command}.log"), "a")
    # Run from the project folder with a clean PYTHONPATH: the exec that starts this deletes its scratch
    # folder when it returns, and a deleted working directory makes Intel MKL abort while ctranslate2 loads
    # ("Intel oneMKL FATAL ERROR: Cannot load libctranslate2"), killing the run with no status written.
    env = {**os.environ, "MOVIE_RECAP_DIR": ROOT}
    paths = [part for part in env.get("PYTHONPATH", "").split(os.pathsep) if part and os.path.isdir(part) and not part.startswith(os.environ.get("SCRATCH_DIR") or "\0")]
    if paths:
        env["PYTHONPATH"] = os.pathsep.join(paths)
    else:
        env.pop("PYTHONPATH", None)
    proc = subprocess.Popen(
        [sys.executable, script, command, *extra],
        stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True, close_fds=True,
        cwd=pdir, env=env,
    )
    with open(os.path.join(pdir, "pid"), "w", encoding="utf-8") as handle:
        handle.write(str(proc.pid))


def heartbeat(pdir):
    """Long single ffmpeg passes report no progress; keep status fresh so it never reads as stalled."""
    def beat():
        while True:
            time.sleep(60)
            status = read_json(os.path.join(pdir, "status.json"), {}) or {}
            if status.get("state") != "running":
                return
            set_status(pdir)
    threading.Thread(target=beat, daemon=True).start()


# ---------------------------------------------------------------- analyze

def download(pdir, url, file_path):
    if movie_path(pdir):
        return movie_path(pdir)
    if file_path:
        ext = os.path.splitext(file_path)[1].lower() or ".mp4"
        target = os.path.join(pdir, f"movie{ext}")
        shutil.copyfile(file_path, target + ".part")
        os.replace(target + ".part", target)
        return target
    set_status(pdir, stage="downloading", message="Downloading the movie", progress=0.02)
    # File-host share pages (your own uploads on PixelDrain, MediaFire, Dropbox, Mega) resolve to the file
    # itself and come down with aria2 (parallel connections, resume); video pages go to yt-dlp.
    host = resolve_file_host(url)
    if host:
        kind, target_url, name = host
        got = mega_download(pdir, target_url) if kind == "mega" else aria2_download(pdir, target_url, name)
        if got and name:
            remember_file_name(pdir, name)
        if got:
            return got
    template = os.path.join(pdir, "movie.%(ext)s")
    cmd = [*which_ytdlp(), "--no-playlist", "--no-part", "-f", "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
           "--merge-output-format", "mp4", "-o", template, "--newline", url]
    if "youtube.com" in url or "youtu.be" in url:
        cmd[1:1] = ["--js-runtimes", "node"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    last = 0.0
    tail = []
    for line in proc.stdout:
        tail = (tail + [line.strip()])[-12:]
        match = re.search(r"(\d+(?:\.\d+)?)%", line)
        if match and time.time() - last > 4:
            last = time.time()
            set_status(pdir, message=f"Downloading the movie ({float(match.group(1)):.0f}%)", progress=0.02 + 0.13 * float(match.group(1)) / 100)
    if proc.wait() != 0 or not movie_path(pdir):
        # yt-dlp can refuse plain file links; fetch those directly (aria2, then curl).
        direct = aria2_download(pdir, url, "", require_video=True) or direct_download(pdir, url)
        if direct:
            return direct
        raise RuntimeError("Couldn't download that link. " + " ".join(tail[-3:])[-400:])
    return movie_path(pdir)


VIDEO_EXTS = (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi")


def remember_file_name(pdir, name):
    """The downloaded file's own name ("Fall.2.Deadpoint.2026.1080p.mkv"), which names the film far better
    than the share link does; the app looks the film up by it."""
    try:
        with open(os.path.join(pdir, "file-name.txt"), "w", encoding="utf-8") as handle:
            handle.write(str(name)[:300])
    except OSError:
        pass


def file_name(pdir):
    try:
        with open(os.path.join(pdir, "file-name.txt"), encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return ""


def resolve_file_host(url):
    """("direct", file url, file name) for a file-host share page, ("mega", url, "") for Mega, or None."""
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return None
    host = parsed.netloc.lower().removeprefix("www.")
    if host in ("mega.nz", "mega.co.nz"):
        return ("mega", url, "")
    if host == "pixeldrain.com":
        m = re.match(r"^/(?:u|api/file)/([A-Za-z0-9]+)", parsed.path)
        if m:
            name = ""
            try:
                info = subprocess.run(["curl", "-sL", "--max-time", "20", f"https://pixeldrain.com/api/file/{m.group(1)}/info"], stdout=subprocess.PIPE, text=True).stdout
                name = json.loads(info).get("name", "")
            except Exception:  # noqa: BLE001
                pass
            return ("direct", f"https://pixeldrain.com/api/file/{m.group(1)}?download", name)
    if host.endswith("dropbox.com"):
        query = urllib.parse.parse_qs(parsed.query)
        query["dl"] = ["1"]
        return ("direct", urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(query, doseq=True))), os.path.basename(parsed.path))
    if host.endswith("mediafire.com") and "/file/" in parsed.path:
        try:
            page = subprocess.run(["curl", "-sL", "--max-time", "30", "-A", "Mozilla/5.0", url], stdout=subprocess.PIPE, text=True).stdout
        except Exception:  # noqa: BLE001
            return None
        m = re.search(r'href="(https://download\d*\.mediafire\.com/[^"]+)"', page)
        if m:
            return ("direct", html.unescape(m.group(1)), os.path.basename(urllib.parse.unquote(m.group(1).split("?")[0])))
    return None


def aria2_download(pdir, url, name, require_video=False):
    """A file link with aria2: 8 connections, resumable. Returns the movie path or ""."""
    if not shutil.which("aria2c"):
        return ""
    ext = os.path.splitext((name or url.split("?")[0]).lower())[1]
    if ext not in VIDEO_EXTS:
        if require_video:
            try:
                head = subprocess.run(["curl", "-sIL", "--max-time", "20", url], stdout=subprocess.PIPE, text=True).stdout.lower()
            except Exception:  # noqa: BLE001
                return ""
            if "content-type: video/" not in head and "content-type: application/octet-stream" not in head:
                return ""
        ext = ".mp4" if ext not in VIDEO_EXTS else ext
    part = f"movie{ext}.part"
    proc = subprocess.Popen(["aria2c", "-x", "8", "-s", "8", "-k", "4M", "-c", "--file-allocation=none", "--summary-interval=5",
                             "--console-log-level=warn", "--max-tries=5", "--retry-wait=5", "-d", pdir, "-o", part, url],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    last = 0.0
    for line in proc.stdout:
        match = re.search(r"\((\d+)%\)", line)
        if match and time.time() - last > 4:
            last = time.time()
            set_status(pdir, message=f"Downloading the movie ({match.group(1)}%)", progress=0.02 + 0.13 * int(match.group(1)) / 100)
    target = os.path.join(pdir, part)
    if proc.wait() != 0 or not os.path.exists(target) or os.path.getsize(target) < 1024 * 1024:
        return ""
    final = os.path.join(pdir, f"movie{ext}")
    os.replace(target, final)
    return final


def mega_download(pdir, url):
    """A Mega share link with megatools (Mega files are encrypted; megadl decrypts them). Returns the path or ""."""
    if not shutil.which("megadl"):
        return ""
    work = os.path.join(pdir, "mega")
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    proc = subprocess.Popen(["megadl", "--path", work, url], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    last = 0.0
    for line in proc.stdout:
        match = re.search(r"(\d+(?:\.\d+)?)%", line)
        if match and time.time() - last > 4:
            last = time.time()
            set_status(pdir, message=f"Downloading the movie ({float(match.group(1)):.0f}%)", progress=0.02 + 0.13 * float(match.group(1)) / 100)
    files = [os.path.join(work, f) for f in os.listdir(work)] if proc.wait() == 0 else []
    files = [f for f in files if os.path.isfile(f)]
    if not files:
        return ""
    biggest = max(files, key=os.path.getsize)
    remember_file_name(pdir, os.path.basename(biggest))
    ext = os.path.splitext(biggest)[1].lower()
    final = os.path.join(pdir, f"movie{ext if ext in VIDEO_EXTS else '.mp4'}")
    os.replace(biggest, final)
    shutil.rmtree(work, ignore_errors=True)
    return final


def direct_download(pdir, url):
    ext = os.path.splitext(url.split("?")[0])[1].lower()
    if ext not in (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".avi"):
        try:
            head = subprocess.run(["curl", "-sIL", "--max-time", "20", url], stdout=subprocess.PIPE, text=True).stdout.lower()
        except Exception:  # noqa: BLE001
            return ""
        if "content-type: video/" not in head:
            return ""
        ext = ".mp4"
    target = os.path.join(pdir, f"movie{ext}")
    proc = subprocess.run(["curl", "-sSL", "--fail", "--retry", "3", "-o", target + ".part", url], stderr=subprocess.PIPE, text=True)
    if proc.returncode != 0 or not os.path.exists(target + ".part"):
        return ""
    os.replace(target + ".part", target)
    return target


def detect_scenes(movie, duration, pdir):
    """Scene cut times from ffmpeg's scene score on a small, sparse copy of the picture."""
    set_status(pdir, stage="scenes", message="Finding scene changes", progress=0.42)
    out_file = os.path.join(pdir, "scenes.txt")
    subprocess.run([
        "ffmpeg", "-hide_banner", "-nostats", "-loglevel", "error", "-threads", "2", "-skip_frame", "nokey", "-i", movie,
        "-vf", f"scale=160:-2,select='gt(scene,0.28)',metadata=print:file={out_file}", "-an", "-f", "null", "-",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3 * 3600)
    times = []
    try:
        with open(out_file, "r", encoding="utf-8") as handle:
            for line in handle:
                match = re.search(r"pts_time:([0-9.]+)", line)
                if match:
                    times.append(round(float(match.group(1)), 2))
    except OSError:
        pass
    cuts = sorted(set(t for t in times if 0.5 < t < duration - 0.5))
    bounds = [0.0, *cuts, duration]
    return [{"start": bounds[i], "end": bounds[i + 1]} for i in range(len(bounds) - 1) if bounds[i + 1] - bounds[i] > 0.2]


def sample_shots(movie, duration, pdir):
    """One frame every SHOT_EVERY seconds, numbered and tiled into contact sheets in one decode pass."""
    set_status(pdir, stage="frames", message="Sampling frames from the whole film", progress=0.55)
    sheets = os.path.join(pdir, "sheets")
    shutil.rmtree(sheets, ignore_errors=True)
    os.makedirs(sheets, exist_ok=True)
    label = "drawtext=text='%{eif\\:n\\:d}':x=6:y=6:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=4"
    vf = f"fps=1/{SHOT_EVERY}:start_time={SHOT_EVERY / 2},scale={TILE_W}:-2:flags=fast_bilinear,setsar=1,{label},tile={SHEET_COLS}x{SHEET_ROWS}"
    count = int(max(1, (duration - SHOT_EVERY / 2) // SHOT_EVERY + 1))
    expected = -(-count // (SHEET_COLS * SHEET_ROWS))
    done = threading.Event()

    def progress():
        # One decode pass over a long film (AV1 is slow) gives no progress of its own: count the sheets.
        while not done.wait(20):
            made = len(os.listdir(sheets))
            set_status(pdir, message=f"Sampling frames from the whole film ({min(made, expected)} of {expected} sheets)", progress=0.55 + 0.4 * min(1.0, made / expected))
    threading.Thread(target=progress, daemon=True).start()
    # The same decode pass finds every camera cut (a recap clip must sit inside one shot): sampling and
    # shot detection each took about 7 minutes on a 98-minute AV1 film when they decoded it separately.
    shot_log = os.path.join(pdir, "shot-cuts.txt")
    graph = (f"[0:v]split=2[s][d];[s]{vf}[sheets];"
             f"[d]scale=320:-2:flags=fast_bilinear,scdet=threshold={SHOT_THRESHOLD}:sc_pass=1,metadata=print:file={shot_log}[shots]")
    try:
        subprocess.run([
            "ffmpeg", "-hide_banner", "-nostats", "-loglevel", "error", "-threads", "3", "-i", movie, "-an",
            "-filter_complex", graph, "-map", "[sheets]", "-q:v", "5", os.path.join(sheets, "%03d.jpg"),
            "-map", "[shots]", "-f", "null", "-",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=3 * 3600, check=True)
    finally:
        done.set()
    try:
        with open(shot_log, encoding="utf-8") as handle:
            write_json(os.path.join(pdir, SHOT_CACHE), parse_shot_cuts(handle.read()))
    except OSError:
        pass
    # ffmpeg numbers sheets from 1; rename to 0-based so sheet k holds shots 12k..12k+11.
    for name in sorted(os.listdir(sheets)):
        number = int(os.path.splitext(name)[0])
        os.replace(os.path.join(sheets, name), os.path.join(sheets, f"s{number - 1:03d}.jpg"))
    return [{"i": i, "t": round(SHOT_EVERY / 2 + i * SHOT_EVERY, 2)} for i in range(count)]


# ISO 639-1 names the app sends, to the 639-2 tags films carry on their audio tracks.
LANG3 = {"en": "eng", "es": "spa", "fr": "fre", "de": "ger", "it": "ita", "pt": "por", "ru": "rus", "ja": "jpn", "ko": "kor",
         "zh": "chi", "hi": "hin", "ar": "ara", "tr": "tur", "id": "ind", "vi": "vie", "th": "tha", "pl": "pol", "nl": "dut"}
TRANSCRIBE_CHUNK = 600.0  # seconds of audio per child process


def audio_tracks(movie):
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index:stream_tags=language,title:stream_disposition=default",
                            "-of", "json", movie], capture_output=True, text=True, timeout=120)
    try:
        return json.loads(probe.stdout).get("streams", [])
    except ValueError:
        return []


def pick_audio(movie, language):
    """Which audio track to transcribe: the requested language, else English, else the default track.
    Multi-language releases often make a dub the default (a Hindi track first, English fourth)."""
    tracks = audio_tracks(movie)
    if not tracks:
        return 0, ""
    tags = [(str((t.get("tags") or {}).get("language", "")).lower(), str((t.get("tags") or {}).get("title", "")).lower()) for t in tracks]
    wanted = [LANG3.get(language, language)] if language else []
    for code in wanted + ["eng", "en"]:
        for n, (lang, title) in enumerate(tags):
            if code and (lang == code or (code == "eng" and "english" in title)):
                return n, lang
    default = next((n for n, t in enumerate(tracks) if (t.get("disposition") or {}).get("default")), 0)
    return default, tags[default][0]


def transcribe(movie, pdir, language):
    """Dialogue with timestamps, transcribed in ten-minute chunks, each in its own child process: a chunk
    that crashes or hangs is retried, then skipped, instead of losing the whole film; finished chunks are
    kept, so a retried analysis picks up where it stopped."""
    set_status(pdir, stage="transcribing", message="Transcribing the dialogue", progress=0.18)
    track, lang = pick_audio(movie, language)
    # Named for its track, so a file left from another track (a dub) is never reused.
    audio = os.path.join(pdir, f"audio-a{track}.wav")
    if not os.path.exists(audio):
        names = {"eng": "English", "spa": "Spanish", "fre": "French", "fra": "French", "ger": "German", "deu": "German", "ita": "Italian", "por": "Portuguese",
                 "rus": "Russian", "jpn": "Japanese", "kor": "Korean", "chi": "Chinese", "zho": "Chinese", "hin": "Hindi", "ara": "Arabic", "tur": "Turkish"}
        set_status(pdir, message=f"Extracting the {names[lang]} dialogue track" if lang in names else "Extracting the dialogue track")
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", movie, "-map", f"0:a:{track}", "-vn", "-ac", "1", "-ar", "16000", audio + ".part.wav"], timeout=3 * 3600)
        os.replace(audio + ".part.wav", audio)
    duration = probe_duration(audio) or 1
    chunks = os.path.join(pdir, f"transcript-a{track}")
    os.makedirs(chunks, exist_ok=True)
    count = max(1, int(-(-duration // TRANSCRIBE_CHUNK)))
    hint = language or ({v: k for k, v in LANG3.items()}.get(lang, "") if lang else "")
    lines, missed = [], 0
    for k in range(count):
        target = os.path.join(chunks, f"c{k:03d}.json")
        for attempt in range(3):
            if os.path.exists(target):
                break
            set_status(pdir, message=f"Transcribing the dialogue (part {k + 1} of {count}{', retrying' if attempt else ''})", progress=0.18 + 0.22 * k / count)
            subprocess.run([sys.executable, os.path.abspath(__file__), "transcribe-chunk", "--project", os.path.basename(pdir),
                            "--options", json.dumps({"start": k * TRANSCRIBE_CHUNK, "length": TRANSCRIBE_CHUNK, "language": hint, "out": target, "audio": audio})],
                           cwd=pdir, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=1800, check=False)
        chunk = read_json(target, None)
        if chunk is None:
            missed += 1
            continue
        lines.extend(chunk)
    if missed == count:
        raise RuntimeError("Couldn't transcribe the dialogue. Press Retry to try again.")
    os.remove(audio)
    shutil.rmtree(chunks, ignore_errors=True)
    return sorted(lines, key=lambda line: line["start"])


def cmd_transcribe_chunk(args):
    """One chunk of audio.wav (child of transcribe): [start, start + length) plus 2 s of overlap, keeping
    only lines that start inside the chunk so none is cut in half or counted twice."""
    o = json.loads(args.options)
    pdir = project_dir(args.project)
    start, length = float(o["start"]), float(o["length"])
    piece = os.path.join(pdir, f"chunk-{int(start)}.wav")
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{length + 2:.3f}", "-i", o["audio"], piece], timeout=600)
    try:
        from faster_whisper import WhisperModel  # noqa: WPS433
        model = WhisperModel(os.environ.get("MOVIE_RECAP_WHISPER", "base"), device="cpu", compute_type="int8", cpu_threads=2)
        segments, _info = model.transcribe(piece, language=o.get("language") or None, vad_filter=True, beam_size=1)
        lines = [{"start": round(start + seg.start, 2), "end": round(start + seg.end, 2), "text": seg.text.strip()} for seg in segments if seg.start < length and seg.text.strip()]
    finally:
        os.remove(piece)
    write_json(o["out"] + ".part", lines)
    os.replace(o["out"] + ".part", o["out"])


def chapters(movie):
    """The film's chapter marks ({start, end, title}); releases often name the credits chapter."""
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_chapters", "-of", "json", movie], capture_output=True, text=True, timeout=120)
    try:
        return [{"start": round(float(c["start_time"]), 2), "end": round(float(c["end_time"]), 2), "title": str((c.get("tags") or {}).get("title", ""))[:80]}
                for c in json.loads(probe.stdout).get("chapters", [])]
    except (ValueError, KeyError):
        return []


def container_title(movie):
    """The file's title tag, unless it is a release group's web address or plainly not a title."""
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags=title", "-of", "json", movie], capture_output=True, text=True, timeout=120)
    try:
        title = str((json.loads(probe.stdout).get("format", {}).get("tags") or {}).get("title", "")).strip()
    except ValueError:
        return ""
    return "" if not title or re.search(r"https?://|www\.|\.(com|net|org|ink|to|cc|io)\b", title, re.I) else title[:160]


def run_analyze(args):
    pdir = project_dir(args.project)
    heartbeat(pdir)
    options = read_json(os.path.join(pdir, "options.json"), {}) or {}
    try:
        movie = download(pdir, options.get("url", ""), options.get("file", ""))
        set_status(pdir, stage="probing", message="Reading the film", progress=0.16)
        duration = probe_duration(movie)
        height = probe_height(movie)
        if duration < 300:
            raise RuntimeError("That video is under 5 minutes. Movie to Recap needs a full film or episode.")
        transcript = transcribe(movie, pdir, options.get("language", ""))
        scenes = detect_scenes(movie, duration, pdir)
        shots = sample_shots(movie, duration, pdir)
        for shot in shots:
            shot["scene"] = next((k for k, s in enumerate(scenes) if s["start"] <= shot["t"] < s["end"]), len(scenes) - 1)
        write_json(os.path.join(pdir, "analysis.json"), {
            "duration": round(duration, 2),
            "shotEvery": SHOT_EVERY,
            "height": height,
            "sheet": {"cols": SHEET_COLS, "rows": SHEET_ROWS, "count": len(os.listdir(os.path.join(pdir, "sheets")))},
            "shots": shots,
            "scenes": scenes,
            "transcript": transcript,
            "chapters": chapters(movie),
            "shotCuts": read_json(os.path.join(pdir, SHOT_CACHE), None) or detect_shot_cuts(movie, pdir),
            "shotThreshold": SHOT_THRESHOLD,
            "source": os.path.basename(str(options.get("name") or options.get("url", "").split("?")[0]))[:200],
            "fileName": file_name(pdir),
            # The film's own title tag, when the release carries one.
            "titleTag": container_title(movie),
        })
        set_status(pdir, stage="analyzed", state="done", message="Analysis ready", progress=1.0)
    except Exception as error:  # noqa: BLE001 - every failure becomes a status the app can show
        set_status(pdir, state="failed", error=str(error)[:800])


# ---------------------------------------------------------------- render

def ass_time(seconds):
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int(seconds % 3600 // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def write_captions(path, lines, width, height, short, font="DejaVu Sans"):
    # Shorts: one or two bold words at a time with a thick outline, about 70% down the frame.
    # Long recaps: a single readable line near the bottom.
    size = 96 if short else 50
    margin = int(height * (0.30 if short else 0.07))
    header = (
        "[Script Info]\nScriptType: v4.00+\nWrapStyle: 2\nScaledBorderAndShadow: yes\n"
        f"PlayResX: {width}\nPlayResY: {height}\n\n[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Recap,{font},{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,{8 if short else 3},{0 if short else 1},2,{int(width * 0.06)},{int(width * 0.06)},{margin},1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    events = []
    for line in lines:
        text = re.sub(r"[{}\\]", "", line["text"]).strip()
        if text:
            events.append(f"Dialogue: 0,{ass_time(line['start'])},{ass_time(line['end'])},Recap,,0,0,0,,{text}")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(header + "\n".join(events) + "\n")


def short_crop_x(cut, width, mirror):
    """The crop's left edge as an ffmpeg expression: the window centres on the main character, from where
    they are as the cut starts to where they are as it ends (the app measures both on the real frames)."""
    x0, x1 = cut.get("x0"), cut.get("x1")
    if x0 is None or x1 is None:
        return "(iw-ow)/2"
    if mirror:
        x0, x1 = 1 - x0, 1 - x1
    span = max(0.1, float(cut.get("duration") or 1))
    return f"'clip(iw*({x0:.4f}+({x1 - x0:.4f})*min(t/{span:.3f}\\,1))-ow/2\\,0\\,iw-ow)'"


def cut_luma(movie, start, length):
    """Average brightness (0-255) of a frame from the middle of a cut, or None."""
    probe = subprocess.run([
        "ffmpeg", "-hide_banner", "-nostats", "-ss", f"{start + length / 2:.3f}", "-i", movie, "-frames:v", "1", "-an",
        "-vf", "scale=160:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-",
    ], capture_output=True, text=True, timeout=120)
    match = re.search(r"YAVG=([0-9.]+)", probe.stderr)
    return float(match.group(1)) if match else None


def lift_filter(luma):
    """Editing standard: a dark picture is brightened, not left murky. Lifts mids on cuts under ~28% luma."""
    if luma is None or luma >= 70:
        return ""
    gamma = min(1.6, max(1.1, (78 / max(luma, 18)) ** 0.55))
    return f"eq=gamma={gamma:.2f}:brightness=0.02"


# The film's own subtitles sit in the bottom band of the frame (or the letterbox bar under it).
SUBS_TOP, SUBS_HEIGHT = 0.74, 0.24


def subs_blur(source):
    """Blurs the subtitle band of `source`; returns (graph prefix, new label)."""
    radius = "'min(h/5\\,28)'"
    return (f"{source}split[sa][sb];[sb]crop=iw:ih*{SUBS_HEIGHT}:0:ih*{SUBS_TOP},boxblur=luma_radius={radius}:luma_power=3:chroma_radius='min(ch/5\\,14)':chroma_power=3[sblur];"
            f"[sa][sblur]overlay=0:H*{SUBS_TOP}[src];", "[src]")


def cut_filter(transforms, width, height, short, seed, cut=None, luma=None):
    rng = random.Random(seed)
    zoom = 1.0 + (rng.uniform(0.06, 0.1) if transforms.get("zoom", True) else 0.0)
    # A cut close in the film to the one before it is mirrored (the plan marks it), on top of the global switch.
    mirror = bool(transforms.get("mirror")) != bool((cut or {}).get("flip"))
    lift = lift_filter(luma)
    chain = [lift] if lift else []
    prefix, source = subs_blur("[0:v]") if (cut or {}).get("subs") else ("", "[0:v]")
    if transforms.get("speed"):
        chain.append("setpts=PTS/1.05")
    if short:
        # Portrait, as the channel's Shorts do it: the film zoomed and centre-cropped into a band about
        # 73% of the height (characters fill the middle), over a blurred, darkened copy of the same frame.
        band = int(height * 0.73) // 2 * 2
        inner = f"scale=-2:{int(band * zoom) // 2 * 2},crop={width}:{band}:{short_crop_x(cut or {}, width, mirror)}:(ih-oh)/2"
        pre = ",".join(chain + ["fps=30"])
        flip = ",hflip" if mirror else ""
        color = ",eq=saturation=1.08:contrast=1.04:gamma=0.98" if transforms.get("color", True) else ""
        return (f"{prefix}{source}{pre}{flip}{color},split[a][b];"
                f"[a]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},gblur=sigma=28,eq=brightness=-0.18[bg];"
                f"[b]{inner}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]")
    chain += [f"scale={width}:{height}:force_original_aspect_ratio=increase", f"crop={width}:{height}"]
    if zoom > 1:
        chain += [f"crop=iw/{zoom:.3f}:ih/{zoom:.3f}", f"scale={width}:{height}"]
    if mirror:
        chain.append("hflip")
    if transforms.get("color", True):
        chain.append(f"eq=saturation={rng.uniform(1.04, 1.1):.3f}:contrast={rng.uniform(1.02, 1.06):.3f}:gamma=0.98")
    chain += ["fps=30", "setsar=1"]
    return prefix + source + ",".join(chain) + "[v]"


HYPERFRAMES = os.environ.get("HYPERFRAMES_BIN") or "/opt/autoyt/hyperframes/node_modules/.bin/hyperframes"
# HyperFrames downloads its own Chrome on first use; the media worker already has one for Promo Studio.
HYPERFRAMES_BROWSER = os.environ.get("HYPERFRAMES_BROWSER_PATH") or next(
    (p for p in ("/opt/autoyt/promo-renderer/chrome/chrome-headless-shell",) if os.path.isfile(p)), "")


def render_graphics(batches, audio_dir, work):
    """The recap's motion graphics as transparent clips: each lower-third template (title card, name intros,
    subscribe) is a HyperFrames composition in audio_dir/graphics, rendered once per moment with --batch to
    ProRes 4444. Returns [(start seconds, clip path)]. A template that fails is skipped: graphics never
    fail a render."""
    graphics = os.path.abspath(os.path.join(audio_dir, "graphics"))
    out = os.path.join(os.path.abspath(work), "graphics")
    clips = []
    for batch in batches:
        kind = re.sub(r"[^a-z]", "", str(batch.get("type", "")))
        events = batch.get("events") or []
        if not kind or not events or not os.path.isfile(os.path.join(graphics, f"{kind}.html")):
            continue
        os.makedirs(out, exist_ok=True)
        try:
            subprocess.run([HYPERFRAMES, "render", graphics, "-c", f"{kind}.html", "--format", "mov", "--batch", os.path.join(graphics, f"{kind}.json"),
                            "-o", os.path.join(out, f"{kind}-{{index}}.mov"), "--workers", "2", "--no-browser-gpu", "--quiet", "--json"],
                           cwd=graphics, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=1800, check=True,
                           env={**os.environ, **({"HYPERFRAMES_BROWSER_PATH": HYPERFRAMES_BROWSER} if HYPERFRAMES_BROWSER else {})})
        except Exception as error:  # noqa: BLE001
            print(f"graphics: {kind} render failed: {str(getattr(error, 'stderr', '') or error)[-600:]}", file=sys.stderr, flush=True)
            continue
        for index, event in enumerate(events):
            clip = os.path.join(out, f"{kind}-{index}.mov")
            if os.path.isfile(clip):
                clips.append((float(event["start"]), clip))
    return clips


def overlay_graphics(clip_paths, clip_starts, frame_counts, graphics):
    """Lays each graphic over just the cut clips it spans, before they are joined: re-encoding the whole
    12-minute picture for a few seconds of graphics took about 6.5 minutes. A clip keeps its frame count,
    so the picture stays in step with the narration. A clip that fails keeps its picture without them."""
    for index, path_ in enumerate(clip_paths):
        at = clip_starts[index]
        length = frame_counts[index] / FPS
        over = [(start, mov, probe_duration(mov)) for start, mov in graphics]
        over = [(start, mov) for start, mov, seconds in over if start < at + length and start + seconds > at]
        if not over:
            continue
        inputs, chain, last = [], [], "[0:v]"
        for n, (start, mov) in enumerate(over, start=1):
            offset = start - at
            inputs += (["-itsoffset", f"{offset:.3f}", "-i", mov] if offset >= 0 else ["-ss", f"{-offset:.3f}", "-i", mov])
            chain.append(f"{last}[{n}:v]overlay=eof_action=pass:format=auto[g{n}]")
            last = f"[g{n}]"
        temp = path_ + ".graphics.mp4"
        try:
            run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-threads", "3", "-i", path_, *inputs, "-filter_complex", ";".join(chain),
                 "-map", last, "-an", "-frames:v", str(frame_counts[index]), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", temp], timeout=600)
            os.replace(temp, path_)
        except Exception as error:  # noqa: BLE001
            print(f"graphics: overlay on clip {index} failed: {str(error)[-300:]}", file=sys.stderr, flush=True)


JUMP_LIMIT = 55  # frame_difference under this between neighbouring clips: one camera shot (server JUMP_DIFF)


def check_cuts(picture, clip_starts):
    """The finished picture's cut check: clips whose camera angle changes partway through (a camera cut
    found anywhere but a clip's start), and neighbouring clips from one camera shot (jump cuts). Returns
    {"angleChanges": [clip index...], "jumpCuts": [clip index...]}; empty lists when the check fails."""
    try:
        log = picture + ".shots.txt"
        subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-loglevel", "error", "-threads", "4", "-i", picture, "-an",
                        "-vf", f"scale=320:-2:flags=fast_bilinear,scdet=threshold={CHECK_THRESHOLD}:sc_pass=1,metadata=print:file={log}", "-f", "null", "-"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=3600, check=True)
        with open(log, encoding="utf-8") as handle:
            found = parse_shot_cuts(handle.read())
        import bisect
        changes = set()
        for t in found:
            index = bisect.bisect_right(clip_starts, t) - 1
            # A camera cut within two frames of a clip's start is the edit itself.
            if index >= 0 and t - clip_starts[index] > 2.5 / FPS and (index + 1 >= len(clip_starts) or clip_starts[index + 1] - t > 2.5 / FPS):
                changes.add(index)

        def jump(index):
            before = tiny_frame(picture, clip_starts[index] - 2 / FPS)
            after = tiny_frame(picture, clip_starts[index] + 2 / FPS)
            diff = frame_difference(before, after)
            return index if diff is not None and diff < JUMP_LIMIT else None

        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=4) as pool:
            jumps = [i for i in pool.map(jump, range(1, len(clip_starts))) if i is not None]
        return {"angleChanges": sorted(changes), "jumpCuts": jumps}
    except Exception as error:  # noqa: BLE001
        print(f"cut check skipped: {str(error)[-300:]}", file=sys.stderr, flush=True)
        return {"angleChanges": [], "jumpCuts": []}


def watermark_filter(watermark, width, height, audio_dir):
    """The channel name in the top corner, as a drawtext filter (letters, digits, and a few marks only)."""
    text = re.sub(r"[^A-Za-z0-9 &!?.-]", "", watermark or "").upper()[:40]
    if not text:
        return ""
    mark = f"drawtext=text='{text}':fontsize={int(height * 0.026)}:fontcolor=white@0.55:x=w-tw-{int(width * 0.03)}:y={int(height * 0.04)}:shadowcolor=black@0.45:shadowx=2:shadowy=2"
    font = os.path.join(os.path.abspath(audio_dir), "graphics", "fonts", "Montserrat.ttf")
    return mark + (f":fontfile='{font}'" if os.path.isfile(font) else "")


def join_narration(audio_dir, names, pause, output):
    """Beat clips end to end with a short pause after each, as one 48 kHz mono track."""
    inputs, parts = [], []
    for index, name in enumerate(names):
        inputs += ["-i", os.path.join(audio_dir, os.path.basename(name))]
        parts.append(f"[{index}:a]aresample=48000,aformat=channel_layouts=mono,apad=pad_dur={pause}[a{index}]")
    graph = ";".join(parts) + ";" + "".join(f"[a{i}]" for i in range(len(names))) + f"concat=n={len(names)}:v=0:a=1[out]"
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", "[out]", output], timeout=1800)


FPS = 30
CUT_LANES = int(os.environ.get("MOVIE_RECAP_CUT_LANES") or 3)


def cut_frames(durations, fps=FPS):
    """Whole frames for each cut, taken off the running timeline so rounding never adds up: cut n spans
    frames round(t_n * fps) to round(t_n+1 * fps)."""
    counts, at = [], 0.0
    for duration in durations:
        counts.append(max(1, round((at + duration) * fps) - round(at * fps)))
        at += duration
    return counts


def render_format(pdir, movie, plan, fmt, audio_dir):
    spec = plan["formats"][fmt]
    short = fmt == "short"
    width, height = (1080, 1920) if short else (1920, 1080)
    work = os.path.join(pdir, "render", fmt)
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    transforms = plan.get("transforms", {})
    cuts = spec["cuts"]
    # Every cut is a whole number of frames counted off the running timeline, so cut n starts on the frame
    # nearest its planned time. Encoding each cut to its own length rounded every one up to a whole frame,
    # and over 239 cuts the picture fell 2.4 s behind the narration.
    frame_counts = cut_frames([cut["duration"] for cut in cuts])
    listing = [f"file '{os.path.join(work, f'c{index:04d}.mp4')}'" for index in range(len(cuts))]
    done = [0]
    lock = threading.Lock()

    def cut_one(index):
        cut = cuts[index]
        clip = os.path.join(work, f"c{index:04d}.mp4")
        length = cut["end"] - cut["start"]
        run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-threads", "2",
            "-ss", f"{cut['start']:.3f}", "-t", f"{length * (1.05 if transforms.get('speed') else 1) + 0.5:.3f}", "-i", movie,
            "-filter_complex", cut_filter(transforms, width, height, short, f"{plan.get('seed', '')}-{index}", cut, cut_luma(movie, cut["start"], length)) + ";[v]tpad=stop_mode=clone:stop_duration=1[vx]",
            "-map", "[vx]", "-an", "-frames:v", str(frame_counts[index]), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-pix_fmt", "yuv420p", clip,
        ], timeout=600)
        with lock:
            done[0] += 1
            if done[0] % 5 == 0:
                set_status(pdir, stage=f"render-{fmt}", message=f"Cutting the {'Short' if short else 'long recap'} ({done[0]}/{len(cuts)} cuts)",
                           progress=0.05 + 0.65 * done[0] / max(1, len(cuts)))

    # Three cuts at a time on the worker's four cores: each one seeks and decodes on its own, so running them
    # side by side cuts the stage to about a third of the time with the same encode settings.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=CUT_LANES) as pool:
        list(pool.map(cut_one, range(len(cuts))))
    clip_paths = [os.path.join(work, f"c{index:04d}.mp4") for index in range(len(cuts))]
    clip_starts, at = [], 0
    for count in frame_counts:
        clip_starts.append(at / FPS)
        at += count
    if spec.get("graphics"):
        set_status(pdir, stage=f"render-{fmt}", message="Adding the motion graphics", progress=0.7)
        overlay_graphics(clip_paths, clip_starts, frame_counts, render_graphics(spec["graphics"], audio_dir, work))
    with open(os.path.join(work, "cuts.txt"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(listing) + "\n")
    picture = os.path.join(work, "picture.mp4")
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(work, "cuts.txt"), "-c", "copy", "-movflags", "+faststart", picture], timeout=1800)
    set_status(pdir, stage=f"render-{fmt}", message=f"Checking every cut of the {'Short' if short else 'long recap'} for angle changes and jump cuts", progress=0.72)
    cut_qa = check_cuts(picture, clip_starts)
    narration = os.path.join(work, "narration.wav")
    join_narration(audio_dir, spec["audioFiles"], spec.get("pause", 0.35), narration)
    captions = os.path.join(work, "captions.ass")
    font_file = os.path.join(audio_dir, os.path.basename(plan.get("font", ""))) if plan.get("font") else ""
    has_font = bool(font_file) and os.path.isfile(font_file)
    fonts_dir = os.path.join(work, "fonts")
    if has_font:
        # A folder of its own: libass tries to load every file in fontsdir, narration included.
        os.makedirs(fonts_dir, exist_ok=True)
        shutil.copyfile(font_file, os.path.join(fonts_dir, os.path.basename(font_file)))
    write_captions(captions, spec.get("captions", []), width, height, short, "Montserrat ExtraBold" if has_font else "DejaVu Sans")
    set_status(pdir, stage=f"render-{fmt}", message=f"Mixing narration and captions for the {'Short' if short else 'long recap'}", progress=0.75)
    output = os.path.join(pdir, "render", f"recap-{fmt}.mp4")
    vf = (f"ass={captions}:fontsdir={fonts_dir}" if has_font else f"ass={captions}") if plan.get("captions", True) else "null"
    # Background music sits about 12 dB under the voice (house standard: 10-15 dB), looped to length,
    # faded in and out. The film's own audio is never used.
    music = plan.get("music") or {}
    music_path = os.path.join(audio_dir, os.path.basename(music.get("name", ""))) if music.get("name") else ""
    total = probe_duration(narration)
    # The last frame holds for a short tail so the music can fade out instead of stopping on the last word,
    # and the finished mix (voice plus bed) is mastered to -14 LUFS, true peak under -1 dBTP: normalising
    # each stem alone left the sum about 1.5 LU quiet with peaks at -0.5 (the quality gate's findings).
    tail = 0.8
    final = total + tail
    master = f"loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,afade=t=out:st={final - 0.4:.2f}:d=0.4"
    if music_path and os.path.isfile(music_path):
        mix = (f"[1:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-15:TP=-1.5:LRA=11,apad=pad_dur={tail}[vo];"
               f"[2:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I={-15 - float(music.get('under', 12)):.1f}:TP=-6,"
               f"afade=t=in:d=1.5,afade=t=out:st={max(0.0, final - 2.5):.2f}:d=2.5[bed];"
               f"[vo][bed]amix=inputs=2:duration=first:normalize=0,{master}[a]")
        audio_args = ["-stream_loop", "-1", "-i", music_path, "-filter_complex", mix, "-map", "0:v", "-map", "[a]"]
    else:
        audio_args = ["-map", "0:v", "-map", "1:a", "-af", f"apad=pad_dur={tail},{master}"]
    hold = f"tpad=stop_mode=clone:stop_duration={tail + 0.5}"
    # The channel watermark goes on in this pass, which encodes the picture anyway (long recaps only).
    mark = watermark_filter(plan.get("watermark", ""), width, height, audio_dir) if not short else ""
    for with_mark in ([True, False] if mark else [False]):
        chain = [f for f in (vf if vf != "null" else "", mark if with_mark else "", hold) if f]
        try:
            run([
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-threads", "4", "-i", picture, "-i", narration, *audio_args,
                "-vf", ",".join(chain), "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "-t", f"{final:.3f}", output,
            ], timeout=3 * 3600)
            break
        except Exception as error:  # noqa: BLE001
            # An ffmpeg built without drawtext still renders the recap, without the watermark.
            if not with_mark:
                raise
            print(f"watermark skipped: {str(error)[-300:]}", file=sys.stderr, flush=True)
    # Vibe Edit opens the recap as an edit: the cut picture and the narration as separate media, so
    # every cut, line, and caption stays adjustable there.
    kept_picture = os.path.join(pdir, "render", f"picture-{fmt}.mp4")
    os.replace(picture, kept_picture)
    kept_voice = os.path.join(pdir, "render", f"narration-{fmt}.m4a")
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", narration, "-af", "loudnorm=I=-15:TP=-1.5:LRA=11",
         "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", kept_voice], timeout=1800)
    shutil.rmtree(work, ignore_errors=True)
    files = []
    for kind, path_ in (("final", output), ("picture", kept_picture), ("narration", kept_voice)):
        files.append({"format": fmt, "kind": kind, "name": os.path.basename(path_), "size": os.path.getsize(path_), "duration": round(probe_duration(path_), 2),
                      **({"cuts": cut_qa} if kind == "final" else {})})
    set_status(pdir, stage=f"render-{fmt}", message=f"Checking the {'Short' if short else 'long recap'}'s sound and picture", progress=0.97)
    files[0]["qa"] = measure_video(output)
    return files


def measure_video(path_):
    """The quality gate's raw measurements (server/videoQa.js parses and judges them): ffmpeg's loudness
    summary, black, frozen, and silent runs, and the level of the last 0.15 s. Never fails the render."""
    try:
        graph = ("[0:a]ebur128=peak=true:framelog=-8,silencedetect=noise=-50dB:d=0.3[a];"
                 "[0:v]fps=10,scale=320:-2,blackdetect=d=0.1:pix_th=0.08,freezedetect=n=0.002:d=2[v]")
        pass_ = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path_, "-filter_complex", graph, "-map", "[a]", "-f", "null", "-", "-map", "[v]", "-f", "null", "-"],
                               capture_output=True, text=True, timeout=1800)
        keep = [line for line in pass_.stderr.splitlines() if re.search(r"black_start|freeze_|silence_|Summary:|^\s+(I|LRA|Peak|Threshold|LRA low|LRA high):", line)]
        tail = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-sseof", "-0.15", "-i", path_, "-vn", "-af", "astats=measure_perchannel=none", "-f", "null", "-"],
                              capture_output=True, text=True, timeout=120)
        keep += [line for line in tail.stderr.splitlines() if "RMS level dB" in line][-1:]
        return "\n".join(keep)[-20000:]
    except Exception as error:  # noqa: BLE001
        return f"measure failed: {error}"


def run_render(args):
    pdir = project_dir(args.project)
    heartbeat(pdir)
    try:
        plan = read_json(os.path.join(pdir, "plan.json"), None)
        movie = movie_path(pdir)
        if not plan or not movie:
            raise RuntimeError("The film is no longer on the media worker. Analyze it again.")
        outputs = []
        for fmt in [name for name in ("long", "short") if name in plan.get("formats", {})]:
            outputs.extend(render_format(pdir, movie, plan, fmt, os.path.join(pdir, "audio")))
        set_status(pdir, stage="rendered", state="done", message="Recap ready", progress=1.0, outputs=outputs)
    except Exception as error:  # noqa: BLE001
        set_status(pdir, state="failed", error=str(error)[:800])


# ---------------------------------------------------------------- commands

def cmd_start_analyze(args):
    sweep_old()
    pdir = project_dir(args.project)
    os.makedirs(pdir, exist_ok=True)
    status = read_json(os.path.join(pdir, "status.json"), {}) or {}
    if status.get("state") == "running" and time.time() - status.get("updatedAt", 0) < 600:
        return emit({"started": False, "status": status})
    options = json.loads(args.options or "{}")
    options.update({"url": args.url or "", "file": ""})
    if args.file:
        ext = os.path.splitext(args.file)[1].lower() or ".mp4"
        kept = os.path.join(pdir, f"source{ext}")
        shutil.copyfile(args.file, kept)
        options["file"] = kept
    write_json(os.path.join(pdir, "options.json"), options)
    write_json(os.path.join(pdir, "status.json"), {"stage": "queued", "state": "running", "message": "Starting", "progress": 0.01, "updatedAt": time.time()})
    spawn_detached(pdir, "run-analyze", ["--project", args.project])
    emit({"started": True})


def cmd_start_render(args):
    pdir = project_dir(args.project)
    if not movie_path(pdir):
        return emit({"error": "The film is no longer on the media worker. Analyze it again."})
    audio = os.path.join(pdir, "audio")
    if args.plan:
        shutil.copyfile(args.plan, os.path.join(pdir, "plan.json"))
        shutil.rmtree(audio, ignore_errors=True)
        shutil.copytree(args.audio_dir, audio)
    elif not (os.path.isfile(os.path.join(pdir, "plan.json")) and os.path.isdir(audio)):
        # A resume reuses the plan and narration already on the worker.
        return emit({"error": "The render plan is no longer on the media worker. Press Render to start it again."})
    write_json(os.path.join(pdir, "status.json"), {"stage": "render", "state": "running", "message": "Starting the render", "progress": 0.01, "updatedAt": time.time()})
    spawn_detached(pdir, "run-render", ["--project", args.project])
    emit({"started": True})


def process_alive(pdir, status):
    """False when the run's process is gone (killed, crashed hard): no need to wait for its heartbeat to age."""
    if time.time() - status.get("updatedAt", 0) < 90:
        return True  # just started, or the pid file is being written
    try:
        with open(os.path.join(pdir, "pid"), "r", encoding="utf-8") as handle:
            pid = int(handle.read().strip())
        os.kill(pid, 0)
        with open(f"/proc/{pid}/cmdline", "rb") as handle:
            return b"movie_recap.py" in handle.read()
    except FileNotFoundError:
        return not os.path.isdir("/proc")
    except (OSError, ValueError):
        return False


def cmd_status(args):
    pdir = project_dir(args.project)
    status = read_json(os.path.join(pdir, "status.json"), None)
    if status is None:
        return emit({"state": "missing"})
    # A worker reboot leaves "running" behind with no process; report it as stalled.
    if status.get("state") == "running" and (time.time() - status.get("updatedAt", 0) > 1800 or not process_alive(pdir, status)):
        status["state"] = "stalled"
    if args.out and status.get("state") == "done" and status.get("stage") == "analyzed":
        os.makedirs(args.out, exist_ok=True)
        shutil.copyfile(os.path.join(pdir, "analysis.json"), os.path.join(args.out, "analysis.json"))
        shutil.copytree(os.path.join(pdir, "sheets"), os.path.join(args.out, "sheets"), dirs_exist_ok=True)
    emit(status)


def cmd_fetch(args):
    pdir = project_dir(args.project)
    name = os.path.basename(args.name)
    source = os.path.join(pdir, "render", name)
    if not os.path.isfile(source):
        return emit({"error": "missing"})
    os.makedirs(args.out, exist_ok=True)
    shutil.copyfile(source, os.path.join(args.out, name))
    emit({"ok": True, "size": os.path.getsize(source)})


def cmd_measure(args):
    """Seconds of every audio file in --out, so the app can lay cuts under each narration beat."""
    lengths = {}
    for name in sorted(os.listdir(args.out)):
        try:
            lengths[name] = round(probe_duration(os.path.join(args.out, name)), 3)
        except Exception:  # noqa: BLE001
            lengths[name] = 0
    emit({"lengths": lengths})


def cmd_stop(args):
    pdir = project_dir(args.project)
    try:
        with open(os.path.join(pdir, "pid"), "r", encoding="utf-8") as handle:
            os.killpg(int(handle.read().strip()), signal.SIGTERM)
    except Exception:  # noqa: BLE001 - nothing running is fine
        pass
    if os.path.isdir(pdir):
        set_status(pdir, state="failed", error="Stopped")
    emit({"ok": True})


def cmd_tighten(args):
    """Narration without dead air, at the chosen pace: trims silence at both ends, shortens every pause
    longer than 0.2 s to 0.12 s, and speeds delivery up (pitch kept). Writes <name>.t.wav next to each
    clip, leaves the original for re-renders, and returns the tightened lengths."""
    tempo = max(0.8, min(1.4, float(args.tempo or 1.1)))
    chain = ("silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.04,areverse,"
             "silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.06,areverse,"
             "silenceremove=stop_periods=-1:stop_duration=0.2:stop_threshold=-42dB:stop_silence=0.12")
    if abs(tempo - 1) > 0.01:
        chain += f",atempo={tempo:.3f}"
    lengths = {}
    for name in sorted(os.listdir(args.out)):
        if ".t." in name or not name.lower().endswith((".wav", ".mp3")):
            continue
        target = os.path.join(args.out, f"{os.path.splitext(name)[0]}.t{int(round(tempo * 100))}.wav")
        if not os.path.exists(target):
            run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", os.path.join(args.out, name), "-af", chain, "-ar", "24000", "-ac", "1", target], timeout=600)
        lengths[name] = {"name": os.path.basename(target), "seconds": round(probe_duration(target), 3)}
    emit({"lengths": lengths})


def cmd_frames(args):
    """The centring check's eyes: one frame at each requested film time, written to --out as f0000.jpg,
    f0001.jpg, ... (frame n = times[n]), plus the film's aspect so the app knows how much of the width
    a Short shows. Frames go out one per image: models misread positions inside tiled sheets."""
    pdir = project_dir(args.project)
    movie = movie_path(pdir)
    if not movie:
        return emit({"error": "The film is no longer on the media worker. Analyze it again."})
    times = [max(0.0, float(t)) for t in (json.loads(args.options or "{}").get("times") or [])][:600]
    os.makedirs(args.out, exist_ok=True)

    def grab(item):
        index, at = item
        subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{at:.3f}", "-i", movie, "-frames:v", "1", "-an",
            "-vf", "scale=448:-2,setsar=1", "-q:v", "4", os.path.join(args.out, f"f{index:04d}.jpg"),
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        return f"f{index:04d}.jpg" if os.path.isfile(os.path.join(args.out, f"f{index:04d}.jpg")) else None

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=3) as pool:
        frames = list(pool.map(grab, enumerate(times)))
    if not any(frames):
        return emit({"error": "Couldn't read frames from the film."})
    probe = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "json", movie], capture_output=True, text=True, timeout=60)
    try:
        stream = json.loads(probe.stdout)["streams"][0]
        aspect = stream["width"] / stream["height"]
    except Exception:  # noqa: BLE001
        aspect = 16 / 9
    emit({"frames": frames, "aspect": round(aspect, 4)})


# scdet's scene score (0-100) for a camera cut. 8 missed cuts between shots that share one palette (a dark
# bar lit by string lights scores 5.4-7.7), so the film is searched at 5; a stray extra cut only makes the
# planner a little stricter. The finished picture's check stays at 8 (its zoom and grade lift real cuts).
SHOT_THRESHOLD = 5
CHECK_THRESHOLD = 8
SHOT_CACHE = f"shot-cuts-t{SHOT_THRESHOLD}.json"


def parse_shot_cuts(text):
    return sorted({round(float(t), 3) for t in re.findall(r"pts_time:([0-9.]+)", text)})


def detect_shot_cuts(movie, pdir=None):
    """Every camera cut in the film (seconds), from one low-resolution pass: a recap clip must sit inside
    one shot, and the 81 coarse scene changes miss most of them. Cached in shot-cuts.json."""
    cache = os.path.join(pdir, SHOT_CACHE) if pdir else ""
    if cache and os.path.isfile(cache):
        return read_json(cache, [])
    log = os.path.join(pdir or "/tmp", "shot-cuts.txt")
    subprocess.run([
        "ffmpeg", "-hide_banner", "-nostats", "-loglevel", "error", "-threads", "3", "-i", movie, "-an",
        "-vf", f"scale=320:-2:flags=fast_bilinear,scdet=threshold={SHOT_THRESHOLD}:sc_pass=1,metadata=print:file={log}", "-f", "null", "-",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=3 * 3600, check=True)
    with open(log, encoding="utf-8") as handle:
        cuts = parse_shot_cuts(handle.read())
    if cache:
        write_json(cache, cuts)
    return cuts


def cmd_shots(args):
    """The film's camera cuts, for a recap analysed before they were recorded."""
    pdir = project_dir(args.project)
    movie = movie_path(pdir)
    if not movie:
        return emit({"error": "The film is no longer on the media worker. Analyze it again."})
    emit({"shotCuts": detect_shot_cuts(movie, pdir), "threshold": SHOT_THRESHOLD})


JUMP_W, JUMP_H = 32, 18


def tiny_frame(movie, at):
    """A 32x18 grayscale frame at a film time, as bytes (b"" when unreadable)."""
    try:
        return subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{max(0.0, at):.3f}", "-i", movie, "-frames:v", "1", "-an",
            "-vf", f"scale={JUMP_W}:{JUMP_H}:flags=area,format=gray", "-f", "rawvideo", "-",
        ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=120).stdout
    except subprocess.TimeoutExpired:
        return b""


def frame_difference(a, b):
    """How different two tiny frames look, 0 (the same picture) up: each frame is evened out for brightness
    and contrast first, so two dark shots don't pass for one shot, and a jump cut inside one camera shot
    stays low when the light shifts. Same-shot pairs score under about 35; cuts to another shot score higher."""
    size = JUMP_W * JUMP_H
    if len(a) != size or len(b) != size:
        return None

    def normal(frame):
        mean = sum(frame) / size
        spread = (sum((x - mean) ** 2 for x in frame) / size) ** 0.5
        return [(x - mean) / max(spread, 4.0) for x in frame]

    za, zb = normal(a), normal(b)
    return round(100 * sum(abs(x - y) for x, y in zip(za, zb)) / size, 1)


def cmd_similar(args):
    """Jump-cut check: for each pair of film times (the end of one cut, the start of the next), how different
    the two frames look. Returns {"diffs": [number | null, ...]} in pair order."""
    pdir = project_dir(args.project)
    movie = movie_path(pdir)
    if not movie:
        return emit({"error": "The film is no longer on the media worker. Analyze it again."})
    pairs = [(float(p[0]), float(p[1])) for p in (json.loads(args.options or "{}").get("pairs") or [])][:800]

    def compare(pair):
        return frame_difference(tiny_frame(movie, pair[0]), tiny_frame(movie, pair[1]))

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=4) as pool:
        emit({"diffs": list(pool.map(compare, pairs))})


# Finished recap media lives here, outside the 4-day project sweep, and is served by the media worker's
# nginx at /media/ to links the app signs: the hosted app (512 MB, /tmp in RAM) never holds these files.
MEDIA_ROOT = os.environ.get("MOVIE_RECAP_MEDIA") or "/var/lib/autoyt-media"


def cmd_publish(args):
    """Moves a finished file (render/<name>) into MEDIA_ROOT/<project>/<name> and returns its media path."""
    pdir = project_dir(args.project)
    name = os.path.basename(args.name)
    source = os.path.join(pdir, "render", name)
    folder = os.path.join(MEDIA_ROOT, os.path.basename(args.project))
    target = os.path.join(folder, name)
    if os.path.isfile(source):
        os.makedirs(folder, exist_ok=True)
        os.chmod(MEDIA_ROOT, 0o755)
        os.chmod(folder, 0o755)
        shutil.move(source, target + ".part")
        os.replace(target + ".part", target)
        os.chmod(target, 0o644)
    if not os.path.isfile(target):
        return emit({"error": "missing"})
    emit({"ok": True, "path": f"{os.path.basename(args.project)}/{name}", "size": os.path.getsize(target)})


def cmd_plan_info(args):
    """Each cut's place in the film for one format (from the render plan), for recaps planned before the
    app kept these itself."""
    plan = read_json(os.path.join(project_dir(args.project), "plan.json"), None)
    if not plan:
        return emit({"error": "The render plan is no longer on the media worker."})
    fmt = json.loads(args.options or "{}").get("format", "long")
    cuts = (plan.get("formats", {}).get(fmt) or {}).get("cuts") or []
    emit({"cuts": [{"start": c["start"], "end": c["end"]} for c in cuts]})


def cmd_recut(args):
    """One replacement shot for a recap: the film at `start` for `duration` seconds, with the same look as
    the cut it replaces (its transforms, its seed, the Short's framing), published to the media folder."""
    o = json.loads(args.options or "{}")
    pdir = project_dir(args.project)
    movie = movie_path(pdir)
    plan = read_json(os.path.join(pdir, "plan.json"), {}) or {}
    if not movie:
        return emit({"error": "The film is no longer on the media worker. Analyze it again."})
    fmt = "short" if o.get("format") == "short" else "long"
    short = fmt == "short"
    width, height = (1080, 1920) if short else (1920, 1080)
    start = max(0.0, float(o["start"]))
    duration = max(0.5, min(8.0, float(o["duration"])))
    index = int(o.get("index", 0))
    name = re.sub(r"[^a-z0-9-]", "", str(o.get("name", ""))) or f"recut-{int(time.time())}"
    transforms = plan.get("transforms", {})
    cut = {"start": start, "end": start + duration, "duration": duration}
    os.makedirs(os.path.join(pdir, "render"), exist_ok=True)
    output = os.path.join(pdir, "render", f"{name}.mp4")
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-threads", "3",
        "-ss", f"{start:.3f}", "-t", f"{duration * (1.05 if transforms.get('speed') else 1):.3f}", "-i", movie,
        "-filter_complex", cut_filter(transforms, width, height, short, f"{plan.get('seed', '')}-{index}", cut, cut_luma(movie, start, duration)),
        "-map", "[v]", "-an", "-t", f"{duration:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", output,
    ], timeout=600)
    args.name = f"{name}.mp4"
    cmd_publish(args)


def cmd_cleanup(args):
    cmd_stop(args)
    shutil.rmtree(project_dir(args.project), ignore_errors=True)
    shutil.rmtree(os.path.join(MEDIA_ROOT, os.path.basename(args.project)), ignore_errors=True)
    emit({"ok": True})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command")
    parser.add_argument("--project", default="measure-only")
    parser.add_argument("--url")
    parser.add_argument("--file")
    parser.add_argument("--options")
    parser.add_argument("--plan")
    parser.add_argument("--audio-dir")
    parser.add_argument("--out")
    parser.add_argument("--name")
    parser.add_argument("--tempo")
    args = parser.parse_args()
    commands = {
        "start-analyze": cmd_start_analyze,
        "run-analyze": run_analyze,
        "start-render": cmd_start_render,
        "run-render": run_render,
        "status": cmd_status,
        "fetch": cmd_fetch,
        "cleanup": cmd_cleanup,
        "measure": cmd_measure,
        "tighten": cmd_tighten,
        "stop": cmd_stop,
        "frames": cmd_frames,
        "similar": cmd_similar,
        "shots": cmd_shots,
        "transcribe-chunk": cmd_transcribe_chunk,
        "publish": cmd_publish,
        "plan-info": cmd_plan_info,
        "recut": cmd_recut,
    }
    if args.command not in commands:
        return emit({"error": f"unknown command {args.command}"})
    commands[args.command](args)


if __name__ == "__main__":
    main()
