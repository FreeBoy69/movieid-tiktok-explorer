import sys
import os
import json

# Redirect all warnings and library logs to stderr so stdout stays clean JSON
import warnings
warnings.filterwarnings("ignore")
os.environ["TRANSFORMERS_VERBOSITY"] = "error"
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

# Redirect ctranslate2 / faster-whisper internal logs to stderr
import logging
logging.basicConfig(stream=sys.stderr, level=logging.ERROR)


def output(obj):
    """Write JSON to stdout and flush immediately."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


WHISPER_PYTHONS = [
    os.environ.get("WHISPER_PYTHON", ""),
    "/opt/autoyt/whisper-venv/bin/python",
    "/opt/autoyt/venv/bin/python",
]


def delegate_to_whisper_python(audio_path):
    """Re-run this script under an interpreter that has faster-whisper.
    Returns True when that interpreter produced the JSON result."""
    import subprocess
    # A venv's python is a symlink to the system one, so loops are stopped by a flag, not by path.
    if os.environ.get("AUTOYT_WHISPER_DELEGATED"):
        return False
    script = os.path.abspath(__file__)
    env = {**os.environ, "AUTOYT_WHISPER_DELEGATED": "1"}
    for python in WHISPER_PYTHONS:
        if not python or not os.path.isfile(python):
            continue
        try:
            result = subprocess.run([python, script, audio_path], capture_output=True, text=True, timeout=1800, env=env)
        except Exception:  # noqa: BLE001
            continue
        lines = [line for line in result.stdout.strip().splitlines() if line.startswith("{") and line.endswith("}")]
        if lines and '"faster-whisper module not found' not in lines[-1]:
            sys.stdout.write(lines[-1] + "\n")
            sys.stdout.flush()
            return True
    return False


def transcribe_audio(audio_path):
    # 1. Validate file exists and has non-trivial size
    if not os.path.exists(audio_path):
        output({"success": False, "error": f"Audio file not found: {audio_path}"})
        return

    file_size = os.path.getsize(audio_path)
    if file_size < 1024:  # Less than 1KB means download likely failed
        output({"success": False, "error": f"Downloaded file is too small ({file_size} bytes) — the video platform may have blocked the download or the URL is invalid."})
        return

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        # Media workers keep Whisper in its own venv (the VPS worker's system
        # python has none), so hand the file to the first python that has it.
        if delegate_to_whisper_python(audio_path):
            return
        output({"success": False, "error": "faster-whisper module not found. Run: pip install faster-whisper"})
        return

    try:
        model_size = "base"
        model = WhisperModel(model_size, device="cpu", compute_type="int8")

        try:
            segments_generator, info = model.transcribe(
                audio_path,
                beam_size=5,
                vad_filter=True,  # Skip silent portions
                word_timestamps=True,
            )
        except Exception as vad_error:
            if "tuple index out of range" not in str(vad_error).lower():
                raise
            print("VAD transcription failed; retrying without VAD filter.", file=sys.stderr)
            segments_generator, info = model.transcribe(
                audio_path,
                beam_size=1,
                vad_filter=False,
                word_timestamps=True,
            )

        # Consume the generator safely
        texts = []
        segments = []
        for segment in segments_generator:
            texts.append(segment.text)
            segments.append({
                "start": float(getattr(segment, "start", 0) or 0),
                "end": float(getattr(segment, "end", 0) or 0),
                "text": segment.text,
                "words": [
                    {
                        "start": float(getattr(word, "start", 0) or 0),
                        "end": float(getattr(word, "end", 0) or 0),
                        "word": str(getattr(word, "word", "") or ""),
                        "probability": float(getattr(word, "probability", 0) or 0),
                    }
                    for word in (getattr(segment, "words", None) or [])
                ],
            })

        full_text = " ".join(texts).strip()

        if not full_text:
            output({"success": False, "error": "No speech detected in the audio. The video may be silent or music-only."})
        else:
            output({"success": True, "text": full_text, "segments": segments})

    except Exception as e:
        message = str(e)
        if "tuple index out of range" in message.lower():
            message = "The local transcription model could not segment this audio. AutoYT normalized the audio and retried without silence filtering, but transcription still failed."
        output({"success": False, "error": f"Transcription failed: {message}"})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        output({"success": False, "error": "No audio path provided"})
        sys.exit(1)

    transcribe_audio(sys.argv[1])
