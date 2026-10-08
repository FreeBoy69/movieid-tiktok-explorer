// Writing tools on the metered text model: titles, descriptions, hashtags.
// Each task has its own inputs and its own way of laying out the answer.
import { FormEvent, useState } from "react";
import { Check, Copy, ImageIcon, Loader2, Sparkles } from "lucide-react";
import { useErrorToast } from "../../utils/toast";
import { Choice, Empty, LinkField, Segment } from "../studio/studioShared";
import { openToolWith } from "./toolHandoff";
import { toolEntry, type ToolDef } from "./toolApps";
import { ToolLayout } from "./ToolPage";

type Titles = { titles: Array<{ title: string; angle: string }> };
type Description = { description: string; tags: string[]; hashtags: string[]; chapters: Array<{ time: string; title: string }> };
type Hashtags = { hashtags: Array<{ tag: string; reach: "broad" | "medium" | "niche" }> };
type Platform = "youtube" | "shorts" | "tiktok" | "instagram";
type TitleStyle = "mixed" | "curiosity" | "listicle" | "how-to" | "bold";

const PLATFORMS: Array<{ value: Platform; label: string }> = [
  { value: "youtube", label: "YouTube" },
  { value: "shorts", label: "Shorts" },
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
];
const STYLES: Array<{ value: TitleStyle; label: string }> = [
  { value: "mixed", label: "Mixed" },
  { value: "curiosity", label: "Curiosity" },
  { value: "listicle", label: "List" },
  { value: "how-to", label: "How-to" },
  { value: "bold", label: "Bold" },
];
const REACH_LABEL = { broad: "Broad reach", medium: "Medium reach", niche: "Niche" };

function useCopy() {
  const [done, setDone] = useState("");
  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(key);
      window.setTimeout(() => setDone((current) => (current === key ? "" : current)), 1500);
    } catch {}
  };
  return { done, copy };
}

/** A link in place of pasted notes: the page is read server-side (Jina Reader, then a direct fetch). */
function LinkReader({ onText, onError, label }: { onText: (text: string, title: string) => void; onError: (message: string) => void; label: string }) {
  return (
    <LinkField
      skin="tool"
      label={label}
      action="Read"
      busyAction="Reading"
      onError={onError}
      onSubmit={async (url) => {
        const response = await fetch("/api/tools/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, maxChars: 8000 }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Could not read that page");
        onText(String(data.text || ""), String(data.title || ""));
      }}
    />
  );
}

export function TextTool({ tool }: { tool: ToolDef }) {
  const entry = toolEntry(tool.id);
  const task = tool.task!;
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [links, setLinks] = useState("");
  const [style, setStyle] = useState<TitleStyle>("mixed");
  const [platform, setPlatform] = useState<Platform>(task === "hashtags" ? "tiktok" : "youtube");
  const [count, setCount] = useState(task === "hashtags" ? 20 : 10);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Titles | Description | Hashtags | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const { done, copy } = useCopy();

  const input = task === "titles"
    ? { topic, transcript: notes, style, count }
    : task === "description"
      ? { title: topic, notes, links, platform }
      : { topic, platform, count };
  const ready = !busy && (task === "titles" ? Boolean(topic.trim() || notes.trim()) : task === "description" ? Boolean(topic.trim() || notes.trim()) : Boolean(topic.trim()));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tools/text", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task, input }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The model didn't answer. Try again.");
      setResult(data.result);
      setOff(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The model didn't answer. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const panel = (
    <form style={{ display: "contents" }} onSubmit={(event) => void submit(event)}>
      {task === "titles" ? (
        <>
          <label className="mt-field">
            <span className="mt-label">What is the video about?</span>
            <input className="mt-input" value={topic} maxLength={400} onChange={(event) => setTopic(event.target.value)} placeholder="e.g. I tried every budget microphone under $50" />
          </label>
          <div className="mt-field">
            <label className="mt-field">
              <span className="mt-label">Transcript, script, or article <small>optional</small></span>
              <textarea className="mt-textarea" value={notes} maxLength={6000} rows={4} onChange={(event) => setNotes(event.target.value)} placeholder="Paste it in and the titles will match what's actually said." />
            </label>
            <LinkReader label="or read an article or page from a link" onError={setError} onText={(text, pageTitle) => { setNotes(text.slice(0, 6000)); if (!topic.trim() && pageTitle) setTopic(pageTitle.slice(0, 400)); }} />
          </div>
          <div className="mt-row">
            <Segment<TitleStyle> label="Style" value={style} options={STYLES} onChange={setStyle} />
            <Choice label="Titles" value={String(count)} options={[5, 10, 15, 20].map((n) => ({ value: String(n), label: String(n) }))} onChange={(value) => setCount(Number(value))} />
          </div>
        </>
      ) : null}
      {task === "description" ? (
        <>
          <label className="mt-field">
            <span className="mt-label">Video title</span>
            <input className="mt-input" value={topic} maxLength={200} onChange={(event) => setTopic(event.target.value)} placeholder="e.g. 7 Budget Mics That Beat the Shure SM7B" />
          </label>
          <div className="mt-field">
            <label className="mt-field">
              <span className="mt-label">Script, transcript, or notes <small>optional</small></span>
              <textarea className="mt-textarea" value={notes} maxLength={8000} rows={5} onChange={(event) => setNotes(event.target.value)} placeholder="Paste the script, or a few bullets about what's covered. Timestamps become chapters." />
            </label>
            <LinkReader label="or read a page from a link" onError={setError} onText={(text, pageTitle) => { setNotes(text.slice(0, 8000)); if (!topic.trim() && pageTitle) setTopic(pageTitle.slice(0, 200)); }} />
          </div>
          <label className="mt-field">
            <span className="mt-label">Links to include <small>one per line</small></span>
            <textarea className="mt-textarea" value={links} maxLength={1500} rows={2} onChange={(event) => setLinks(event.target.value)} placeholder={"https://...\nhttps://..."} />
          </label>
          <Segment<Platform> label="Platform" value={platform} options={PLATFORMS} onChange={setPlatform} />
        </>
      ) : null}
      {task === "hashtags" ? (
        <>
          <label className="mt-field">
            <span className="mt-label">Describe the post</span>
            <textarea className="mt-textarea" value={topic} maxLength={600} rows={4} onChange={(event) => setTopic(event.target.value)} placeholder="e.g. a 30-second recap of the ending of Interstellar for a movie-recap channel" />
          </label>
          <div className="mt-row">
            <Segment<Platform> label="Platform" value={platform} options={PLATFORMS} onChange={setPlatform} />
            <Choice label="Tags" value={String(count)} options={[10, 15, 20, 30].map((n) => ({ value: String(n), label: String(n) }))} onChange={(value) => setCount(Number(value))} />
          </div>
        </>
      ) : null}
      <button type="submit" className="mt-primary" disabled={!ready}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
        {busy ? "Writing" : tool.action}
      </button>
    </form>
  );

  const stageLabel = result
    ? task === "titles" ? `${(result as Titles).titles.length} titles` : task === "hashtags" ? `${(result as Hashtags).hashtags.length - off.size} selected` : `${(result as Description).description.trim().split(/\s+/).length} words`
    : "Nothing yet";

  return (
    <ToolLayout panel={panel}>
      <div className="mt-stage-head">
        <h2>{task === "titles" ? "Titles" : task === "description" ? "Description" : "Hashtags"}</h2>
        <span className="mt-meta">{stageLabel}</span>
      </div>
      <div className="mt-stage-inner">
        {busy ? <div className="mt-skeleton" aria-hidden="true"><span /><span /><span /></div> : null}
        {!busy && !result ? <Empty icon={entry?.icon} heading={tool.heading} body={tool.body} /> : null}
        {!busy && result && task === "titles" ? (
          <div className="mt-section">
            <h3>Pick one <button type="button" className="mt-ghost" onClick={() => void copy("all", (result as Titles).titles.map((t) => t.title).join("\n"))}>{done === "all" ? <Check size={14} /> : <Copy size={14} />}Copy all</button></h3>
            <ol className="mt-list">
              {(result as Titles).titles.map((item, index) => (
                <li key={`${item.title}-${index}`}>
                  <span>{item.title}</span>
                  {item.angle ? <span className="mt-tag">{item.angle.replace("-", " ")}</span> : null}
                  <span className="mt-meta" aria-label="Length">{item.title.length}</span>
                  <button type="button" className="mt-icon" data-done={done === item.title ? "true" : undefined} aria-label={`Copy “${item.title}”`} title="Copy" onClick={() => void copy(item.title, item.title)}>{done === item.title ? <Check size={15} /> : <Copy size={15} />}</button>
                  <button type="button" className="mt-icon" aria-label={`Make a thumbnail with “${item.title}”`} title="Use in Thumbnail Maker" onClick={() => openToolWith("thumbnail-maker", { title: item.title.slice(0, 80) })}><ImageIcon size={15} /></button>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {!busy && result && task === "description" ? (() => {
          const r = result as Description;
          return (
            <>
              <div className="mt-section">
                <h3>Description <button type="button" className="mt-ghost" onClick={() => void copy("description", r.description)}>{done === "description" ? <Check size={14} /> : <Copy size={14} />}Copy</button></h3>
                <textarea className="mt-output" value={r.description} onChange={(event) => setResult({ ...r, description: event.target.value })} aria-label="Description" />
              </div>
              {r.chapters.length ? (
                <div className="mt-section">
                  <h3>Chapters <button type="button" className="mt-ghost" onClick={() => void copy("chapters", r.chapters.map((c) => `${c.time} ${c.title}`).join("\n"))}>{done === "chapters" ? <Check size={14} /> : <Copy size={14} />}Copy</button></h3>
                  <ul className="mt-list">
                    {r.chapters.map((chapter) => <li key={`${chapter.time}-${chapter.title}`}><span><span className="mt-meta" style={{ marginRight: 10 }}>{chapter.time}</span>{chapter.title}</span></li>)}
                  </ul>
                </div>
              ) : null}
              {r.tags.length ? (
                <div className="mt-section">
                  <h3>Search tags <button type="button" className="mt-ghost" onClick={() => void copy("tags", r.tags.join(", "))}>{done === "tags" ? <Check size={14} /> : <Copy size={14} />}Copy as list</button></h3>
                  <div className="mt-chips">{r.tags.map((tag) => <span key={tag} className="mt-chip">{tag}</span>)}</div>
                </div>
              ) : null}
              {r.hashtags.length ? (
                <div className="mt-section">
                  <h3>Hashtags <button type="button" className="mt-ghost" onClick={() => void copy("hashtags", r.hashtags.join(" "))}>{done === "hashtags" ? <Check size={14} /> : <Copy size={14} />}Copy</button></h3>
                  <div className="mt-chips">{r.hashtags.map((tag) => <span key={tag} className="mt-chip">{tag}</span>)}</div>
                </div>
              ) : null}
            </>
          );
        })() : null}
        {!busy && result && task === "hashtags" ? (() => {
          const r = result as Hashtags;
          const selected = r.hashtags.filter((item) => !off.has(item.tag)).map((item) => item.tag);
          const toggle = (tag: string) => setOff((current) => {
            const next = new Set(current);
            if (next.has(tag)) next.delete(tag);
            else next.add(tag);
            return next;
          });
          return (
            <div className="mt-section">
              <h3>Tap a tag to leave it out <button type="button" className="mt-secondary" disabled={!selected.length} onClick={() => void copy("selected", selected.join(" "))}>{done === "selected" ? <Check size={14} /> : <Copy size={14} />}Copy {selected.length}</button></h3>
              {(["broad", "medium", "niche"] as const).map((reach) => {
                const group = r.hashtags.filter((item) => item.reach === reach);
                if (!group.length) return null;
                return (
                  <div key={reach} className="mt-chip-group">
                    <span>{REACH_LABEL[reach]}</span>
                    <div className="mt-chips">
                      {group.map((item) => <button key={item.tag} type="button" className="mt-chip" aria-pressed={!off.has(item.tag)} onClick={() => toggle(item.tag)}>{item.tag}</button>)}
                    </div>
                  </div>
                );
              })}
              <p className="mt-note">Selected: {selected.join(" ") || "none"}</p>
            </div>
          );
        })() : null}
      </div>
    </ToolLayout>
  );
}
