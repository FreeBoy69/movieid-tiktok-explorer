// The one voice-cloning flow: record the passage or drop a recording, name the
// voice, pick its language, confirm. Used as the Audio Studio Clone tab and,
// inside a dialog, by VoiceCloneSheet. Cloned voices are private to their maker
// (server/voiceOwners.js).
import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { FileAudio, Loader2, Mic, RotateCcw, Shuffle, Square, Upload, X } from "lucide-react";
import { isVoiceReady, loadVoiceProfiles, VOICE_PROFILES_ROUTE } from "../../utils/voiceProfiles";
import { generateVoiceName } from "../../utils/voiceNames.js";
import { AudioPlayer } from "../AudioPlayer";
import { FileDrop } from "../FileDrop";
import { LanguagePicker, VOICEBOX_LANGUAGES } from "../LanguagePicker";
import { Notice, Segmented, Switch } from "../ui/controls";
import { canRecord, clockOf, MIN_RECORD_SECONDS, useVoiceRecorder, VOICE_PASSAGE } from "./voiceRecorder";
import "../AudioStudio.css";

export const MAX_SAMPLE_MB = 20;

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Couldn't read the recording"));
    reader.readAsDataURL(blob);
  });

async function json(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.detail || fallback);
  return data;
}

/** Creates a cloned voice from one sample; deletes the half-made profile if anything fails. */
export async function cloneVoiceProfile({ sample, filename, name, description = "", language = "en", removeNoise = true, onStage }: { sample: Blob; filename: string; name: string; description?: string; language?: string; removeNoise?: boolean; onStage?: (stage: string) => void }) {
  let created = "";
  try {
    onStage?.("Creating the voice");
    const profile = await json(
      await fetch(VOICE_PROFILES_ROUTE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim().slice(0, 100) || generateVoiceName(), description, language, voiceType: "cloned", defaultEngine: "kitten" }) }),
      "Couldn't create the voice",
    );
    created = String(profile.profile?.id || "");
    if (!created) throw new Error("Couldn't create the voice");
    onStage?.("Learning the voice");
    await json(
      await fetch(`/api/voicebox/profiles/${encodeURIComponent(created)}/samples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64: await toBase64(sample), filename, mimeType: sample.type || "audio/wav", removeNoise }),
      }),
      "The voice sample didn't upload",
    );
    const { profiles } = await loadVoiceProfiles();
    if (!isVoiceReady(profiles.find((voice) => voice.id === created))) throw new Error("The sample wasn't accepted. Use a clear 15–60 second recording of one speaker and try again.");
    return created;
  } catch (error) {
    if (created) void fetch(`/api/voicebox/profiles/${encodeURIComponent(created)}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}

export function VoiceCloneForm({ onCreated, onCancel, defaultLanguage = "en", heading = true, className = "" }: { onCreated: (voiceId: string, name: string) => void; onCancel?: () => void; defaultLanguage?: string; heading?: boolean; className?: string }) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"record" | "upload">(canRecord() ? "record" : "upload");
  const [upload, setUpload] = useState<File | null>(null);
  const [uploadUrl, setUploadUrl] = useState("");
  const [name, setName] = useState(() => generateVoiceName());
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState(VOICEBOX_LANGUAGES.includes(defaultLanguage) ? defaultLanguage : "en");
  const [denoise, setDenoise] = useState(true);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const rec = useVoiceRecorder();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/voicebox/status", { cache: "no-store" })
      .then((response) => !cancelled && setOnline(response.ok))
      .catch(() => !cancelled && setOnline(false));
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!upload) return setUploadUrl("");
    const url = URL.createObjectURL(upload);
    setUploadUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [upload]);

  const recording = rec.live !== null;
  const sample: Blob | null = mode === "upload" ? upload : rec.recording?.blob || null;
  const missing = online === false ? "Voice cloning is offline right now" : !sample ? (mode === "record" ? "Record the passage to continue" : "Add a recording to continue") : !name.trim() ? "Name the voice" : !consent ? "Confirm you have permission to continue" : "";
  const sampleError = mode === "record" ? rec.error : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (missing || !sample || busy || recording) return;
    setError("");
    try {
      const id = await cloneVoiceProfile({
        sample,
        filename: mode === "upload" && upload ? upload.name : "voice-sample.wav",
        name,
        description,
        language,
        removeNoise: denoise,
        onStage: setBusy,
      });
      onCreated(id, name.trim());
      setUpload(null);
      setConsent(false);
      setDescription("");
      setName(generateVoiceName());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice cloning failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className={`as-clone-flow ${className}`}>
      {heading ? (
        <header className="as-clone-head">
          <h2>Clone a voice</h2>
          <p>Read a short passage aloud, or upload a clean recording of one speaker. Voices you clone are private to you and appear in your library.</p>
        </header>
      ) : null}
      {online === false ? (
        <Notice tone="warning" title="Voice cloning is offline right now">
          You can still narrate with a built-in voice and clone yours later.
        </Notice>
      ) : null}

      <section className="as-step" aria-labelledby="as-step-sample">
        <div className="as-step-title">
          <span className="as-step-n" aria-hidden="true">1</span>
          <h3 id="as-step-sample">Voice sample</h3>
          <Segmented
            label="How to add the sample"
            size="sm"
            className="as-clone-mode"
            value={mode}
            onChange={(next) => setMode(next as "record" | "upload")}
            options={[
              { value: "record", label: "Record", icon: <Mic className="h-3.5 w-3.5" aria-hidden="true" />, disabled: !canRecord() || recording },
              { value: "upload", label: "Upload", icon: <Upload className="h-3.5 w-3.5" aria-hidden="true" />, disabled: recording },
            ]}
          />
        </div>

        {mode === "record" ? (
          <div className="as-rec">
            <p className="as-passage">{VOICE_PASSAGE}</p>
            <div className="as-rec-row">
              {recording ? (
                <button type="button" className="as-rec-btn is-live" onClick={rec.stop} aria-label="Stop recording">
                  <Square className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : (
                <button type="button" className="as-rec-btn" onClick={() => void rec.start()} disabled={Boolean(busy)} aria-label={rec.recording ? "Record again" : "Start recording"}>
                  {rec.recording ? <RotateCcw className="h-5 w-5" aria-hidden="true" /> : <Mic className="h-5 w-5" aria-hidden="true" />}
                </button>
              )}
              {recording ? (
                <div className="as-rec-live" role="status">
                  <div className="as-rec-meter" ref={rec.meter} aria-hidden="true">
                    {Array.from({ length: 24 }, (_, i) => <span key={i} style={{ "--i": i } as CSSProperties} />)}
                  </div>
                  <span className="as-rec-time">
                    <strong>{clockOf(rec.live || 0)}</strong>
                    {(rec.live || 0) < MIN_RECORD_SECONDS ? `Keep reading · at least ${MIN_RECORD_SECONDS}s` : "Good length · press stop when you finish"}
                  </span>
                </div>
              ) : rec.recording ? (
                <div className="as-rec-take">
                  <AudioPlayer src={rec.recording.url} label="Your recording" compact />
                  <span>{clockOf(rec.recording.seconds)} recorded · press the button to record again</span>
                </div>
              ) : (
                <span className="as-rec-hint">
                  <strong>Press record and read the passage</strong>
                  About 20 seconds at your normal pace, in a quiet room, close to the mic.
                </span>
              )}
            </div>
          </div>
        ) : upload ? (
          <div className="as-file">
            <span className="as-file-icon" aria-hidden="true"><FileAudio className="h-5 w-5" /></span>
            <span className="as-file-name">
              <strong>{upload.name}</strong>
              <small>{(upload.size / 1048576).toFixed(1)} MB</small>
            </span>
            <button type="button" className="ui-icon-btn is-bordered is-lg" onClick={() => setUpload(null)} aria-label="Remove this recording" title="Remove">
              <X className="h-4 w-4" />
            </button>
            {uploadUrl ? <AudioPlayer src={uploadUrl} label="Uploaded sample" compact className="as-file-player" /> : null}
          </div>
        ) : (
          <FileDrop
            accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg"
            maxBytes={MAX_SAMPLE_MB * 1024 * 1024}
            onError={setError}
            onFiles={([file]) => {
              setError("");
              setUpload(file);
            }}
            title="Choose or drop a recording"
            hint={`15–60 seconds of one speaker, no music · WAV, MP3, M4A or FLAC up to ${MAX_SAMPLE_MB} MB`}
          />
        )}
        {sampleError ? <p className="as-clone-error" role="alert">{sampleError}</p> : null}
      </section>

      <section className="as-step" aria-labelledby="as-step-details">
        <div className="as-step-title">
          <span className="as-step-n" aria-hidden="true">2</span>
          <h3 id="as-step-details">Name and language</h3>
        </div>
        <div className="as-clone-fields">
          <label className="as-field">
            <span>Name</span>
            <span className="as-name-row">
              <input className="ui-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="e.g. Nora Whitfield" autoComplete="off" />
              <button type="button" className="ui-icon-btn is-bordered is-lg" onClick={() => setName(generateVoiceName([name]))} aria-label="Suggest another name" title="Suggest another name">
                <Shuffle className="h-4 w-4" />
              </button>
            </span>
          </label>
          <div className="as-field">
            <span>Language</span>
            <LanguagePicker value={language} onChange={setLanguage} only={VOICEBOX_LANGUAGES} label="Voice language" />
          </div>
        </div>
        <label className="as-field">
          <span>Notes <em>optional</em></span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="ui-textarea" rows={2} style={{ minHeight: 64 }} placeholder="Tone and where you'll use it, e.g. calm recap narrator" />
        </label>
      </section>

      <section className="as-step" aria-labelledby="as-step-confirm">
        <div className="as-step-title">
          <span className="as-step-n" aria-hidden="true">3</span>
          <h3 id="as-step-confirm">Confirm</h3>
        </div>
        <Switch checked={denoise} onChange={setDenoise} label="Clean up background noise" description="Filters hum, hiss and room rumble. Leave it off for studio recordings." />
        <label className="as-check">
          <input type="checkbox" className="ui-check" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span><strong>I have the right to clone this voice</strong><small>It's my voice, or the speaker gave explicit permission.</small></span>
        </label>
      </section>

      {error ? <p className="as-clone-error" role="alert">{error}</p> : null}
      <div className="as-clone-foot">
        <span className="as-clone-missing" aria-live="polite">{busy ? `${busy}. This takes under a minute.` : missing}</span>
        {onCancel ? (
          <button type="button" className="ui-btn" onClick={onCancel} disabled={Boolean(busy)}>Cancel</button>
        ) : null}
        <button type="submit" disabled={Boolean(busy) || recording || Boolean(missing)} className="ui-btn is-primary is-lg">
          {busy ? <Loader2 className="h-4 w-4 ui-spin" /> : <Mic className="h-4 w-4" />}
          {busy ? "Creating voice" : "Create voice"}
        </button>
      </div>
    </form>
  );
}
