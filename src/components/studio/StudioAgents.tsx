// Agents and Design Agent: chat that plans work and launches generations.
import { FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowUp, Check, ChevronDown, History, Loader2, Music, Plus, Trash2 } from "lucide-react";
import { STUDIO_APPS } from "./studioApps";
import { type Catalog, Empty, type Generation, Lightbox, readJson, Tabs, timeAgo, usePopover } from "./studioShared";

type Action = { app: string; prompt: string; generationId?: string; error?: string };
type Message = { role: "user" | "assistant"; content: string; actions?: Action[]; at: string };
type Chat = { id: string; agent: string; title: string; messages: Message[]; createdAt: string; updatedAt?: string };

const DESIGN_STARTERS = ["A bold poster for my channel's Friday premiere", "Three logo directions for a movie recap channel", "An Instagram carousel cover about 5 hidden film details"];
const AGENT_STARTERS = ["Plan and make a 3-shot teaser for a sci-fi recap", "Design a thumbnail for 'The ending nobody expected'", "Create a moody music cue and a matching cover image"];

export function StudioAgents({ mode, catalog, generations, now, onGenerations }: { mode: "agents" | "design-agent"; catalog: Catalog | null; generations: Generation[]; now: number; onGenerations: () => void }) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatId, setChatId] = useState("");
  const [agent, setAgent] = useState(mode === "design-agent" ? "design" : "creative");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const agents = (catalog?.agents || []).filter((a) => (mode === "design-agent" ? a.id === "design" : a.id !== "design"));
  const visibleChats = chats.filter((c) => (mode === "design-agent" ? c.agent === "design" : c.agent !== "design"));
  const chat = visibleChats.find((c) => c.id === chatId);
  const activeAgent = chat?.agent || agent;
  const agentInfo = catalog?.agents.find((a) => a.id === activeAgent);
  const meta = STUDIO_APPS[mode];

  useEffect(() => {
    setAgent(mode === "design-agent" ? "design" : "creative");
    setChatId("");
    setError("");
  }, [mode]);

  useEffect(() => {
    fetch("/api/studio/agents/chats")
      .then((response) => readJson(response, "Chats unavailable"))
      .then((data) => setChats(Array.isArray(data.chats) ? data.chats : []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [chat?.messages.length, pendingText]);

  async function send(event?: FormEvent, text = message) {
    event?.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setError("");
    setPendingText(content);
    setMessage("");
    try {
      const data = await readJson(
        await fetch("/api/studio/agents/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: chat?.id, agent: activeAgent, message: content }) }),
        "The agent couldn't reply",
      );
      setChats((current) => [data.chat, ...current.filter((c) => c.id !== data.chat.id)]);
      setChatId(data.chat.id);
      if (data.chat.messages.at(-1)?.actions?.length) onGenerations();
    } catch (err) {
      setMessage(content);
      setError(err instanceof Error ? err.message : "The agent couldn't reply");
    } finally {
      setSending(false);
      setPendingText("");
    }
  }
  async function removeChat(id: string) {
    setChats((current) => current.filter((c) => c.id !== id));
    if (id === chatId) setChatId("");
    await fetch(`/api/studio/agents/chats/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
  }

  const starters = mode === "design-agent" ? DESIGN_STARTERS : AGENT_STARTERS;
  return (
    <>
      <div className="cs-agent-bar">
        {mode === "agents" && !chat ? (
          <Tabs label="Agent" value={agent} options={agents.map((a) => ({ value: a.id, label: a.name }))} onChange={setAgent} />
        ) : (
          <p className="cs-agent-name">{agentInfo?.name || meta.label}</p>
        )}
        <div className="cs-agent-tools">
          <ChatHistory chats={visibleChats} current={chatId} onPick={setChatId} onDelete={(id) => void removeChat(id)} now={now} />
          {chat ? <button type="button" className="cs-ghost" onClick={() => setChatId("")}><Plus className="h-3.5 w-3.5" />New chat</button> : null}
        </div>
      </div>

      <div className="cs-canvas cs-chat">
        {!chat && !pendingText ? (
          <Empty icon={meta.icon} heading={agentInfo?.name || meta.heading} body={agentInfo?.intro || meta.body}>
            <div className="cs-starters">
              {starters.map((starter) => (
                <button key={starter} type="button" className="cs-starter" onClick={() => void send(undefined, starter)}>{starter}</button>
              ))}
            </div>
          </Empty>
        ) : (
          <div className="cs-thread">
            {(chat?.messages || []).map((m, index) => (
              m.role === "user" ? (
                <p key={index} className="cs-bubble">{m.content}</p>
              ) : (
                <div key={index} className="cs-reply">
                  <p>{m.content}</p>
                  {m.actions?.length ? (
                    <div className="cs-launched">
                      {m.actions.map((action, n) => (
                        <LaunchedWork key={n} action={action} generation={generations.find((g) => g.id === action.generationId)} onOpen={setLightbox} />
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            ))}
            {pendingText ? (
              <>
                <p className="cs-bubble">{pendingText}</p>
                <p className="cs-thinking"><Loader2 className="h-4 w-4 animate-spin" />Thinking</p>
              </>
            ) : null}
            <div ref={bottom} />
          </div>
        )}
      </div>

      <form className="cs-composer cs-chat-composer" onSubmit={(event) => void send(event)}>
        <div className="cs-prompt-row">
          <textarea
            className="cs-textarea"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder={meta.placeholder}
            aria-label="Message"
          />
          <button type="submit" className="cs-send" disabled={!message.trim() || sending} aria-label="Send">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
        {error ? <p className="cs-error" role="alert">{error}</p> : null}
      </form>
      {lightbox ? <Lightbox src={lightbox} onClose={() => setLightbox(null)} /> : null}
    </>
  );
}

function LaunchedWork({ action, generation, onOpen }: { action: Action; generation?: Generation; onOpen: (src: string) => void }) {
  const label = action.app === "image" ? "Image" : action.app === "video" ? "Video" : "Music";
  if (action.error) return <div className="cs-launch cs-launch-failed"><AlertCircle className="h-4 w-4" /><span><strong>{label}</strong> {action.error}</span></div>;
  const output = generation?.outputs[0];
  const pending = !generation || generation.status === "queued" || generation.status === "running";
  return (
    <div className="cs-launch">
      {generation?.status === "done" && output ? (
        output.type.startsWith("image") ? (
          <div className="cs-launch-images">
            {generation.outputs.map((o) => (
              <button key={o.file} type="button" className="cs-thumb" onClick={() => onOpen(o.url)} aria-label="Open full size"><img src={o.url} alt={action.prompt.slice(0, 100)} loading="lazy" /></button>
            ))}
          </div>
        ) : output.type.startsWith("video") ? (
          <video className="cs-video" src={output.url} controls playsInline preload="metadata" />
        ) : (
          <div className="cs-audio"><Music className="h-5 w-5" /><audio controls src={output.url} preload="metadata" /></div>
        )
      ) : (
        <div className="cs-launch-status">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
          <span>{pending ? `${label} · ${generation?.message || "generating"}` : generation?.error || "Generation failed"}</span>
        </div>
      )}
      <p className="cs-launch-prompt">{action.prompt}</p>
    </div>
  );
}

function ChatHistory({ chats, current, onPick, onDelete, now }: { chats: Chat[]; current: string; onPick: (id: string) => void; onDelete: (id: string) => void; now: number }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="cs-pop" ref={ref}>
      <button type="button" className="cs-ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} disabled={!chats.length}>
        <History className="h-3.5 w-3.5" />History<ChevronDown className="h-3 w-3" />
      </button>
      {open ? (
        <div className="cs-menu cs-menu-right cs-history" role="menu">
          {chats.map((c) => (
            <div key={c.id} className="cs-history-row">
              <button type="button" role="menuitem" className="cs-menu-item" onClick={() => { onPick(c.id); setOpen(false); }}>
                <span className="cs-truncate">{c.title}</span>
                <span className="cs-meta">{timeAgo(c.updatedAt || c.createdAt, now)}</span>
                {c.id === current ? <Check className="h-3.5 w-3.5" /> : null}
              </button>
              <button type="button" className="cs-icon" onClick={() => onDelete(c.id)} aria-label={`Delete chat ${c.title}`}><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
