// Live mode: talk with Juel out loud. The loop follows RealtimeVoiceChat (github.com/KoljaB/RealtimeVoiceChat),
// done in the browser: your words stream in as you speak (the browser's speech recognition, or recorded
// utterances sent to the transcriber where it has none), a pause that adapts to how you talk ends your turn,
// Juel's reply is spoken sentence by sentence while it is still being written (each next sentence fetched
// while the current one plays), his mouth follows the voice's loudness, and talking over him stops him.
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Square } from "lucide-react";
import { JuelMascot, type JuelPose, setJuelMood } from "./JuelMascot";

type Phase = "starting" | "listening" | "hearing" | "thinking" | "speaking" | "error";
// The HD voices stream from Gemini and start in under a second. "Basic" is the browser's own voice:
// immediate and free, and what he falls back to when an HD voice can't start.
const INSTANT = "instant";
const HD = "Puck";
const VOICES: Array<[string, string]> = [
  ["Puck", "Upbeat"],
  ["Zephyr", "Bright"],
  ["Achird", "Friendly"],
  ["Kore", "Calm"],
  [INSTANT, "Basic (browser)"],
];
/** A pleasant built-in voice for the page's language, when the browser has one. */
function browserVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const lang = (navigator.language || "en-US").slice(0, 2);
  const fit = voices.filter((v) => v.lang?.toLowerCase().startsWith(lang));
  const pick = (test: RegExp) => fit.find((v) => test.test(v.name));
  return pick(/natural|neural|premium|enhanced/i) || pick(/google/i) || pick(/samantha|ava|allison|karen|daniel/i) || fit[0] || null;
}
// ":2": the old default ("instant", from when HD was slow) isn't carried over.
const VOICE_KEY = "juel:voice:2";
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
const wordsOf = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);

/** Whether words the microphone picked up are Juel's own voice coming back (the browser's voice isn't
 *  removed by echo cancellation): mostly words he just said. */
export function isEcho(heard: string, said: Set<string>): boolean {
  const words = wordsOf(heard);
  if (!words.length) return true;
  if (!said.size) return false;
  return words.filter((w) => said.has(w)).length / words.length >= 0.6;
}

/** Where to carry on speaking when the reply's text changes: after what was already said when the new text
 *  still begins with it (or is all already said), else from the start (it's a different answer). */
export function resumeAt(before: string, spokenUpTo: number, text: string): number {
  const said = before.slice(0, spokenUpTo);
  if (text.startsWith(said)) return spokenUpTo;
  if (said.startsWith(text)) return text.length;
  const a = wordsOf(said);
  const b = wordsOf(text);
  if (a.length && a.every((w, i) => b[i] === w)) return Math.min(spokenUpTo, text.length);
  return 0;
}

export function turnPause(transcript: string, gaps: number[]): number {
  const sorted = [...gaps].sort((a, b) => a - b);
  const typical = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 450;
  let pause = Math.min(1200, Math.max(550, typical * 1.8));
  const words = transcript.trim().split(/\s+/).filter(Boolean).length;
  if (/[.!?]$/.test(transcript.trim())) pause *= 0.7;
  if (words <= 2) pause += 250;
  return Math.round(pause);
}

export function JuelLive({
  reply,
  sending,
  lastReply,
  ask,
  interrupt,
  onEnd,
  error = "",
  finished = false,
}: {
  /** The reply as it streams (null when no turn is running). */
  reply: string | null;
  sending: boolean;
  /** The finished reply of the last turn. */
  lastReply: string;
  ask: (text: string) => void;
  interrupt: () => void;
  onEnd: () => void;
  /** Why the last turn failed, if it did (the panel's error). */
  error?: string;
  /** The answer is final (the server is still saving): speak the rest now. */
  finished?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [heard, setHeard] = useState("");
  const [saying, setSaying] = useState("");
  const [muted, setMuted] = useState(false);
  const [problem, setProblem] = useState("");
  const [voice, setVoice] = useState(() => {
    try {
      const kept = window.localStorage.getItem(VOICE_KEY) || HD;
      return VOICES.some(([id]) => id === kept) ? kept : HD;
    } catch {
      return HD;
    }
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  // The panel's callbacks change on every render; live mode reads them through refs so its microphone,
  // recogniser and audio are set up once, not torn down each time the panel updates.
  const askRef = useRef(ask);
  askRef.current = ask;
  const interruptRef = useRef(interrupt);
  interruptRef.current = interrupt;
  const errorRef = useRef(error);
  errorRef.current = error;
  const lastReplyRef = useRef(lastReply);
  lastReplyRef.current = lastReply;
  // The reply the thread ended on before this turn: never spoken again as this turn's answer.
  const replyBefore = useRef("");
  const stage = useRef<HTMLDivElement | null>(null);
  const phaseRef = useRef<Phase>("starting");
  const recognition = useRef<Recognition | null>(null);
  // The recogniser keeps everything it heard since it started (Juel's own voice included): a clean
  // session starts whenever the floor goes back to you. It restarts itself (see onend).
  // The first result of the recogniser's session that is yours (earlier ones were his voice coming back).
  const firstMine = useRef(0);
  const freshEars = () => {
    firstMine.current = 0;
    try {
      recognition.current?.abort();
    } catch {}
  };
  // While Juel speaks the microphone is off (its track muted, the recogniser stopped), so his own voice
  // never comes back as yours. It opens again a moment after he finishes, once the speakers are quiet.
  const earsOff = useRef(false);
  const reopen = useRef(0);
  const micTracks = (on: boolean) => stream.current?.getAudioTracks().forEach((track) => (track.enabled = on));
  const closeEars = () => {
    window.clearTimeout(reopen.current);
    if (earsOff.current) return;
    earsOff.current = true;
    micTracks(false);
    window.clearTimeout(endTimer.current);
    transcript.current = "";
    if (recorder.current?.state === "recording") {
      discard.current = true;
      recorder.current.stop();
    }
    try {
      recognition.current?.abort();
    } catch {}
  };
  const openEars = (delay: number) => {
    window.clearTimeout(reopen.current);
    reopen.current = window.setTimeout(() => {
      if (!earsOff.current || !live.current) return;
      earsOff.current = false;
      firstMine.current = 0;
      micTracks(true);
      try {
        recognition.current?.start();
      } catch {}
    }, delay);
  };
  const go = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
    if (next === "speaking") closeEars();
    else if (earsOff.current && next !== "error") openEars(next === "hearing" ? 0 : 450);
  };
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  // ---------- Audio out: a queue of spoken sentences, mouth from the playing voice ----------
  const ctx = useRef<AudioContext | null>(null);
  const outAnalyser = useRef<AnalyserNode | null>(null);
  const queue = useRef<Array<{ text: string; audio: Promise<Response | null> }>>([]);
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
      voice === INSTANT
        ? Promise.resolve(null)
        : fetch("/api/juel/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice, stream: true }) })
        .then(async (response) => {
          if (response.ok) return response;
          const data = await response.json().catch(() => ({}));
          if (response.status === 402) setProblem(data.error || "You're out of credits for Juel's voice.");
          return null;
        })
        .catch(() => null),
    [voice],
  );

  // One sentence at a time: held from the moment a sentence is taken, while its voice may still be loading.
  const busy = useRef(false);
  // Words Juel said this turn, and when he stopped: what the microphone hears of them is ignored.
  const saidWords = useRef<Set<string>>(new Set());
  const stoppedAt = useRef(0);
  const playNext = useCallback(async () => {
    if (busy.current || playing.current || !queue.current.length) return;
    busy.current = true;
    const item = queue.current.shift()!;
    const gen = generation.current;
    for (const w of wordsOf(item.text)) saidWords.current.add(w);
    setSaying(item.text);
    go("speaking");
    setJuelMood("speak");
    const response = await item.audio;
    if (gen !== generation.current) {
      busy.current = false;
      void response?.body?.cancel().catch(() => undefined);
      return;
    }
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      playing.current = null;
      busy.current = false;
      stoppedAt.current = performance.now();
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
    // Streamed HD voice: raw PCM played chunk by chunk as it arrives, each piece queued right after the last.
    if (response && /^audio\/l16/i.test(response.headers.get("Content-Type") || "") && response.body) {
      const context = audioContext();
      void context.resume();
      const reader = response.body.getReader();
      const sources: AudioBufferSourceNode[] = [];
      let stopped = false;
      let at = 0;
      let carry: Uint8Array | null = null;
      playing.current = {
        pause: () => {
          stopped = true;
          void reader.cancel().catch(() => undefined);
          for (const source of sources) {
            try {
              source.stop();
            } catch {}
          }
        },
      } as unknown as HTMLAudioElement;
      let last: AudioBufferSourceNode | null = null;
      try {
        for (;;) {
          const { value, done: ended } = await reader.read();
          if (ended || stopped) break;
          let bytes = value;
          if (carry) {
            bytes = new Uint8Array(carry.length + value.length);
            bytes.set(carry);
            bytes.set(value, carry.length);
            carry = null;
          }
          if (bytes.length % 2) {
            carry = bytes.slice(-1);
            bytes = bytes.slice(0, -1);
          }
          if (!bytes.length) continue;
          const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
          const buffer = context.createBuffer(1, samples.length, 24000);
          const channel = buffer.getChannelData(0);
          for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(outAnalyser.current!);
          at = Math.max(at, context.currentTime + 0.03);
          source.start(at);
          at += buffer.duration;
          sources.push(source);
          last = source;
        }
      } catch {}
      if (stopped || gen !== generation.current) return;
      // Done when the last piece ends (or already has, if the stream ran slower than the speech).
      if (last) last.onended = done;
      window.setTimeout(done, Math.max(0, at - context.currentTime) * 1000 + 250);
      return;
    }
    const blob = response ? await response.blob().catch(() => null) : null;
    if (gen !== generation.current) {
      busy.current = false;
      return;
    }
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
    // The browser's own voice (the instant choice, or when an HD voice failed): the mouth opens on each
    // word as it is spoken and closes between words.
    if ("speechSynthesis" in window) {
      // A stuck earlier utterance blocks new ones in Chrome: clear it first.
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume?.();
      const utterance = new SpeechSynthesisUtterance(item.text);
      utterance.voice = browserVoice();
      utterance.rate = 1.04;
      utterance.pitch = 1.18;
      let open = 0;
      let wordAt = performance.now();
      utterance.onboundary = () => {
        wordAt = performance.now();
      };
      const timer = window.setInterval(() => {
        // Open on each word, then a quick flutter that settles while the word lasts.
        const since = performance.now() - wordAt;
        open = since < 90 ? 0.95 : Math.max(0.12, open * 0.78 + (Math.random() < 0.3 ? 0.35 : 0));
        setMouth(open);
      }, 45);
      playing.current = { pause: () => window.speechSynthesis.cancel() } as unknown as HTMLAudioElement;
      // Some browsers never report the end: move on after the sentence's likely length.
      let ended = false;
      const finish = () => {
        if (ended) return;
        ended = true;
        window.clearInterval(timer);
        window.clearTimeout(guard);
        done();
      };
      const guard = window.setTimeout(finish, 2500 + item.text.split(/\s+/).length * 480);
      utterance.onend = utterance.onerror = finish;
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
    busy.current = false;
    stoppedAt.current = performance.now();
    queue.current = [];
    playing.current?.pause();
    playing.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setMouth(0);
    setSaying("");
  }, []);

  // The reply streams in: speak each finished sentence; the rest when the turn ends.
  const lastSeen = useRef("");
  // Set when you cut him off: nothing more of that turn's answer is spoken, however late it arrives.
  const cutOff = useRef(false);
  useEffect(() => {
    if (reply === null || cutOff.current) return;
    turnDone.current = false;
    const text = speakable(reply);
    spokenUpTo.current = resumeAt(lastSeen.current, spokenUpTo.current, text);
    const { sentences, next } = nextSentences(text, spokenUpTo.current, false);
    spokenUpTo.current = next;
    if (sentences.length) enqueue(sentences);
    lastSeen.current = text;
  }, [reply, enqueue]);
  useEffect(() => {
    if (sending && !finished) {
      if (phaseRef.current !== "speaking") go("thinking");
      return;
    }
    if (turnDone.current || cutOff.current) return;
    turnDone.current = true;
    const streamed = lastSeen.current;
    lastSeen.current = "";
    // The finished reply, unless it's still the previous turn's (the turn failed before answering).
    const final = lastReply && lastReply !== replyBefore.current ? speakable(lastReply) : "";
    const text = final || streamed;
    if (!text) {
      // No answer came: say why instead of going quiet.
      const why = errorRef.current || "I couldn't get an answer just now. Try saying it again.";
      setProblem(why);
      spokenUpTo.current = 0;
      enqueue([`Sorry. ${why}`]);
      return;
    }
    setProblem("");
    const { sentences } = nextSentences(text, Math.min(spokenUpTo.current, text.length), true);
    spokenUpTo.current = 0;
    if (sentences.length) enqueue(sentences);
    else if (!playing.current && !queue.current.length) go("listening");
  }, [sending, finished, lastReply, enqueue]);

  // ---------- Audio in: speech recognition, a voice-activity meter, and turn-taking ----------
  const stream = useRef<MediaStream | null>(null);
  const transcript = useRef("");
  const gaps = useRef<number[]>([]);
  const lastWord = useRef(0);
  const endTimer = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  // Every utterance is also recorded. If the browser's recogniser produced no words for it (a network or
  // language problem it doesn't report), the recording goes to the transcriber instead, so Juel still
  // answers. When the recogniser did its job the recording is thrown away.
  const discard = useRef(false);
  const live = useRef(true);

  // Set while a recording is being transcribed: that turn's words are on their way.
  const transcribing = useRef(false);
  const commit = useCallback((text: string, fromRecording = false) => {
    // One turn per thing you said: a second report of the same words (the recogniser and the recording
    // both finishing) is dropped.
    if (fromRecording ? !transcribing.current : phaseRef.current !== "listening" && phaseRef.current !== "hearing") return;
    transcribing.current = false;
    const said = text.trim();
    transcript.current = "";
    gaps.current = [];
    setHeard("");
    if (!said) return go("listening");
    spokenUpTo.current = 0;
    spokenTotal.current = 0;
    turnDone.current = false;
    replyBefore.current = lastReplyRef.current;
    lastSeen.current = "";
    saidWords.current = new Set();
    cutOff.current = false;
    discard.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    go("thinking");
    askRef.current(said);
  }, []);

  // Talking over Juel stops him and gives you the floor.
  const bargeIn = useCallback((keepEars = false) => {
    if (phaseRef.current !== "speaking" && phaseRef.current !== "thinking") return;
    stopSpeaking();
    interruptRef.current();
    turnDone.current = true;
    cutOff.current = true;
    transcript.current = "";
    if (!keepEars) freshEars();
    setJuelMood("listen");
    // Cut off by your words: they're the start of your turn. By a tap: he waits for you.
    go(keepEars ? "hearing" : "listening");
  }, [stopSpeaking]);

  useEffect(() => {
    live.current = true;
    // Chrome fills its voice list after a moment: ask early so the first sentence gets the nice voice.
    window.speechSynthesis?.getVoices?.();
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
        // The browser's voice isn't removed by echo cancellation, so with it Juel needs a clearly louder
        // voice before he stops for you.
        const loudVoice = voiceRef.current === INSTANT ? 0.09 : 0.045;
        const threshold = Math.max(phaseNow === "speaking" ? loudVoice : 0.018, noise * (phaseNow === "speaking" ? (voiceRef.current === INSTANT ? 8 : 5) : 3));
        if (!mutedRef.current && rms > threshold) {
          loudSince ||= now;
          quietSince = 0;
          if (!speaking && now - loudSince > (phaseNow === "speaking" ? (voiceRef.current === INSTANT ? 450 : 280) : 120)) {
            speaking = true;
            // With a recogniser, interrupting waits for words that aren't his own (see onresult): loudness
            // alone can be his voice coming back through the speakers.
            if (phaseNow === "speaking" || phaseNow === "thinking") {
              if (!SR && voiceRef.current !== INSTANT) bargeIn();
            } else if (phaseNow === "listening" && now - stoppedAt.current > 700) {
              setJuelMood("listen");
              go("hearing");
            }
            if (recorder.current?.state === "inactive" && (phaseRef.current === "listening" || phaseRef.current === "hearing") && now - stoppedAt.current > 700) {
              chunks.current = [];
              discard.current = false;
              recorder.current.start();
            }
          }
        } else {
          loudSince = 0;
          quietSince ||= now;
          // A pause ends the recorded utterance. With the recogniser working it is thrown away (its own
          // timer ends the turn); with no words from it, the recording is transcribed.
          if (speaking && now - quietSince > Math.max(SR ? 1300 : 0, turnPause(transcript.current, gaps.current))) {
            speaking = false;
            if (recorder.current?.state === "recording") {
              discard.current = Boolean(SR && transcript.current);
              recorder.current.stop();
            }
          }
        }
        stage.current?.style.setProperty("--live-level", Math.min(1, rms * 18).toFixed(3));
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
          let p = phaseRef.current;
          if (mutedRef.current || earsOff.current) return;
          // What's new in this result: his own words coming back are ignored while he talks and just after.
          let latest = "";
          for (let i = event.resultIndex; i < event.results.length; i++) latest += ` ${event.results[i][0].transcript}`;
          const echoing = p === "speaking" || performance.now() - stoppedAt.current < 1500;
          if (echoing && isEcho(latest, saidWords.current)) {
            if (event.results[event.results.length - 1]?.isFinal) firstMine.current = event.results.length;
            return;
          }
          if (p === "speaking" || p === "thinking") {
            // Real words from you while he talks or thinks: he stops and listens, from those words on.
            if (wordsOf(latest).length < 2) return;
            firstMine.current = event.resultIndex;
            bargeIn(true);
            p = phaseRef.current;
          }
          if (p !== "listening" && p !== "hearing") return;
          let finalText = "";
          let interim = "";
          for (let i = firstMine.current; i < event.results.length; i++) {
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
          firstMine.current = 0;
          if (live.current && !earsOff.current) window.setTimeout(() => live.current && !earsOff.current && (() => { try { rec.start(); } catch {} })(), 150);
        };
        rec.onerror = (event) => {
          if (event.error === "language-not-supported") rec.lang = "en-US";
          if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            setProblem("Speech recognition is blocked in this browser. Allow the microphone, or type to Juel instead.");
            go("error");
          }
        };
        recognition.current = rec;
        try {
          rec.start();
        } catch {}
      }
      if (typeof MediaRecorder !== "undefined") {
        const rec = new MediaRecorder(stream.current);
        rec.ondataavailable = (event) => event.data.size && chunks.current.push(event.data);
        rec.onstop = async () => {
          const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
          chunks.current = [];
          if (discard.current || !live.current) return;
          if (blob.size < 2000) {
            if (phaseRef.current === "hearing") go("listening");
            return;
          }
          if (phaseRef.current !== "hearing" && phaseRef.current !== "listening") return;
          transcribing.current = true;
          go("thinking");
          setJuelMood("think");
          const response = await fetch("/api/automation/agents/chat/transcribe", { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob }).catch(() => null);
          const data = response?.ok ? await response.json().catch(() => ({})) : {};
          const text = String(data.text || "");
          // A recording that caught only his voice is no turn.
          if (isEcho(text, saidWords.current) && saidWords.current.size) {
            transcribing.current = false;
            return go("listening");
          }
          commit(text, true);
        };
        recorder.current = rec;
      } else if (!SR) {
        setProblem("This browser can't listen. Type to Juel instead.");
        return go("error");
      }
      go("listening");
      setJuelMood("listen");
    })();
    return () => {
      live.current = false;
      window.clearTimeout(reopen.current);
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
    speaking: "Your mic is off while I talk. Tap me to cut in.",
    error: problem || "Live mode stopped.",
  }[phase];

  return (
    <div className="juel-live" data-phase={phase}>
      <div className="juel-live-stage" ref={stage} onClick={phase === "speaking" ? () => bargeIn() : undefined}>
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
        {phase === "speaking" ? (
          <button type="button" className="juel-live-stop" onClick={() => bargeIn()}>
            <Square size={14} />
            Stop
          </button>
        ) : null}
        <button type="button" className="juel-live-end" onClick={onEnd}>
          <PhoneOff size={16} />
          End live
        </button>
      </div>
    </div>
  );
}
