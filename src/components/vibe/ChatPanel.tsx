// The assistant: say what you want, it answers and edits the timeline.
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Loader2, Sparkles, TriangleAlert, X } from "lucide-react";
import { askAssistant } from "./api";
import { getVoices, runActions } from "./commands";
import { useVibe, vibe } from "./store";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  done?: string[];
  failed?: string[];
  pending?: boolean;
}

const STARTERS = [
  "Edit my video: cut the pauses and ums, clean the audio, punch in on cuts",
  "Caption this with bold word-by-word captions",
  "Write a 20-second hook voiceover about this video and read it warmly",
  "Add calm lo-fi music under everything",
  "Put a title \"Day 1\" at the start for 2 seconds",
  "Make it vertical for TikTok",
];

export function ChatPanel({ onClose }: { onClose?: () => void }) {
  const projectId = useVibe((s) => s.project.id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setMessages([]), [projectId]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    const history = messages.map((m) => ({ role: m.role, text: m.text }));
    const pendingId = `p${Date.now()}`;
    setMessages((m) => [...m, { id: `u${Date.now()}`, role: "user", text: message }, { id: pendingId, role: "assistant", text: "", pending: true }]);
    try {
      const s = vibe.get();
      const answer = await askAssistant({ project: s.project, message, history, playhead: s.playhead, selection: s.selection, voices: getVoices().map((v) => v.name) });
      setMessages((m) => m.map((x) => (x.id === pendingId ? { ...x, text: answer.reply, pending: answer.actions.length > 0 } : x)));
      if (answer.actions.length) {
        const { done, failed } = await runActions(answer.actions);
        setMessages((m) => m.map((x) => (x.id === pendingId ? { ...x, pending: false, done, failed } : x)));
      }
    } catch (error) {
      setMessages((m) => m.map((x) => (x.id === pendingId ? { ...x, pending: false, text: "", failed: [(error as Error).message] } : x)));
    } finally {
      setBusy(false);
      field.current?.focus();
    }
  };

  return (
    <aside className="ve-chat" aria-label="Assistant">
      <header className="ve-chat-head">
        <span className="ve-chat-title">
          <Sparkles size={15} /> Assistant
        </span>
        {onClose ? (
          <button type="button" className="ve-tool" onClick={onClose} aria-label="Close assistant">
            <X size={16} />
          </button>
        ) : null}
      </header>
      <div className="ve-chat-list" ref={list} aria-live="polite">
        {messages.length ? (
          messages.map((m) =>
            m.role === "user" ? (
              <p key={m.id} className="ve-msg ve-msg-user">
                {m.text}
              </p>
            ) : (
              <div key={m.id} className="ve-msg ve-msg-ai">
                {m.text ? <p>{m.text}</p> : null}
                {m.done?.length ? (
                  <ul className="ve-msg-steps">
                    {m.done.map((d, i) => (
                      <li key={i}>
                        <Check size={13} /> {d}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {m.failed?.length ? (
                  <ul className="ve-msg-steps is-failed">
                    {m.failed.map((d, i) => (
                      <li key={i}>
                        <TriangleAlert size={13} /> {d}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {m.pending ? (
                  <span className="ve-msg-working">
                    <Loader2 size={13} className="ve-spin" /> {m.text ? "Editing…" : "Thinking…"}
                  </span>
                ) : null}
              </div>
            ),
          )
        ) : (
          <div className="ve-chat-empty">
            <p>Tell me what to change. I can cut, caption, voice, score, title, and generate shots.</p>
            <div className="ve-starters">
              {STARTERS.map((s) => (
                <button key={s} type="button" className="ve-starter" onClick={() => void send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <form
        className="ve-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          ref={field}
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="Describe an edit…"
          aria-label="Message the assistant"
        />
        <button type="submit" className="ve-send" disabled={!input.trim() || busy} aria-label="Send">
          {busy ? <Loader2 size={16} className="ve-spin" /> : <ArrowUp size={16} />}
        </button>
      </form>
    </aside>
  );
}
