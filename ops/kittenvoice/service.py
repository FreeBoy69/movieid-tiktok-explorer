"""KittenVoice: AutoYT's voice service, a drop-in for Voicebox's HTTP API on KittenTTS.

Cloned voices speak through KittenTTS 2 (the kitten-tts-2-cpp CPU runtime); preset voices through the
small KittenTTS mini model, kept loaded. One job runs at a time (the VPS has 4 cores), in a queue that
also prepares new cloned voices. Profiles, samples, history, and audio live under DATA.

The routes and JSON shapes match what AutoYT's server reads from Voicebox (server.js voiceboxFetch,
server/voicebox.js): /profiles, /profiles/{id}/samples, /samples/{id}, /generate, /generate/{id}/cancel,
/history, /history/{id}, /audio/{id}, /health.
"""
import json, os, re, shutil, signal, subprocess, threading, time, uuid, wave
from datetime import datetime
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

DATA = Path(os.environ.get("KV_DATA", "/data"))
ASSETS = DATA / "assets"                      # KittenTTS 2 runtime assets (config.json, voices.json, cpp/)
ENGINE = Path(os.environ.get("KV_ENGINE", "/engine/kitten-tts-2-cpp"))
BINARY = ENGINE / "build/bin/kitten-tts"
GRAMMAR = ENGINE / "build/tools/kitten-tts/text-processing/data"  # the text normaliser's prepared grammar
REPO = Path(os.environ.get("KV_REPO", ""))    # the KittenTTS 2 model snapshot (for voice preparation)
PYPKG = Path(os.environ.get("KV_PYPKG", "/engine/KittenTTS"))
THREADS = int(os.environ.get("KV_THREADS", "4"))
MINI_MODEL = os.environ.get("KV_MINI_MODEL", "KittenML/kitten-tts-mini-0.8")
SR = 24000

for d in ("samples", "generations"):
    (DATA / d).mkdir(parents=True, exist_ok=True)
PROFILES = DATA / "profiles.json"
HISTORY = DATA / "history.json"
lock = threading.RLock()


def now() -> str:
    return datetime.utcnow().isoformat()


def load(path: Path, default):
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def save(path: Path, value) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value))
    tmp.replace(path)


profiles: dict = load(PROFILES, {})
history: list = load(HISTORY, [])
by_id = {h["id"]: h for h in history}


def save_profiles():
    with lock:
        save(PROFILES, profiles)


def save_history():
    with lock:
        del history[:-5000]
        save(HISTORY, history)


def voice_key(profile_id: str) -> str:
    """The name a cloned voice has in the runtime's voices.json (never clashes with built-ins)."""
    return "p_" + re.sub(r"[^0-9a-f]", "", profile_id.lower())


def public_profile(p: dict) -> dict:
    out = {k: p.get(k) for k in ("id", "name", "description", "language", "voice_type", "preset_engine", "preset_voice_id", "default_engine", "personality", "created_at", "updated_at")}
    out.update(avatar_path=None, effects_chain=None, design_prompt=None, sample_count=len(p.get("samples", [])) if p.get("voice_type") == "cloned" else 0,
               generation_count=sum(1 for h in history if h.get("profile_id") == p["id"]))
    return out


# ---------- direction -> KittenTTS expression tag ----------
# KittenTTS 2 takes one leading mood tag; free-text directions ("angry, whispered") are mapped onto it.
MOODS = [
    ("angry", r"angr|furious|rage|enrag|livid|shout"),
    ("sad", r"\bsad|grief|griev|somber|sombre|melanchol|mourn|heartbr|tearful|sorrow"),
    ("nervous", r"nervous|anxious|scared|afraid|fear|tense|suspense|uneasy|worried|panic"),
    ("excited", r"excit|energetic|hype|upbeat|enthusias|thrill|lively|pumped|quick, energetic"),
    ("joyful", r"joy|happy|cheer|delight|playful|laugh|bright|warm and friendly"),
    ("tender", r"tender|soft|gentle|whisper|loving|intimate|soothing|caring"),
    ("stern", r"stern|firm|serious|authorit|command|cold|menac|threat"),
    ("contemplative", r"contemplat|thoughtful|reflect|pensive|wistful|philosoph"),
    ("surprised", r"surpris|shock|amaz|astonish|stunned"),
    ("mundane", r"mundane|neutral|flat|matter-of-fact|documentary|plain"),
]


def mood_of(instruct: str) -> str:
    text = (instruct or "").lower()
    for mood, pattern in MOODS:
        if re.search(pattern, text):
            return mood
    return ""


# ---------- the runtime's voices.json and manifest ----------
def fix_manifest_sizes():
    """The runtime checks each asset's recorded size; voices.json grows as voices are added."""
    cfg_path = ASSETS / "config.json"
    cfg = json.loads(cfg_path.read_text())

    def walk(node):
        if isinstance(node, dict):
            f = node.get("file")
            if f and "size" in node and (ASSETS / f).exists():
                node["size"] = os.path.getsize(os.path.realpath(ASSETS / f))
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(cfg.get("cpp", {}))
    save(cfg_path, cfg)


def remove_runtime_voice(key: str):
    voices_path = ASSETS / "voices.json"
    voices = json.loads(voices_path.read_text())
    if key in voices:
        voices.pop(key)
        save(voices_path, voices)
        fix_manifest_sizes()


# ---------- the job queue: one generation or voice preparation at a time ----------
queue: list = []
cond = threading.Condition()
current = {"job": None, "proc": None}
mini = {"model": None}


def mini_model():
    if mini["model"] is None:
        from kittenml import KittenTTS
        mini["model"] = KittenTTS(MINI_MODEL)
    return mini["model"]


def write_pcm16(path: Path, audio: np.ndarray):
    audio = np.clip(np.asarray(audio, dtype=np.float32).reshape(-1), -1.0, 1.0)
    sf.write(str(path), audio, SR, subtype="PCM_16")
    return round(len(audio) / SR, 3)


# The runtime was built elsewhere: point it at its own shared libraries (llama, ggml) wherever they sit.
LIB_DIRS = sorted({str(p.parent) for p in (ENGINE / "build").rglob("*.so*")})
RUN_ENV = dict(os.environ, LD_LIBRARY_PATH=":".join([*LIB_DIRS, os.environ.get("LD_LIBRARY_PATH", "")]).strip(":"))


def run(cmd, job=None, timeout=1800):
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True, env=RUN_ENV)
    if job is not None:
        current["proc"] = proc
    try:
        out, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        raise RuntimeError("The voice took too long to generate.")
    finally:
        current["proc"] = None
    if job is not None and job.get("status") == "cancelled":
        raise RuntimeError("cancelled")
    if proc.returncode != 0:
        raise RuntimeError((out or b"").decode(errors="replace")[-400:] or f"exit {proc.returncode}")
    return (out or b"").decode(errors="replace")


def generate(job: dict):
    profile = profiles.get(job["profile_id"])
    if not profile:
        raise RuntimeError("The voice no longer exists.")
    out = DATA / "generations" / f"{job['id']}.wav"
    text = job["text"]
    if profile.get("voice_type") == "cloned":
        if not profile.get("samples"):
            raise RuntimeError("This cloned voice has no usable voice sample yet.")
        mood = mood_of(job.get("instruct") or "")
        spoken = f"[{mood}] {text}" if mood else text
        raw = DATA / "generations" / f"{job['id']}.raw.wav"
        cmd = [str(BINARY), "--assets", str(ASSETS), "--voice", voice_key(profile["id"]), "--threads", str(THREADS),
               "--text", spoken, "--output", str(raw), "--offline", "--data", str(GRAMMAR)]
        if mood:
            cmd += ["--preset", "expressive"]
        if job.get("seed") is not None:
            cmd += ["--seed", str(int(job["seed"]))]
        run(cmd, job)
        audio, _ = sf.read(str(raw), dtype="float32")
        raw.unlink(missing_ok=True)
    else:
        voice = profile.get("preset_voice_id") or "Bruno"
        audio = mini_model().generate(text, voice=voice)
        if job.get("status") == "cancelled":
            raise RuntimeError("cancelled")
    job["duration"] = write_pcm16(out, audio)
    job["audio_path"] = f"generations/{job['id']}.wav"


def prepare(job: dict):
    """Turn a cloned voice's sample into a runtime voice (KittenTTS 2's offline preparation, ~20 s)."""
    profile = profiles[job["profile_id"]]
    sample = job["sample"]
    key = voice_key(profile["id"])
    remove_runtime_voice(key)
    run(["python", str(ENGINE / "tools/kitten-tts/prepare_reference.py"), "--repo", str(REPO), "--assets", str(ASSETS),
         "--python-package", str(PYPKG), "--reference", str(DATA / sample["audio_path"]),
         "--transcript", sample["reference_text"], "--name", key, "--threads", str(THREADS)], job, timeout=900)
    fix_manifest_sizes()


def worker():
    while True:
        with cond:
            while not queue:
                cond.wait()
            job = queue.pop(0)
        if job.get("status") == "cancelled":
            continue
        current["job"] = job
        job["status"] = "generating"
        started = time.time()
        try:
            if job["kind"] == "prepare":
                prepare(job)
            else:
                generate(job)
            if job.get("status") != "cancelled":
                job["status"] = "completed"
        except Exception as error:  # noqa: BLE001
            if job.get("status") != "cancelled":
                job["status"] = "failed"
                job["error"] = str(error)[:400]
        job["seconds"] = round(time.time() - started, 2)
        current["job"] = None
        if job["kind"] == "generate":
            save_history()
        done = job.get("done")
        if done:
            done.set()


threading.Thread(target=worker, daemon=True).start()


def enqueue(job: dict):
    with cond:
        queue.append(job)
        cond.notify()


# ---------- HTTP API (Voicebox-compatible) ----------
app = FastAPI(title="KittenVoice")


@app.get("/health")
def health():
    return {"status": "healthy", "model_loaded": True, "model_downloaded": True, "model_size": None, "engine": "kittentts",
            "gpu_available": False, "backend_type": "kitten-tts-2-cpp", "queue": len(queue), "busy": bool(current["job"])}


@app.get("/profiles")
def list_profiles():
    return [public_profile(p) for p in sorted(profiles.values(), key=lambda p: p.get("created_at") or "")]


@app.get("/profiles/{pid}")
def get_profile(pid: str):
    if pid not in profiles:
        raise HTTPException(404, "Profile not found")
    return public_profile(profiles[pid])


@app.post("/profiles")
async def create_profile(request: Request):
    body = await request.json()
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "A voice needs a name.")
    voice_type = str(body.get("voice_type") or "cloned")
    pid = str(uuid.uuid4())
    profile = {
        "id": pid, "name": name[:120], "description": str(body.get("description") or ""), "language": str(body.get("language") or "en"),
        "voice_type": voice_type, "preset_engine": body.get("preset_engine") if voice_type != "cloned" else None,
        "preset_voice_id": body.get("preset_voice_id") if voice_type != "cloned" else None,
        "default_engine": "kitten" if voice_type == "cloned" else "kitten-mini", "personality": body.get("personality"),
        "samples": [], "created_at": now(), "updated_at": now(),
    }
    with lock:
        profiles[pid] = profile
    save_profiles()
    return public_profile(profile)


async def update_profile(pid: str, request: Request):
    if pid not in profiles:
        raise HTTPException(404, "Profile not found")
    body = await request.json()
    p = profiles[pid]
    for key in ("name", "description", "language", "personality"):
        if key in body and body[key] is not None:
            p[key] = str(body[key]) if key != "personality" else body[key]
    p["updated_at"] = now()
    save_profiles()
    return public_profile(p)


@app.patch("/profiles/{pid}")
async def patch_profile(pid: str, request: Request):
    return await update_profile(pid, request)


@app.put("/profiles/{pid}")
async def put_profile(pid: str, request: Request):
    return await update_profile(pid, request)


@app.delete("/profiles/{pid}")
def delete_profile(pid: str):
    with lock:
        p = profiles.pop(pid, None)
    if not p:
        raise HTTPException(404, "Profile not found")
    save_profiles()
    for s in p.get("samples", []):
        (DATA / s["audio_path"]).unlink(missing_ok=True)
    if p.get("voice_type") == "cloned":
        remove_runtime_voice(voice_key(pid))
    return {"message": "Profile deleted"}


@app.get("/profiles/{pid}/samples")
def list_samples(pid: str):
    if pid not in profiles:
        raise HTTPException(404, "Profile not found")
    return [{k: s[k] for k in ("id", "profile_id", "audio_path", "reference_text")} for s in profiles[pid].get("samples", [])]


@app.post("/profiles/{pid}/samples")
async def add_sample(pid: str, file: UploadFile = File(...), reference_text: str = Form("")):
    if pid not in profiles:
        raise HTTPException(404, "Profile not found")
    if not reference_text.strip():
        raise HTTPException(400, "A sample needs the words spoken in it (reference_text).")
    sid = str(uuid.uuid4())
    folder = DATA / "samples" / pid
    folder.mkdir(parents=True, exist_ok=True)
    upload = folder / f"{sid}.upload"
    upload.write_bytes(await file.read())
    target = folder / f"{sid}.wav"
    # Any format in, 24 kHz mono WAV out, the way the preparation step reads it.
    convert = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(upload), "-ac", "1", "-ar", str(SR), str(target)], capture_output=True)
    upload.unlink(missing_ok=True)
    if convert.returncode != 0:
        raise HTTPException(400, "That audio couldn't be read.")
    sample = {"id": sid, "profile_id": pid, "audio_path": f"samples/{pid}/{sid}.wav", "reference_text": reference_text.strip()}
    job = {"kind": "prepare", "id": str(uuid.uuid4()), "profile_id": pid, "sample": sample, "status": "queued", "done": threading.Event()}
    enqueue(job)
    job["done"].wait(timeout=1200)
    if job["status"] != "completed":
        target.unlink(missing_ok=True)
        raise HTTPException(500, f"The voice couldn't be prepared: {job.get('error') or job['status']}")
    p = profiles[pid]
    # One voice per profile: a new sample replaces the old one.
    for old in p.get("samples", []):
        (DATA / old["audio_path"]).unlink(missing_ok=True)
    p["samples"] = [sample]
    p["updated_at"] = now()
    save_profiles()
    return sample


@app.get("/samples/{sid}")
def get_sample(sid: str):
    for p in profiles.values():
        for s in p.get("samples", []):
            if s["id"] == sid:
                return FileResponse(DATA / s["audio_path"], media_type="audio/x-wav", filename=f"sample_{sid}.wav")
    raise HTTPException(404, "Sample not found")


def public_generation(job: dict) -> dict:
    p = profiles.get(job["profile_id"], {})
    return {"id": job["id"], "profile_id": job["profile_id"], "profile_name": p.get("name"), "text": job["text"], "language": job.get("language", "en"),
            "audio_path": job.get("audio_path"), "duration": job.get("duration"), "seed": job.get("seed"), "instruct": job.get("instruct"),
            "engine": job.get("engine"), "model_size": job.get("model_size"), "status": job.get("status"), "error": job.get("error"),
            "is_favorited": False, "created_at": job.get("created_at"), "versions": None, "active_version_id": None}


@app.post("/generate")
async def create_generation(request: Request):
    body = await request.json()
    pid = str(body.get("profile_id") or "")
    text = str(body.get("text") or "").strip()
    if pid not in profiles:
        raise HTTPException(404, "Profile not found")
    if not text:
        raise HTTPException(400, "Text is required.")
    job = {"kind": "generate", "id": str(uuid.uuid4()), "profile_id": pid, "text": text[:5000], "language": str(body.get("language") or "en"),
           "instruct": body.get("instruct"), "engine": body.get("engine"), "model_size": body.get("model_size"), "seed": body.get("seed"),
           "status": "generating", "error": None, "created_at": now()}
    with lock:
        history.append(job)
        by_id[job["id"]] = job
    save_history()
    enqueue(job)
    return public_generation(job)


@app.post("/generate/{gid}/cancel")
def cancel_generation(gid: str):
    job = by_id.get(gid)
    if not job:
        raise HTTPException(404, "Generation not found")
    if job.get("status") in ("completed", "failed", "cancelled"):
        return {"message": f"Already {job['status']}"}
    job["status"] = "cancelled"
    proc = current["proc"]
    if current["job"] is job and proc:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    save_history()
    return {"message": "Cancelled"}


@app.get("/history")
def list_history(profile_id: str = "", search: str = "", limit: int = 50, offset: int = 0):
    items = [h for h in reversed(history) if (not profile_id or h["profile_id"] == profile_id) and (not search or search.lower() in h["text"].lower())]
    return {"items": [public_generation(h) for h in items[offset:offset + max(1, min(limit, 500))]], "total": len(items)}


@app.get("/history/{gid}")
def get_history(gid: str):
    job = by_id.get(gid)
    if not job:
        raise HTTPException(404, "Generation not found")
    return public_generation(job)


@app.get("/audio/{gid}")
def get_audio(gid: str):
    job = by_id.get(gid)
    path = DATA / (job.get("audio_path") or "") if job else None
    if not job or not job.get("audio_path") or not path.exists():
        raise HTTPException(404, "Audio not found")
    return FileResponse(path, media_type="audio/x-wav", filename=f"generation_{gid}.wav")
