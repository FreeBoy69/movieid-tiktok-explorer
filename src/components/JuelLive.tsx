// Live mode: talk with Juel out loud. The loop follows RealtimeVoiceChat (github.com/KoljaB/RealtimeVoiceChat),
// done in the browser: your words stream in as you speak (the browser's speech recognition, or recorded
// utterances sent to the transcriber where it has none), a pause that adapts to how you talk ends your turn,
// Juel's reply is spoken sentence by sentence while it is still being written (each next sentence fetched
// while the current one plays), his mouth follows the voice's loudness, and talking over him stops him.
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import { JuelMascot, type JuelPose, setJuelMood } from "./JuelMascot";

type Phase = "starting" | "listening" | "hearing" | "thinking" | "speaking" | "error";
const VOICES: Array<[string, string]> = [
  ["Puck", "Upbeat"],
  ["Zephyr", "Bright"],
  ["Achird", "Friendly"],
  ["Kore", "Calm"],
];
const VOICE_KEY = "juel:voice";
const MAX_SPOKEN = 900; // Longer replies: the start is spoken, the rest is in the chat.

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};
const recognitionClass = () => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

/** What to say out loud from a markdown reply: no code, links, tables or formatting marks. */
export function speakable(text: string): string {
  return String(text || "")
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/[*_`#>~]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
/** Whole sentences in `text` after `from`, and where the next one starts. A trailing partial sentence
 *  waits for more text unless `final`. */
export function nextSentences(text: string, from: number, final: boolean): { sentences: string[]; next: number } {
  const sentences: string[] = [];
  let at = from;
  const pattern = /[.!?…]+["')\]]?(\s|$)/g;
  pattern.lastIndex = from;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    const end = m.index + m[0].length;
    const sentence = text.slice(at, end).trim();
    // Very short bits ("Okay.") ride with the next sentence, so the voice doesn't stutter.
    if (sentence.length >= 18 || /[.!?]\s*$/.test(sentence) && sentence.split(/\s+/).length >= 4) {
      sentences.push(sentence);
      at = end;
    }
  }
  if (final && text.slice(at).trim()) {
    sentences.push(text.slice(at).trim());
    at = text.length;
  }
  return { sentences, next: at };
}

/** How long a pause ends your turn: short after a finished sentence, longer after a few words (you may
 *  still be thinking), and tuned to the gaps in how you speak. */
export function turnPause(transcript: string, gaps: number[]): number {
  const sorted = [...gaps].sort((a, b) => a - b);
  const typical = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 450;
  let pause = Math.min(1500, Math.max(700, typical * 2.2));
  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  if (/[.!?]$/.test(transcript.trim())) pause *= 0.75;
  if (words <= 2) pause += 400;
  return Math.round(pause);
}

export function JuelLive({
  reply,
  sending,
  lastReply,
  ask,
  interrupt,
  onEnd,
}: {
  /** The reply as it streams (null when no turn is running). */
  reply: string | null;
  sending: boolean;
  /** The finished reply of the last turn. */
  lastReply: string;
  ask: (text: string) => void;
  interrupt: () => void;
  onEnd: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [heard, setHeard] = useState("");
  const [saying, setSaying] = useState("");
  const [muted, setMuted] = useState(false);
  const [problem, setProblem] = useState("");
  const [voice, setVoice] = useState(() => {
    try {
      return window.localStorage.getItem(VOICE_KEY) || "Puck";
    } catch {
      return "Puck";
    }
  });
  const phaseRef = useRef<Phase>("starting");
  const recognition = useRef<Recognition | null>(null);
  // The recogniser keeps everything it heard since it started (Juel's own voice included): a clean
  // session starts whenever the floor goes back to you. It restarts itself (see onend).
  const freshEars = () => {
    try {
      recognition.current?.abort();
    } catch {}
  };
  const go = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  // ---------- Audio out: a queue of spoken sentences, mouth from the playing voice ----------
  const ctx = useRef<AudioContext | null>(null);
  const outAnalyser = useRef<AnalyserNode | null>(null);
  const queue = useRef<Array<{ text: string; audio: Promise<Blob | null> }>>([]);
  const playing = useRef<HTMLAudioElement | null>(null);
  const spokenUpTo = useRef(0);
  const spokenTotal = useRef(0);
  const turnDone = useRef(true);
  const generation = useRef(0); // bumped on interrupt: late audio from an old turn is dropped
  const audioContext = () => {
    if (!ctx.current) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx.current = new AC();
      outAnalyser.current = ctx.current.createAnalyser();
      outAnalyser.current.fftSize = 512;
      outAnalyser.current.connect(ctx.current.destination);
    }
    return ctx.current;
  };
  const setMouth = (value: number) => document.documentElement.style.setProperty("--jm-mouth", value.toFixed(3));

  const fetchVoice = useCallback(
    (text: string) =>
      fetch("/api/juel/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice }) })
        .then(async (response) => {
          if (response.ok) return response.blob();
          const data = await response.json().catch(() => ({}));
          if (response.status === 402) setProblem(data.error || "You're out of credits for Juel's voice.");
          return null;
        })
        .catch(() => null),
    [voice],
  );

  const playNext = useCallback(async () => {
    if (playing.current || !queue.current.length) return;
    const item = queue.current.shift()!;
    const gen = generation.current;
    setSaying(item.text);
    go("speaking");
    setJuelMood("speak");
    const blob = await item.audio;
    if (gen !== generation.current) return;
    const done = () => {
      playing.current = null;
      setMouth(0);
      if (gen !== generation.current) return;
      if (queue.current.length) void playNext();
      else if (turnDone.current) {
        setSaying("");
        setJuelMood("idle");
        freshEars();
        go("listening");
      }
    };
    if (blob) {
      const audio = new Audio(URL.createObjectURL(blob));
      playing.current = audio;
      try {
        const source = audioContext().createMediaElementSource(audio);
        source.connect(outAnalyser.current!);
      } catch {}
      audio.onended = () => {
        URL.revokeObjectURL(audio.src);
        done();
      };
      audio.onerror = done;
      await audio.play().catch(done);
      return;
    }
    // No hosted voice: the browser's own, with the mouth timed to its words.
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(item.text);
      utterance.rate = 1.05;
      utterance.pitch = 1.15;
      let flap = 0;
      const timer = window.setInterval(() => {
        flap = (flap + 1) % 4;
        setMouth([0.15, 0.8, 0.4, 0.95][flap]);
      }, 110);
      playing.current = { pause: () => window.speechSynthesis.cancel() } as unknown as HTMLAudioElement;
      utterance.onend = utterance.onerror = () => {
        window.clearInterval(timer);
        done();
      };
      window.speechSynthesis.speak(utterance);
    } else done();
  }, []);

  const enqueue = useCallback(
    (sentences: string[]) => {
      for (const text of sentences) {
        if (spokenTotal.current >= MAX_SPOKEN) break;
        spokenTotal.current += text.length;
        const said = spokenTotal.current >= MAX_SPOKEN ? `${text} I've put the rest in the chat.` : text;
        // Fetched now, played in order: the next sentence is ready when the current one ends.
        queue.current.push({ text: said, audio: fetchVoice(said) });
      }
      void playNext();
    },
    [fetchVoice, playNext],
  );

  const stopSpeaking = useCallback(() => {
    generation.current += 1;
    queue.current = [];
    playing.current?.pause();
    playing.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setMouth(0);
    setSaying("");
  }, []);

  // The reply streams in: speak each finished sentence; the rest when the turn ends.
  const lastSeen = useRef("");
  useEffect(() => {
    if (reply === null) return;
    turnDone.current = false;
    const text = speakable(reply);
    if (text.length < spokenUpTo.current) spokenUpTo.current = 0;
    const { sentences, next } = nextSentences(text, spokenUpTo.current, false);
    spokenUpTo.current = next;
    if (sentences.length) enqueue(sentences);
    lastSeen.current = text;
  }, [reply, enqueue]);
  useEffect(() => {
    if (sending) {
      if (phaseRef.current !== "speaking") go("thinking");
      return;
    }
    if (turnDone.current) return;
    // The turn finished: the final text decides what's left to say.
    turnDone.current = true;
    const text = speakable(lastReply || lastSeen.current);
    const { sentences } = nextSentences(text, Math.min(spokenUpTo.current, text.length), true);
    spokenUpTo.current = 0;
    if (sentences.length) enqueue(sentences);
    else if (!playing.current && !queue.current.length) go("listening");
  }, [sending, lastReply, enqueue]);

  // ---------- Audio in: speech recognition, a voice-activity meter, and turn-taking ----------
  const stream = useRef<MediaStream | null>(null);
  const transcript = useRef("");
  const gaps = useRef<number[]>([]);
  const lastWord = useRef(0);
  const endTimer = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const live = useRef(true);

  const commit = useCallback(
    (text: string) => {
      const said = text.trim();
      transcript.current = "";
      gaps.current = [];
      setHeard("");
      if (!said) return go("listening");
      spokenUpTo.current = 0;
      spokenTotal.current = 0;
      turnDone.current = false;
      go("thinking");
      ask(said);
    },
    [ask],
  );

  // Talking over Juel stops him and gives you the floor.
  const bargeIn = useCallback(() => {
    if (phaseRef.current !== "speaking" && phaseRef.current !== "thinking") return;
    stopSpeaking();
    interrupt();
    turnDone.current = true;
    transcript.current = "";
    freshEars();
    setJuelMood("listen");
    go("hearing");
  }, [interrupt, stopSpeaking]);

  useEffect(() => {
    live.current = true;
    let frame = 0;
    let noise = 0.008;
    let loudSince = 0;
    let quietSince = 0;
    let speaking = false;
    const SR = recognitionClass();
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setProblem("This browser can't use a microphone.");
        return go("error");
      }
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch {
        setProblem("Allow the microphone to talk with Juel (your browser's address bar has the setting).");
        return go("error");
      }
      if (!live.current) return;
      const context = audioContext();
      void context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream.current).connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      const outBuffer = new Float32Array(512);
      // One loop: the mic's loudness for turn-taking and barge-in, the voice's loudness for the mouth.
      const tick = () => {
        frame = requestAnimationFrame(tick);
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (const v of buffer) sum += v * v;
        const rms = Math.sqrt(sum / buffer.length);
        const now = performance.now();
        const phaseNow = phaseRef.current;
        if (!speaking) noise = noise * 0.995 + Math.min(rms, 0.05) * 0.005;
        // While Juel talks, only a clearly louder voice counts (echo cancellation removes most of his).
        const threshold = Math.max(phaseNow === "speaking" ? 0.045 : 0.018, noise * (phaseNow === "speaking" ? 5 : 3));
        if (!mutedRef.current && rms > threshold) {
          loudSince ||= now;
          quietSince = 0;
          if (!speaking && now - loudSince > (phaseNow === "speaking" ? 280 : 120)) {
            speaking = true;
            if (phaseNow === "speaking" || phaseNow === "thinking") bargeIn();
            else if (phaseNow === "listening") {
              setJuelMood("listen");
              go("hearing");
            }
            if (!SR && recorder.current?.state === "inactive") {
              chunks.current = [];
              recorder.current.start();
            }
          }
        } else {
          loudSince = 0;
          quietSince ||= now;
          // Without speech recognition, a pause ends the recorded utterance.
          if (speaking && !SR && now - quietSince > turnPause("", gaps.current)) {
            speaking = false;
            if (recorder.current?.state === "recording") recorder.current.stop();
          } else if (speaking && SR && now - quietSince > 400) speaking = false;
        }
        if (outAnalyser.current && playing.current) {
          outAnalyser.current.getFloatTimeDomainData(outBuffer);
          let out = 0;
          for (const v of outBuffer) out += v * v;
          setMouth(Math.min(1, Math.sqrt(out / outBuffer.length) * 6));
        }
      };
      tick();

      if (SR) {
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = navigator.language || "en-US";
        rec.onresult = (event) => {
          const p = phaseRef.current;
          if (mutedRef.current || (p !== "listening" && p !== "hearing")) return;
          let finalText = "";
          let interim = "";
          for (let i = 0; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) finalText += result[0].transcript;
            else interim += result[0].transcript;
          }
          const text = `${finalText} ${interim}`.replace(/\s+/g, " ").trim();
          if (!text) return;
          const now = performance.now();
          if (lastWord.current) gaps.current = [...gaps.current, now - lastWord.current].slice(-12);
          lastWord.current = now;
          transcript.current = text;
          setHeard(text);
          if (p === "listening") {
            setJuelMood("listen");
            go("hearing");
          }
          window.clearTimeout(endTimer.current);
          endTimer.current = window.setTimeout(() => {
            if (phaseRef.current !== "hearing") return;
            const said = transcript.current;
            // A fresh session for the next turn, so old words don't come back.
            try {
              rec.abort();
            } catch {}
            commit(said);
          }, turnPause(text, gaps.current));
        };
        // Recognition stops on its own now and then; keep it going while live.
        rec.onend = () => {
          if (live.current) window.setTimeout(() => live.current && (() => { try { rec.start(); } catch {} })(), 150);
        };
        rec.onerror = (event) => {
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            setProblem("Speech recognition is blocked in this browser. Allow the microphone, or type to Juel instead.");
            go("error");
          }
        };
        recognition.current = rec;
        try {
          rec.start();
        } catch {}
      } else if (typeof MediaRecorder !== "undefined") {
        // No speech recognition: each utterance is recorded and sent to the transcriber.
        const rec = new MediaRecorder(stream.current);
        rec.ondataavailable = (event) => event.data.size && chunks.current.push(event.data);
        rec.onstop = async () => {
          const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
          chunks.current = [];
          if (blob.size < 2000 || !live.current) return go("listening");
          go("thinking");
          setJuelMood("think");
          const response = await fetch("/api/automation/agents/chat/transcribe", { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob }).catch(() => null);
          const data = response?.ok ? await response.json().catch(() => ({})) : {};
          commit(String(data.text || ""));
        };
        recorder.current = rec;
      } else {
        setProblem("This browser can't listen. Type to Juel instead.");
        return go("error");
      }
      go("listening");
      setJuelMood("listen");
    })();
    return () => {
      live.current = false;
      cancelAnimationFrame(frame);
      window.clearTimeout(endTimer.current);
      try {
        recognition.current?.abort();
      } catch {}
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      stopSpeaking();
      void ctx.current?.close();
      ctx.current = null;
      setMouth(0);
      setJuelMood("idle");
    };
  }, [bargeIn, commit, stopSpeaking]);

  useEffect(() => {
    try {
      window.localStorage.setItem(VOICE_KEY, voice);
    } catch {}
  }, [voice]);

  const pose: JuelPose = phase === "speaking" ? "speak" : phase === "thinking" ? "think" : phase === "hearing" ? "listen" : phase === "error" ? "oops" : phase === "starting" ? "wave" : "idle";
  const status = {
    starting: "Getting the microphone ready",
    listening: muted ? "Your microphone is off" : "I'm listening. Say anything.",
    hearing: "Listening",
    thinking: "Thinking",
    speaking: "Speaking. Talk any time to interrupt.",
    error: problem || "Live mode stopped.",
  }[phase];

  return (
    <div className="juel-live" data-phase={phase}>
      <div className="juel-live-stage">
        <JuelMascot pose={pose} size={200} followPointer={phase === "listening"} title="Juel" />
        {phase === "hearing" || phase === "listening" ? <span className="juel-live-ring" aria-hidden="true" /> : null}
      </div>
      <p className="juel-live-status" role="status" aria-live="polite">
        {status}
      </p>
      <div className="juel-live-captions" aria-live="polite">
        {heard ? <p className="is-you">{heard}</p> : null}
        {saying ? <p className="is-juel">{saying}</p> : null}
      </div>
      {problem && phase !== "error" ? <p className="juel-live-note">{problem}</p> : null}
      <div className="juel-live-controls">
        <label className="juel-live-voice">
          <span>Voice</span>
          <select value={voice} onChange={(event) => setVoice(event.target.value)}>
            {VOICES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={`juel-live-mic${muted ? " is-off" : ""}`} onClick={() => setMuted((m) => !m)} aria-pressed={muted} aria-label={muted ? "Turn the microphone on" : "Mute the microphone"} title={muted ? "Unmute" : "Mute"}>
          {muted ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
        <button type="button" className="juel-live-end" onClick={onEnd}>
          <PhoneOff size={16} />
          End live
        </button>
      </div>
    </div>
  );
}
