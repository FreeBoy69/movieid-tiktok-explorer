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
import json
import os
import random
import re
import shutil
import signal
import subprocess
import sys
import threading
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
    proc = subprocess.Popen(
        [sys.executable, script, command, *extra],
        stdout=log, stderr=log, stdin=subprocess.DEVNULL, start_new_session=True, close_fds=True,
        env={**os.environ, "MOVIE_RECAP_DIR": ROOT},
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
        # yt-dlp can refuse plain file links; fetch those directly.
        direct = direct_download(pdir, url)
        if direct:
            return direct
        raise RuntimeError("Couldn't download that link. " + " ".join(tail[-3:])[-400:])
    return movie_path(pdir)


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
    subprocess.run([
        "ffmpeg", "-hide_banner", "-nostats", "-loglevel", "error", "-threads", "2", "-i", movie, "-an",
        "-vf", vf, "-q:v", "5", os.path.join(sheets, "%03d.jpg"),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=3 * 3600, check=True)
    count = int(max(1, (duration - SHOT_EVERY / 2) // SHOT_EVERY + 1))
    # ffmpeg numbers sheets from 1; rename to 0-based so sheet k holds shots 12k..12k+11.
    for name in sorted(os.listdir(sheets)):
        number = int(os.path.splitext(name)[0])
        os.replace(os.path.join(sheets, name), os.path.join(sheets, f"s{number - 1:03d}.jpg"))
    return [{"i": i, "t": round(SHOT_EVERY / 2 + i * SHOT_EVERY, 2)} for i in range(count)]


def transcribe(movie, pdir, language):
    set_status(pdir, stage="transcribing", message="Transcribing the dialogue", progress=0.18)
    try:
        from faster_whisper import WhisperModel  # noqa: WPS433
    except Exception:
        return []
    audio = os.path.join(pdir, "audio.wav")
    if not os.path.exists(audio):
        run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", movie, "-vn", "-ac", "1", "-ar", "16000", audio], timeout=3 * 3600)
    duration = probe_duration(audio) or 1
    model = WhisperModel(os.environ.get("MOVIE_RECAP_WHISPER", "base"), device="cpu", compute_type="int8", cpu_threads=2)
    segments, _info = model.transcribe(audio, language=language or None, vad_filter=True, beam_size=1)
    lines = []
    last = 0.0
    for seg in segments:
        lines.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()})
        if time.time() - last > 8:
            last = time.time()
            done = min(1.0, seg.end / duration)
            set_status(pdir, message=f"Transcribing the dialogue ({done * 100:.0f}%)", progress=0.18 + 0.22 * done)
    os.remove(audio)
    return lines


def run_analyze(args):
    pdir = project_dir(args.project)
    heartbeat(pdir)
    options = read_json(os.path.join(pdir, "options.json"), {}) or {}
    try:
        movie = download(pdir, options.get("url", ""), options.get("file", ""))
        set_status(pdir, stage="probing", message="Reading the film", progress=0.16)
        duration = probe_duration(movie)
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
            "sheet": {"cols": SHEET_COLS, "rows": SHEET_ROWS, "count": len(os.listdir(os.path.join(pdir, "sheets")))},
            "shots": shots,
            "scenes": scenes,
            "transcript": transcript,
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


def cut_filter(transforms, width, height, short, seed):
    rng = random.Random(seed)
    zoom = 1.0 + (rng.uniform(0.06, 0.1) if transforms.get("zoom", True) else 0.0)
    chain = []
    if transforms.get("speed"):
        chain.append("setpts=PTS/1.05")
    if short:
        # Portrait, as the channel's Shorts do it: the film zoomed and centre-cropped into a band about
        # 73% of the height (characters fill the middle), over a blurred, darkened copy of the same frame.
        band = int(height * 0.73) // 2 * 2
        inner = f"scale=-2:{int(band * zoom) // 2 * 2},crop={width}:{band}"
        pre = ",".join(chain + ["fps=30"])
        flip = ",hflip" if transforms.get("mirror") else ""
        color = ",eq=saturation=1.08:contrast=1.04:gamma=0.98" if transforms.get("color", True) else ""
        return (f"[0:v]{pre}{flip}{color},split[a][b];"
                f"[a]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},gblur=sigma=28,eq=brightness=-0.18[bg];"
                f"[b]{inner}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]")
    chain += [f"scale={width}:{height}:force_original_aspect_ratio=increase", f"crop={width}:{height}"]
    if zoom > 1:
        chain += [f"crop=iw/{zoom:.3f}:ih/{zoom:.3f}", f"scale={width}:{height}"]
    if transforms.get("mirror"):
        chain.append("hflip")
    if transforms.get("color", True):
        chain.append(f"eq=saturation={rng.uniform(1.04, 1.1):.3f}:contrast={rng.uniform(1.02, 1.06):.3f}:gamma=0.98")
    chain += ["fps=30", "setsar=1"]
    return "[0:v]" + ",".join(chain) + "[v]"


def join_narration(audio_dir, names, pause, output):
    """Beat clips end to end with a short pause after each, as one 48 kHz mono track."""
    inputs, parts = [], []
    for index, name in enumerate(names):
        inputs += ["-i", os.path.join(audio_dir, os.path.basename(name))]
        parts.append(f"[{index}:a]aresample=48000,aformat=channel_layouts=mono,apad=pad_dur={pause}[a{index}]")
    graph = ";".join(parts) + ";" + "".join(f"[a{i}]" for i in range(len(names))) + f"concat=n={len(names)}:v=0:a=1[out]"
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *inputs, "-filter_complex", graph, "-map", "[out]", output], timeout=1800)


def render_format(pdir, movie, plan, fmt, audio_dir):
    spec = plan["formats"][fmt]
    short = fmt == "short"
    width, height = (1080, 1920) if short else (1920, 1080)
    work = os.path.join(pdir, "render", fmt)
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    transforms = plan.get("transforms", {})
    cuts = spec["cuts"]
    listing = []
    for index, cut in enumerate(cuts):
        if index % 5 == 0:
            set_status(pdir, stage=f"render-{fmt}", message=f"Cutting the {'Short' if short else 'long recap'} ({index}/{len(cuts)} cuts)",
                       progress=0.05 + 0.65 * index / max(1, len(cuts)))
        clip = os.path.join(work, f"c{index:04d}.mp4")
        length = cut["end"] - cut["start"]
        run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-threads", "3",
            "-ss", f"{cut['start']:.3f}", "-t", f"{length * (1.05 if transforms.get('speed') else 1):.3f}", "-i", movie,
            "-filter_complex", cut_filter(transforms, width, height, short, f"{plan.get('seed', '')}-{index}"),
            "-map", "[v]", "-an", "-t", f"{cut['duration']:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
            "-pix_fmt", "yuv420p", clip,
        ], timeout=600)
        listing.append(f"file '{clip}'")
    with open(os.path.join(work, "cuts.txt"), "w", encoding="utf-8") as handle:
        handle.write("\n".join(listing) + "\n")
    picture = os.path.join(work, "picture.mp4")
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(work, "cuts.txt"), "-c", "copy", picture], timeout=1800)
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
    if music_path and os.path.isfile(music_path):
        mix = (f"[1:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-15:TP=-1.5:LRA=11[vo];"
               f"[2:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I={-15 - float(music.get('under', 12)):.1f}:TP=-6,"
               f"afade=t=in:d=1.5,afade=t=out:st={max(0.0, total - 2.5):.2f}:d=2.5[bed];"
               "[vo][bed]amix=inputs=2:duration=first:normalize=0[a]")
        audio_args = ["-stream_loop", "-1", "-i", music_path, "-filter_complex", mix, "-map", "0:v", "-map", "[a]"]
    else:
        audio_args = ["-map", "0:v", "-map", "1:a", "-af", "loudnorm=I=-15:TP=-1.5:LRA=11"]
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-threads", "3", "-i", picture, "-i", narration, *audio_args,
        "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-t", f"{total:.3f}", output,
    ], timeout=3 * 3600)
    # Vibe Edit opens the recap as an edit: the cut picture and the narration as separate media, so
    # every cut, line, and caption stays adjustable there.
    kept_picture = os.path.join(pdir, "render", f"picture-{fmt}.mp4")
    os.replace(picture, kept_picture)
    kept_voice = os.path.join(pdir, "render", f"narration-{fmt}.m4a")
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", narration, "-af", "loudnorm=I=-15:TP=-1.5:LRA=11",
         "-c:a", "aac", "-b:a", "128k", kept_voice], timeout=1800)
    shutil.rmtree(work, ignore_errors=True)
    files = []
    for kind, path_ in (("final", output), ("picture", kept_picture), ("narration", kept_voice)):
        files.append({"format": fmt, "kind": kind, "name": os.path.basename(path_), "size": os.path.getsize(path_), "duration": round(probe_duration(path_), 2)})
    return files


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
    shutil.copyfile(args.plan, os.path.join(pdir, "plan.json"))
    audio = os.path.join(pdir, "audio")
    shutil.rmtree(audio, ignore_errors=True)
    shutil.copytree(args.audio_dir, audio)
    write_json(os.path.join(pdir, "status.json"), {"stage": "render", "state": "running", "message": "Starting the render", "progress": 0.01, "updatedAt": time.time()})
    spawn_detached(pdir, "run-render", ["--project", args.project])
    emit({"started": True})


def cmd_status(args):
    pdir = project_dir(args.project)
    status = read_json(os.path.join(pdir, "status.json"), None)
    if status is None:
        return emit({"state": "missing"})
    # A worker reboot leaves "running" behind with no process; report it as stalled.
    if status.get("state") == "running" and time.time() - status.get("updatedAt", 0) > 1800:
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


def cmd_cleanup(args):
    cmd_stop(args)
    shutil.rmtree(project_dir(args.project), ignore_errors=True)
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
    }
    if args.command not in commands:
        return emit({"error": f"unknown command {args.command}"})
    commands[args.command](args)


if __name__ == "__main__":
    main()
