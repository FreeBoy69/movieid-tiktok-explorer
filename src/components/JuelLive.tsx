// Live mode: talk with Juel out loud. The loop follows RealtimeVoiceChat (github.com/KoljaB/RealtimeVoiceChat),
// done in the browser: your words stream in as you speak (the browser's speech recognition, or recorded
// utterances sent to the transcriber where it has none), a pause that adapts to how you talk ends your turn,
// Juel's reply is spoken sentence by sentence while it is still being written (each next sentence fetched
// while the current one plays), his mouth follows the voice's loudness, and talking over him stops him.
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Mic, MicOff, PhoneOff, Square } from "lucide-react";
import { holdReload } from "../utils/lazyPage";
import { micRecorder } from "../utils/micTape";
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
  // Not on Android: its recogniser beeps every time it starts and stops, which live mode does around every
  // reply (and whenever it times out). There the recording goes to /api/juel/hear instead, as on phones
  // whose recogniser hears nothing.
  if (/Android/i.test(navigator.userAgent)) return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
};

/** Juel's streamed voice player, on the audio thread (after KoljaB/RealtimeVoiceChat's playback worklet):
 *  24 kHz PCM is queued as it arrives and resampled to the device rate in one continuous stream, so there
 *  are no joins to click at, and a busy page can't starve it. It waits for `lead` seconds before the first
 *  sound; when the stream runs dry it fades out, then waits for `refill` seconds before fading back in.
 *  Messages in: {start, id, lead, refill}, {pcm: ArrayBuffer}, {end}, {clear}. Out: {drained: id}. */
const PLAYER_WORKLET = `
const IN = 24000;
class JuelPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = []; this.at = 0; this.frac = 0; this.queued = 0;
    this.state = "idle"; this.gain = 0; this.need = 0; this.refill = 0; this.ended = false; this.id = 0;
    this.step = IN / sampleRate; this.ramp = 1 / (0.006 * sampleRate);
    this.port.onmessage = ({ data }) => {
      if (data.pcm) {
        const pcm = new Int16Array(data.pcm), f = new Float32Array(pcm.length);
        for (let i = 0; i < pcm.length; i++) f[i] = pcm[i] / 32768;
        this.chunks.push(f); this.queued += f.length;
      } else if (data.start) {
        this.id = data.id; this.ended = false; this.state = "buffering";
        this.need = data.lead * IN; this.refill = data.refill * IN;
      } else if (data.end) this.ended = true;
      else if (data.clear) { this.chunks = []; this.at = 0; this.frac = 0; this.queued = 0; this.state = "idle"; this.gain = 0; }
    };
  }
  read(k) {
    let c = 0, o = this.at + k;
    while (c < this.chunks.length && o >= this.chunks[c].length) { o -= this.chunks[c].length; c++; }
    return c < this.chunks.length ? this.chunks[c][o] : 0;
  }
  process(_, outputs) {
    const out = outputs[0][0];
    for (let i = 0; i < out.length; i++) {
      if (this.state === "buffering" && (this.queued >= this.need || (this.ended && this.queued > 0))) this.state = "playing";
      if (this.state !== "playing") { out[i] = 0; continue; }
      // Running dry mid-stream: fade over the last few ms instead of stopping on a click.
      const target = !this.ended && this.queued < 160 ? 0 : 1;
      this.gain += Math.max(-this.ramp, Math.min(this.ramp, target - this.gain));
      const a = this.read(0), b = this.read(1);
      out[i] = (a + (b - a) * this.frac) * this.gain;
      this.frac += this.step;
      while (this.frac >= 1 && this.queued > 0) {
        this.frac -= 1; this.at++; this.queued--;
        if (this.at >= this.chunks[0].length) { this.chunks.shift(); this.at = 0; }
      }
      if (this.queued <= 1) {
        if (this.ended) { this.chunks = []; this.at = 0; this.frac = 0; this.queued = 0; this.state = "idle"; this.gain = 0; this.port.postMessage({ drained: this.id }); }
        else if (this.gain <= 0) { this.state = "buffering"; this.need = this.refill; }
      } else if (target === 0 && this.gain <= 0) { this.state = "buffering"; this.need = this.queued + this.refill; }
    }
    return true;
  }
}
registerProcessor("juel-player", JuelPlayer);
`;

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

// Words a thought doesn't end on: joining words, articles, prepositions, fillers, and the start of a request.
const OPEN_ENDINGS = new Set("and or but so because if then than that which who whose where when while though although unless until the a an my your his her their our its this these those some any every to of for with without about from into onto in on at by as like um uh er erm hmm mean basically actually also just really very more most less please is are was were be been being am do does did can could would should will shall might must have has had want wanna gonna gotta need let make give get show tell put add use try".split(" "));
// Whole replies that are complete on their own.
const SHORT_REPLIES = /^(hi|hey|hello|yo|yes|yeah|yep|yup|no|nope|nah|ok|okay|sure|thanks|thank you|cool|great|perfect|nice|stop|wait|continue|go ahead|go on|do it|sounds good|got it|never mind|nevermind|bye|goodbye|that's it|that's all|exactly|right|correct|why|how|what)$/;

/** Whether what you've said so far sounds like a finished thought: "done" (a whole request, question or
 *  answer), "open" (stopped mid-sentence on "and", "the", "to", "um"...), or "unsure". */
export function thoughtState(transcript: string): "done" | "open" | "unsure" {
  const text = transcript.toLowerCase().replace(/[^\p{L}\p{N}' ?.!]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!text) return "open";
  const bare = text.replace(/[?.!]+$/, "").trim();
  if (SHORT_REPLIES.test(bare)) return "done";
  const words = bare.split(" ");
  if (OPEN_ENDINGS.has(words[words.length - 1])) return "open";
  if (/[?.!]$/.test(text) && words.length >= 2) return "done";
  if (words.length >= 4) return "done";
  return "unsure";
}

/** How long a silence ends your turn (RealtimeVoiceChat's dynamic pause): short after a finished thought,
 *  long when you stopped mid-sentence, a little shorter again once the recogniser has marked the phrase
 *  final (it heard you stop), and scaled to how quickly you talk. */
export function turnPause(transcript: string, gaps: number[], final = false): number {
  const sorted = [...gaps].sort((a, b) => a - b);
  const typical = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 400;
  // Slow, deliberate talkers get a little more room; quick ones a little less.
  const pace = Math.min(1.4, Math.max(0.8, typical / 400));
  const state = thoughtState(transcript);
  // Mid-sentence, people pause to think: that wait never shrinks for a quick talker.
  if (state === "open") return Math.round((final ? 1600 : 1800) * Math.max(1, pace));
  return Math.round((state === "done" ? (final ? 220 : 450) : final ? 450 : 800) * pace);
}

/** What a recording says. Gemini (/api/juel/hear) first; when it hasn't answered in 1.8 s a second
 *  identical request races it (its slow tail is several seconds), and the Whisper route is the backup.
 *  Credits running out (402) isn't retried. `ms` is how long the recording runs: the server drops words that
 *  can't fit in it (made up from noise). */
async function hearRecording(blob: Blob, ms: number): Promise<string> {
  const type = blob.type || "application/octet-stream";
  const controllers: AbortController[] = [];
  const once = () => {
    const controller = new AbortController();
    controllers.push(controller);
    return fetch("/api/juel/hear", { method: "POST", headers: { "Content-Type": type, "X-Recording-Ms": String(Math.round(ms)) }, body: blob, signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw Object.assign(new Error("hear"), { status: response.status });
      return String((await response.json().catch(() => ({}))).text || "");
    });
  };
  const first = once();
  const second = new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => once().then(resolve, reject), 1800);
    first.then(
      () => window.clearTimeout(timer),
      (error) => {
        window.clearTimeout(timer);
        if (error?.status === 402) reject(error);
        else once().then(resolve, reject);
      },
    );
  });
  try {
    return await Promise.any([first, second]);
  } catch (error) {
    if ((error as AggregateError)?.errors?.some((e: { status?: number }) => e?.status === 402)) return "";
  } finally {
    controllers.forEach((controller) => controller.abort());
  }
  const backup = await fetch("/api/automation/agents/chat/transcribe", { method: "POST", headers: { "Content-Type": type }, body: blob }).catch(() => null);
  return backup?.ok ? String((await backup.json().catch(() => ({}))).text || "") : "";
}

/** Bands in the live waveform (drawn mirrored, so twice as many bars). */
const WAVE_BANDS = 16;

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
  const [asked, setAsked] = useState("");
  // His last line stays up after he finishes, until you start talking.
  const [lastSaid, setLastSaid] = useState("");
  useEffect(() => {
    if (saying) setLastSaid(saying);
  }, [saying]);
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
  const wave = useRef<HTMLDivElement | null>(null);
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
    // A new recognizer session must start after playback, so results cannot include Juel's
    // previous sentence or append to a stale interim transcript.
    firstMine.current = 0;
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
  // One player for the whole session (null where the browser has no AudioWorklet: the fallback below).
  const player = useRef<Promise<AudioWorkletNode | null> | null>(null);
  const sentenceId = useRef(0);
  const voicePlayer = () => {
    if (!player.current) {
      const context = audioContext();
      player.current = (async () => {
        if (!context.audioWorklet) return null;
        const url = URL.createObjectURL(new Blob([PLAYER_WORKLET], { type: "application/javascript" }));
        try {
          await context.audioWorklet.addModule(url);
          const node = new AudioWorkletNode(context, "juel-player", { numberOfInputs: 0, outputChannelCount: [1] });
          node.connect(outAnalyser.current!);
          return node;
        } catch {
          return null;
        } finally {
          URL.revokeObjectURL(url);
        }
      })();
    }
    return player.current;
  };
  // On the live view itself, not the whole page: a variable on <html> changed every frame makes a phone
  // restyle everything 60 times a second, and that jank starves the audio scheduling.
  const root = useRef<HTMLDivElement | null>(null);
  const setMouth = (value: number) => (root.current || document.documentElement).style.setProperty("--jm-mouth", value.toFixed(3));

  // Set while the server speaks with its slow backup voice (Gemini's out of quota): see enqueue.
  const slowVoice = useRef(false);
  const fetchVoice = useCallback(
    (text: string) =>
      voice === INSTANT
        ? Promise.resolve(null)
        : fetch("/api/juel/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice, stream: true }) })
        .then(async (response) => {
          slowVoice.current = response.headers.get("X-Juel-Voice") === "backup";
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
    if (timing.current.text && !timing.current.audio) timing.current.audio = performance.now();
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
        const t = timing.current;
        if (t.text && t.reply && t.audio) {
          const s = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
          setLastTiming(`Heard ${s(t.text - t.end)} (${t.path}) · answer ${s(t.reply - t.text)} · voice ${s(t.audio - t.reply)}`);
        }
        setSaying("");
        setJuelMood("idle");
        freshEars();
        go("listening");
      }
    };
    // Streamed HD voice: raw PCM played as it arrives.
    const streamed = response && /^audio\/l16/i.test(response.headers.get("Content-Type") || "") && response.body;
    const node = streamed ? await voicePlayer() : null;
    if (gen !== generation.current) {
      busy.current = false;
      void response?.body?.cancel().catch(() => undefined);
      return;
    }
    if (node && response?.body) {
      void audioContext().resume();
      const reader = response.body.getReader();
      const id = ++sentenceId.current;
      let stopped = false;
      let samples = 0;
      let carry: Uint8Array | null = null;
      node.port.onmessage = (event) => {
        if (event.data?.drained === id) done();
      };
      // Phone networks deliver the stream in bursts: 250 ms in hand before the first sound, 150 ms after
      // running dry (see PLAYER_WORKLET).
      node.port.postMessage({ start: true, id, lead: 0.25, refill: 0.15 });
      playing.current = {
        pause: () => {
          stopped = true;
          void reader.cancel().catch(() => undefined);
          node.port.postMessage({ clear: true });
        },
      } as unknown as HTMLAudioElement;
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
          const pcm = bytes.slice().buffer;
          samples += bytes.length / 2;
          node.port.postMessage({ pcm }, [pcm]);
        }
      } catch {}
      if (stopped || gen !== generation.current) return;
      node.port.postMessage({ end: true });
      // In case the player never reports back: at most the whole sentence is still to play.
      window.setTimeout(done, (samples / 24000) * 1000 + 1500);
      return;
    }
    // Without AudioWorklet: the same buffering, scheduled as buffer sources.
    if (streamed && response?.body) {
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
      // A jitter buffer: phone networks deliver the stream in bursts, and playing each piece the moment it
      // lands leaves gaps (stutter) whenever the next one is late. Hold LEAD seconds before the first
      // sound, play in pieces of at least STEP, and when the stream runs dry wait for REFILL before going on.
      const RATE = 24000;
      const LEAD = 0.25;
      const STEP = 0.1;
      const REFILL = 0.15;
      let pending: Int16Array[] = [];
      let pendingLength = 0;
      let started = false;
      const schedule = (final: boolean) => {
        if (!pendingLength) return;
        const dry = !started || at < context.currentTime + 0.02;
        const need = (!started ? LEAD : dry ? REFILL : STEP) * RATE;
        if (!final && pendingLength < need) return;
        const buffer = context.createBuffer(1, pendingLength, RATE);
        const channel = buffer.getChannelData(0);
        let offset = 0;
        for (const piece of pending) {
          for (let i = 0; i < piece.length; i++) channel[offset + i] = piece[i] / 32768;
          offset += piece.length;
        }
        pending = [];
        pendingLength = 0;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(outAnalyser.current!);
        at = Math.max(at, context.currentTime + (dry ? 0.05 : 0.01));
        source.start(at);
        at += buffer.duration;
        sources.push(source);
        last = source;
        started = true;
      };
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
          // Copied out: the stream may reuse its buffer for the next read.
          pending.push(new Int16Array(bytes.slice().buffer));
          pendingLength += bytes.length / 2;
          schedule(false);
        }
        if (!stopped) schedule(true);
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

  // Sentences held back while the voice is the slow backup (see `slowVoice`), and when they go anyway.
  const held = useRef("");
  const heldTimer = useRef(0);
  const enqueue = useCallback(
    (sentences: string[], final = false) => {
      const speak = (text: string) => {
        // Fetched now, played in order: the next one is ready when the current one ends.
        queue.current.push({ text, audio: fetchVoice(text) });
        void playNext();
      };
      for (const text of sentences) {
        if (spokenTotal.current >= MAX_SPOKEN) break;
        spokenTotal.current += text.length;
        const said = spokenTotal.current >= MAX_SPOKEN ? `${text} I've put the rest in the chat.` : text;
        if (slowVoice.current) held.current = `${held.current} ${said}`.trim();
        else speak(said);
      }
      if (!held.current) return;
      // The backup voice takes ~4 s to start each request, so a reply sent sentence by sentence stops
      // between every one: it goes as one request when the reply ends (or after 0.9 s, or when it's long).
      const flush = () => {
        window.clearTimeout(heldTimer.current);
        heldTimer.current = 0;
        const text = held.current;
        held.current = "";
        if (text) speak(text);
      };
      if (final || held.current.length > 450) flush();
      else if (!heldTimer.current) heldTimer.current = window.setTimeout(flush, 900);
    },
    [fetchVoice, playNext],
  );

  const stopSpeaking = useCallback(() => {
    generation.current += 1;
    busy.current = false;
    stoppedAt.current = performance.now();
    queue.current = [];
    held.current = "";
    window.clearTimeout(heldTimer.current);
    heldTimer.current = 0;
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
    if (reply && timing.current.text && !timing.current.reply) timing.current.reply = performance.now();
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
      enqueue([`Sorry. ${why}`], true);
      return;
    }
    setProblem("");
    const { sentences } = nextSentences(text, Math.min(spokenUpTo.current, text.length), true);
    spokenUpTo.current = 0;
    if (sentences.length || held.current) enqueue(sentences, true);
    else if (!busy.current && !playing.current && !queue.current.length) go("listening");
  }, [sending, finished, lastReply, enqueue]);

  // ---------- Audio in: speech recognition, a voice-activity meter, and turn-taking ----------
  const stream = useRef<MediaStream | null>(null);
  const transcript = useRef("");
  const gaps = useRef<number[]>([]);
  const lastWord = useRef(0);
  const endTimer = useRef(0);
  // When the microphone last heard sound above the noise floor.
  const voiceAt = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  // Every utterance is also recorded. If the browser's recogniser produced no words for it (a network or
  // language problem it doesn't report), the recording goes to the transcriber instead, so Juel still
  // answers. When the recogniser did its job the recording is thrown away.
  const discard = useRef(false);
  const live = useRef(true);

  // Set while a recording is being transcribed: that turn's words are on their way.
  const transcribing = useRef(false);
  // A turn's recording is sent the moment you pause (300 ms), while the turn-end pause is still running:
  // when you stay quiet, that answer is the turn's words and arrives ~0.45 s sooner; talking again drops it.
  const early = useRef<{ promise: Promise<string>; turn: number } | null>(null);
  const turnId = useRef(0);
  const recordedAt = useRef(0);
  const flushWait = useRef<((blob: Blob) => void) | null>(null);
  // Where each turn's time went, shown under the controls once he has answered.
  const timing = useRef({ end: 0, text: 0, reply: 0, audio: 0, path: "" });
  const [lastTiming, setLastTiming] = useState("");
  const commit = useCallback((text: string, fromRecording = false) => {
    // One turn per thing you said: a second report of the same words (the recogniser and the recording
    // both finishing) is dropped.
    if (fromRecording ? !transcribing.current : phaseRef.current !== "listening" && phaseRef.current !== "hearing") return;
    transcribing.current = false;
    const said = text.trim();
    timing.current = { end: voiceAt.current || performance.now(), text: performance.now(), reply: 0, audio: 0, path: fromRecording ? "transcribed" : "your phone's recogniser" };
    early.current = null;
    transcript.current = "";
    gaps.current = [];
    setHeard("");
    if (!said) return go("listening");
    setAsked(said);
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
    // A page Juel opens may be from before a deploy: the app would reload itself for the new files, which
    // ends the call mid-sentence. That waits until the call ends.
    const releaseReload = holdReload();
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
        // iOS 17+: keep voice playing through the speaker while the microphone is open.
        const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
        if (session) session.type = "play-and-record";
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
      const micSource = context.createMediaStreamSource(stream.current);
      micSource.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      const outBuffer = new Float32Array(512);
      // The waveform: 16 voice bands (120 Hz to 4.5 kHz, log-spaced), mirrored so the low voice sits in
      // the middle. Your mic while you talk, his voice while he speaks.
      const micFreq = new Uint8Array(analyser.frequencyBinCount);
      const outFreq = new Uint8Array(outAnalyser.current?.frequencyBinCount || 256);
      const bandsOf = (node: AnalyserNode) => Array.from({ length: WAVE_BANDS + 1 }, (_, i) => Math.max(1, Math.round((120 * Math.pow(4500 / 120, i / WAVE_BANDS)) / (context.sampleRate / node.fftSize))));
      const micEdges = bandsOf(analyser);
      const outEdges = outAnalyser.current ? bandsOf(outAnalyser.current) : micEdges;
      const bars = wave.current ? Array.from(wave.current.children) as HTMLElement[] : [];
      const drawWave = (data: Uint8Array, edges: number[], gain: number) => {
        for (let band = 0; band < WAVE_BANDS; band++) {
          let peak = 0;
          for (let bin = edges[band]; bin < Math.max(edges[band] + 1, edges[band + 1]); bin++) peak = Math.max(peak, data[bin] || 0);
          const height = (0.08 + 0.92 * Math.pow(Math.min(1, (peak / 255) * gain), 1.6)).toFixed(3);
          const left = bars[WAVE_BANDS - 1 - band];
          const right = bars[WAVE_BANDS + band];
          if (left) left.style.transform = `scaleY(${height})`;
          if (right) right.style.transform = `scaleY(${height})`;
        }
      };
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
          voiceAt.current = now;
          loudSince ||= now;
          quietSince = 0;
          // Still talking: the recording sent at your last pause is out of date.
          if (speaking && early.current) early.current = null;
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
              turnId.current += 1;
              early.current = null;
              recorder.current.start();
              // The tape's recording starts with the moment before you spoke.
              recordedAt.current = performance.now() - ((recorder.current as { prerollMs?: number }).prerollMs || 0);
            }
          }
        } else {
          loudSince = 0;
          quietSince ||= now;
          // A pause ends the recorded utterance. With the recogniser working it is thrown away (its own
          // timer ends the turn); with no words from it, the recording is transcribed.
          // With words from the recogniser, its own thought-aware timer decides; without any (a phone whose
          // recogniser hears nothing, or none at all) a short silence sends the recording to be transcribed.
          const silence = transcript.current ? Math.max(700, turnPause(transcript.current, gaps.current, true)) : 750;
          // No words from the recogniser (a phone): send what you've said so far now, while the pause runs.
          // The whole recording so far is one playable file, so nothing is cut out of it.
          if (speaking && !early.current && !transcript.current && now - quietSince > 300 && recorder.current?.state === "recording") {
            const turn = turnId.current;
            const recording = recorder.current;
            early.current = {
              turn,
              promise: new Promise<Blob>((resolve) => {
                flushWait.current = resolve;
                try {
                  recording.requestData();
                } catch {
                  resolve(new Blob());
                }
              }).then((blob) => (blob.size < 2000 ? "" : hearRecording(blob, performance.now() - recordedAt.current))),
            };
          }
          if (speaking && now - quietSince > silence) {
            speaking = false;
            if (recorder.current?.state === "recording") {
              discard.current = Boolean(SR && transcript.current);
              recorder.current.stop();
            }
          }
        }
        stage.current?.style.setProperty("--live-level", Math.min(1, rms * 18).toFixed(3));
        if (bars.length) {
          if (outAnalyser.current && playing.current) {
            outAnalyser.current.getByteFrequencyData(outFreq);
            drawWave(outFreq, outEdges, 1.05);
          } else if (!mutedRef.current) {
            analyser.getByteFrequencyData(micFreq);
            drawWave(micFreq, micEdges, 1.15);
          } else drawWave(new Uint8Array(1), micEdges, 0);
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
          let p = phaseRef.current;
          // A recording already on its way to the transcriber is this turn: late words from the recogniser
          // would only send it twice.
          if (mutedRef.current || earsOff.current || transcribing.current) return;
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
            // Even "hi" or "stop" is a complete interruption; waiting for two words made
            // short interjections feel like the mic was ignored.
            if (!wordsOf(latest).length) return;
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
          const final = Boolean(event.results[event.results.length - 1]?.isFinal);
          window.clearTimeout(endTimer.current);
          const end = () => {
            if (phaseRef.current !== "hearing") return;
            // Still making sound (a word the recogniser hasn't reported yet): give it a moment longer.
            if (performance.now() - voiceAt.current < 160) {
              endTimer.current = window.setTimeout(end, 160);
              return;
            }
            const said = transcript.current;
            // A fresh session for the next turn, so old words don't come back.
            try {
              rec.abort();
            } catch {}
            commit(said);
          };
          endTimer.current = window.setTimeout(end, turnPause(text, gaps.current, final));
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
      // The tape where the browser has AudioWorklet (see micTape), MediaRecorder elsewhere.
      const tape = await micRecorder(context, micSource);
      if (!live.current) return;
      if (tape || typeof MediaRecorder !== "undefined") {
        const rec = tape || new MediaRecorder(stream.current);
        rec.ondataavailable = (event) => {
          // The tape hands over the whole recording each time; MediaRecorder hands over the next piece.
          if (event.data.size) chunks.current = tape ? [event.data] : [...chunks.current, event.data];
          const waiting = flushWait.current;
          if (waiting) {
            flushWait.current = null;
            waiting(new Blob(chunks.current, { type: rec.mimeType || "audio/webm" }));
          }
        };
        rec.onstop = async () => {
          const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
          chunks.current = [];
          // The answer for this turn's recording, when it was already sent at your last pause.
          const sent = early.current && early.current.turn === turnId.current ? early.current.promise : null;
          early.current = null;
          if (discard.current || !live.current) return;
          if (blob.size < 2000) {
            if (phaseRef.current === "hearing") go("listening");
            return;
          }
          if (phaseRef.current !== "hearing" && phaseRef.current !== "listening") return;
          transcribing.current = true;
          go("thinking");
          setJuelMood("think");
          const turn = turnId.current;
          const text = (await sent) || (await hearRecording(blob, performance.now() - recordedAt.current));
          // Stopped, ended, or a newer turn while it was heard: these words belong to nothing now.
          if (!live.current || turn !== turnId.current || !transcribing.current) return;
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
      releaseReload();
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
  // The big line under Juel is the conversation as it happens: your words as you say them, then his
  // reply as he speaks it (which stays up until you talk again). Before the first turn, his prompt.
  const caption =
    phase === "speaking" ? saying || lastSaid
    : phase === "hearing" ? heard
    : phase === "thinking" ? asked
    : phase === "error" ? problem || "Live mode stopped."
    : phase === "starting" ? "One moment, getting the mic ready."
    : lastSaid || (muted ? "Your mic is off." : "What are we making today?");
  const who = phase === "hearing" || phase === "thinking" ? "you" : phase === "speaking" || (phase === "listening" && lastSaid) ? "juel" : "prompt";
  // The card's line: what's happening, or a problem worth knowing about.
  const hint =
    problem && phase !== "error" ? problem
    : { starting: "Starting live mode", listening: muted ? "Unmute to talk" : "Say anything", hearing: "Listening", thinking: "Thinking", speaking: "Tap Juel to cut in", error: "Try again, or type to Juel instead" }[phase];

  return (
    <div className="juel-live" data-phase={phase} ref={root}>
      <div className="juel-live-stage" ref={stage} onClick={phase === "speaking" ? () => bargeIn() : undefined}>
        <div className="juel-live-aura" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <JuelMascot pose={pose} size={184} followPointer={phase === "listening"} title="Juel" />
      </div>
      <div className="juel-live-wave" ref={wave} data-who={phase === "speaking" ? "juel" : "you"} aria-hidden="true">
        {Array.from({ length: WAVE_BANDS * 2 }, (_, i) => <i key={i} />)}
      </div>
      <p key={`${who}:${caption}`} className="juel-live-caption" data-who={who} aria-live="polite">
        {caption.charAt(0).toUpperCase() + caption.slice(1)}
      </p>
      <div className="juel-live-dock">
        <p className={`juel-live-hint${problem ? " is-problem" : ""}`} role="status" aria-live="polite">
          {hint}
        </p>
        {lastTiming ? <p className="juel-live-timing">{lastTiming}</p> : null}
        <div className="juel-live-row">
          <label className="juel-live-voice" title="Juel's voice">
            <AudioLines size={13} aria-hidden="true" />
            <select value={voice} onChange={(event) => setVoice(event.target.value)} aria-label="Juel's voice">
              {VOICES.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={`juel-live-chip juel-live-mic${muted ? " is-off" : ""}`} onClick={() => setMuted((m) => !m)} aria-pressed={muted} aria-label={muted ? "Turn the microphone on" : "Mute the microphone"} title={muted ? "Unmute" : "Mute"}>
            {muted ? <MicOff size={15} /> : <Mic size={15} />}
          </button>
          {phase === "speaking" ? (
            <button type="button" className="juel-live-chip juel-live-stop" onClick={() => bargeIn()}>
              <Square size={11} />
              Stop
            </button>
          ) : null}
          <button type="button" className="juel-live-end" onClick={onEnd} aria-label="End live mode" title="End live mode">
            <PhoneOff size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
