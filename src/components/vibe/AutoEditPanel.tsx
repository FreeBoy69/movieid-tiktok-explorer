// Auto edit: one press runs the talking-head edit a human editor would do
// first (cut the dead air, ums, and retakes; clean the sound; lift the color;
// punch in on the jump cuts; caption; b-roll; music) as a visible checklist
// that can stop after any step. Each step is also a one-click action.
import { useRef, useState, type ReactNode } from "react";
import { AudioLines, Captions, Check, Clapperboard, Loader2, Minus, Music2, Palette, Scissors, Undo2, Wand2, X, ZoomIn } from "lucide-react";
import { toast } from "../../utils/toast";
import { setCaptionLook, type VibeProject } from "../../utils/vibeEdit";
import { addBroll, addMusic, cleanAudio, colorBoost, generateCaptions, punchIns, removePauses } from "./commands";
import { CAPTION_STYLES, loadCaptionFont } from "./overlay";
import { useVibe, vibe } from "./store";

type StepId = "cut" | "audio" | "color" | "punch" | "captions" | "broll" | "music";
type Status = "idle" | "waiting" | "running" | "done" | "skipped" | "failed";

const secs = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}m ${Math.round(n % 60)}s` : `${n.toFixed(1)}s`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const STEPS: { id: StepId; title: string; detail: string; icon: ReactNode; on: boolean; run: (mood: string) => Promise<string> | string }[] = [
  {
    id: "cut",
    title: "Cut pauses, ums, and retakes",
    detail: "Removes dead air, filler words, and abandoned first tries, then closes the gaps on every track.",
    icon: <Scissors size={16} />,
    on: true,
    run: async () => {
      const c = await removePauses();
      if (!c.ranges.length) return "Nothing to cut. The take is already tight.";
      return `Removed ${secs(c.seconds)}: ${plural(c.silences.length, "pause")}, ${plural(c.fillers.length, "filler word")}, ${plural(c.retakes.length, "retake")}`;
    },
  },
  {
    id: "audio",
    title: "Clean up the audio",
    detail: "Filters rumble and background hiss and evens the voice. Hiss removal is applied on export.",
    icon: <AudioLines size={16} />,
    on: true,
    run: () => {
      const n = cleanAudio(true);
      return n ? `Cleaned the sound of ${plural(n, "video")}` : "No clips with sound";
    },
  },
  {
    id: "color",
    title: "Color boost",
    detail: "A gentle contrast and saturation lift, like a first color pass.",
    icon: <Palette size={16} />,
    on: true,
    run: () => {
      const n = colorBoost(true);
      return n ? `Graded ${plural(n, "video")}` : "No video to grade";
    },
  },
  {
    id: "punch",
    title: "Punch in on jump cuts",
    detail: "Zooms in on every other piece of a cut take, so each cut reads as a new angle.",
    icon: <ZoomIn size={16} />,
    on: true,
    run: () => {
      const n = punchIns();
      return n ? `${plural(n, "punch-in")}` : "No jump cuts to punch in on";
    },
  },
  {
    id: "captions",
    title: "Captions",
    detail: "Word-timed captions from the speech, in the current caption style.",
    icon: <Captions size={16} />,
    on: true,
    run: async () => `${plural(await generateCaptions(), "caption line")}`,
  },
  {
    id: "broll",
    title: "B-roll",
    detail: "Stock footage over a few key lines, with the voice running under it.",
    icon: <Clapperboard size={16} />,
    on: false,
    run: async () => `${plural(await addBroll(4), "clip")} added`,
  },
  {
    id: "music",
    title: "Background music",
    detail: "A royalty-free bed, kept low under the voice.",
    icon: <Music2 size={16} />,
    on: false,
    run: async (mood) => addMusic(mood || "calm background", 0.12),
  },
];

const fail = (error: unknown) => toast.error((error as Error)?.message || "Something went wrong");

function StatusMark({ status, icon }: { status: Status; icon: ReactNode }) {
  if (status === "running") return <Loader2 size={16} className="ve-spin" aria-label="Running" />;
  if (status === "done") return <Check size={16} aria-label="Done" />;
  if (status === "failed") return <X size={16} aria-label="Failed" />;
  if (status === "skipped") return <Minus size={16} aria-label="Skipped" />;
  return <>{icon}</>;
}

export function AutoEditPanel() {
  const hasVideo = useVibe((s) => s.project.clips.length > 0 || s.project.audio.some((a) => s.project.assets.find((x) => x.id === a.assetId)?.origin !== "music"));
  const captions = useVibe((s) => s.project.captions);
  const [picked, setPicked] = useState<Record<StepId, boolean>>(() => Object.fromEntries(STEPS.map((s) => [s.id, s.on])) as Record<StepId, boolean>);
  const [mood, setMood] = useState("warm lo-fi");
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [results, setResults] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"idle" | "running" | "stopping" | "done">("idle");
  const [busy, setBusy] = useState<StepId | "style" | null>(null);
  const stop = useRef(false);
  const before = useRef<VibeProject | null>(null);

  async function runAll() {
    const steps = STEPS.filter((s) => picked[s.id]);
    if (!steps.length) return toast.error("Pick at least one step.");
    before.current = vibe.get().project;
    stop.current = false;
    setPhase("running");
    setResults({});
    setStatus(Object.fromEntries(STEPS.map((s) => [s.id, picked[s.id] ? "waiting" : "skipped"])));
    for (const step of steps) {
      if (stop.current) {
        setStatus((m) => ({ ...m, [step.id]: "skipped" }));
        setResults((m) => ({ ...m, [step.id]: "Stopped before this step" }));
        continue;
      }
      setStatus((m) => ({ ...m, [step.id]: "running" }));
      try {
        const line = await step.run(mood);
        setStatus((m) => ({ ...m, [step.id]: "done" }));
        setResults((m) => ({ ...m, [step.id]: line }));
      } catch (error) {
        setStatus((m) => ({ ...m, [step.id]: "failed" }));
        setResults((m) => ({ ...m, [step.id]: (error as Error)?.message || "Failed" }));
      }
    }
    setPhase("done");
    toast.success(stop.current ? "Stopped. The finished steps are kept." : "Your edit is ready. Press play to watch it.");
  }

  function restore() {
    if (!before.current) return;
    vibe.commit(before.current);
    before.current = null;
    setPhase("idle");
    setStatus({});
    setResults({});
    toast.success("Back to the original. Undo brings the edit back.");
  }

  async function one(id: StepId) {
    const step = STEPS.find((s) => s.id === id)!;
    setBusy(id);
    try {
      toast.success(await step.run(mood));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  }

  // "Click again for a new style": captions already there cycle to the next look.
  function nextStyle() {
    const ids = CAPTION_STYLES.map((s) => s.id);
    const next = ids[(ids.indexOf(captions.style) + 1) % ids.length];
    void loadCaptionFont(next).then(() => vibe.commit((p) => p, "caption-font"));
    vibe.commit((p) => setCaptionLook(p, { style: next, show: true }), "caption-look");
    toast.success(`Caption style: ${CAPTION_STYLES.find((s) => s.id === next)?.name || next}`);
  }

  const running = phase === "running" || phase === "stopping";
  const idle = phase === "idle";

  return (
    <>
      <section className="ve-sec" aria-labelledby="ve-auto-title">
        <div className="ve-sec-head">
          <h3 id="ve-auto-title">Edit my video</h3>
        </div>
        <p className="ve-hint">Runs the first pass an editor would, step by step. Each step is one undo, and you can stop after any of them.</p>
        <ol className="ve-auto-steps">
          {STEPS.map((step) => {
            const state = status[step.id] || "idle";
            return (
              <li key={step.id} className={`ve-auto-step is-${state}${idle && !picked[step.id] ? " is-off" : ""}`}>
                {idle ? (
                  <label className="ve-auto-pick">
                    <input type="checkbox" checked={picked[step.id]} onChange={(e) => setPicked((m) => ({ ...m, [step.id]: e.target.checked }))} />
                    <span className="ve-auto-mark" aria-hidden="true">{step.icon}</span>
                    <span className="ve-auto-text">
                      <strong>{step.title}</strong>
                      <small>{step.detail}</small>
                    </span>
                  </label>
                ) : (
                  <div className="ve-auto-pick" aria-live="polite">
                    <span className="ve-auto-mark"><StatusMark status={state} icon={step.icon} /></span>
                    <span className="ve-auto-text">
                      <strong>{step.title}</strong>
                      <small>{results[step.id] || (state === "waiting" ? "Waiting" : state === "running" ? "Working…" : state === "skipped" ? "Skipped" : "")}</small>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {idle && picked.music ? (
          <label className="ve-field">
            <span>Music mood</span>
            <input className="ve-input" value={mood} onChange={(e) => setMood(e.target.value)} placeholder="e.g. upbeat corporate, warm lo-fi" maxLength={60} />
          </label>
        ) : null}
        <div className="ve-actions">
          {running ? (
            <button type="button" className="ve-btn ve-btn-block" disabled={phase === "stopping"} onClick={() => { stop.current = true; setPhase("stopping"); }}>
              {phase === "stopping" ? "Stopping after this step…" : "Stop after this step"}
            </button>
          ) : phase === "done" ? (
            <>
              <button type="button" className="ve-btn ve-btn-primary ve-btn-block" onClick={() => vibe.play(true)}>
                Watch the edit
              </button>
              <button type="button" className="ve-btn ve-btn-block" onClick={restore}>
                <Undo2 size={15} /> Back to the original
              </button>
              <button type="button" className="ve-btn ve-btn-quiet ve-btn-block" onClick={() => setPhase("idle")}>
                Choose steps again
              </button>
            </>
          ) : (
            <button type="button" className="ve-btn ve-btn-primary ve-btn-lg ve-btn-block" disabled={!hasVideo} onClick={() => void runAll()}>
              <Wand2 size={16} /> Edit my video
            </button>
          )}
        </div>
        {!hasVideo ? <p className="ve-hint">Add a talking-head clip in Media first.</p> : null}
      </section>

      <section className="ve-sec" aria-labelledby="ve-one-title">
        <div className="ve-sec-head">
          <h3 id="ve-one-title">One click</h3>
        </div>
        <div className="ve-auto-actions">
          {STEPS.filter((s) => s.id !== "captions").map((step) => (
            <button key={step.id} type="button" className="ve-auto-action" disabled={running || busy !== null || !hasVideo} onClick={() => void one(step.id)}>
              <span className="ve-auto-mark" aria-hidden="true">{busy === step.id ? <Loader2 size={16} className="ve-spin" /> : step.icon}</span>
              <span className="ve-auto-text">
                <strong>{step.title}</strong>
                <small>{step.detail}</small>
              </span>
            </button>
          ))}
          <button type="button" className="ve-auto-action" disabled={running || busy !== null || !hasVideo} onClick={() => (captions.cues.length ? nextStyle() : void one("captions"))}>
            <span className="ve-auto-mark" aria-hidden="true">{busy === "captions" ? <Loader2 size={16} className="ve-spin" /> : <Captions size={16} />}</span>
            <span className="ve-auto-text">
              <strong>{captions.cues.length ? "Next caption style" : "Add captions"}</strong>
              <small>{captions.cues.length ? "Click again for another look." : "Word-timed captions from the speech."}</small>
            </span>
          </button>
        </div>
      </section>
    </>
  );
}
