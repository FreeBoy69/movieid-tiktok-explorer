"""One-time move from Voicebox to KittenVoice: profiles (same ids, names, descriptions, languages),
cloned voices' samples (prepared for KittenTTS 2), Kokoro presets (mapped to KittenTTS mini voices),
and the generation history with its audio, so links the app already holds keep working.

Run inside the KittenVoice image with Voicebox's data mounted read-only at /voicebox and its output
folder at /voicebox-output, before the service starts.
"""
import json, shutil, sqlite3, subprocess, sys
from pathlib import Path

sys.path.insert(0, "/app")
import service  # noqa: E402  (loads DATA, profiles, history, and starts the worker)

VB = Path("/voicebox")
VB_OUT = Path("/voicebox-output")
# Kokoro preset -> the closest KittenTTS mini voice (gender and accent).
PRESETS = {"am_liam": "Jasper", "af_nova": "Luna", "am_echo": "Bruno", "bm_daniel": "Hugo"}

db = sqlite3.connect(f"file:{VB / 'voicebox.db'}?mode=ro", uri=True)
db.row_factory = sqlite3.Row
rows = db.execute("select * from profiles").fetchall()
samples = {}
for s in db.execute("select * from profile_samples"):
    samples.setdefault(s["profile_id"], []).append(s)

for r in rows:
    pid = r["id"]
    if pid in service.profiles and service.profiles[pid].get("samples"):
        print("already moved:", r["name"]); continue
    cloned = r["voice_type"] == "cloned"
    p = {"id": pid, "name": r["name"], "description": r["description"] or "", "language": r["language"] or "en",
         "voice_type": "cloned" if cloned else "preset", "preset_engine": None if cloned else "kitten-mini",
         "preset_voice_id": None if cloned else PRESETS.get(r["preset_voice_id"] or "", "Bruno"),
         "default_engine": "kitten" if cloned else "kitten-mini", "personality": r["personality"], "samples": [],
         "created_at": r["created_at"], "updated_at": r["updated_at"]}
    service.profiles[pid] = p
    service.save_profiles()
    if not cloned:
        print("preset:", r["name"], r["preset_voice_id"], "->", p["preset_voice_id"]); continue
    for s in samples.get(pid, [])[:1]:
        src = VB / s["audio_path"]
        folder = service.DATA / "samples" / pid
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / f"{s['id']}.wav"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(src), "-ac", "1", "-ar", "24000", str(target)], check=True)
        sample = {"id": s["id"], "profile_id": pid, "audio_path": f"samples/{pid}/{s['id']}.wav", "reference_text": s["reference_text"]}
        job = {"kind": "prepare", "id": "migrate-" + s["id"], "profile_id": pid, "sample": sample, "status": "queued",
               "done": __import__("threading").Event()}
        service.enqueue(job)
        job["done"].wait(timeout=1200)
        if job["status"] == "completed":
            p["samples"] = [sample]
            service.save_profiles()
            print("cloned:", r["name"], "prepared in", job.get("seconds"), "s")
        else:
            print("FAILED to prepare", r["name"], job.get("error"))

# History, with the audio files, newest last.
moved = 0
known = {h["id"] for h in service.history}
for g in db.execute("select * from generations order by created_at"):
    if g["id"] in known:
        continue
    item = {"kind": "generate", "id": g["id"], "profile_id": g["profile_id"], "text": g["text"], "language": g["language"] or "en",
            "instruct": g["instruct"], "engine": g["engine"], "model_size": g["model_size"], "seed": g["seed"],
            "status": g["status"], "error": g["error"], "created_at": g["created_at"], "duration": g["duration"]}
    name = Path(g["audio_path"] or "").name
    src = VB_OUT / name
    if g["status"] == "completed" and name and src.exists():
        shutil.copy2(src, service.DATA / "generations" / name)
        item["audio_path"] = f"generations/{name}"
    elif g["status"] == "completed":
        item["status"] = "failed"; item["error"] = "Audio from the old voice service was not kept."
    service.history.append(item)
    service.by_id[item["id"]] = item
    moved += 1
service.save_history()
print("history moved:", moved, "audio files:", len(list((service.DATA / "generations").glob("*.wav"))))
