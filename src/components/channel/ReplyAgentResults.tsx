// ReplyAgentResults, one of ChannelManagement's screens.
import { AlertCircle, CheckCircle2, Loader2, MessageCircle, Send } from "lucide-react";
import { cn } from "../../lib/utils";
import { compactNumber } from "./shared";

const REPLY_TYPE_LABEL: Record<string, string> = {
  movie_name: "Movie ID",
  ai_engagement_movie_context: "Movie-aware",
  quick_reply: "Quick reply",
  ai_engagement: "AI reply",
};

type ReplyDraft = { text: string; include: boolean; status?: "posting" | "posted" | "failed"; error?: string };

export function ReplyAgentResults({ result, running, isDark, drafts, posting, onDraft, onPost }: { result: any; running: boolean; isDark: boolean; drafts: Record<string, ReplyDraft>; posting: boolean; onDraft: (id: string, patch: Partial<ReplyDraft>) => void; onPost: () => void }) {
  const card = isDark ? "border-white/10 bg-[var(--ui-panel)]" : "border-[var(--ui-line)] bg-[var(--ui-panel)] shadow-sm";
  const muted = isDark ? "text-white/55" : "text-[var(--ui-text)]/55";
  const ink = isDark ? "text-white" : "text-[var(--ui-text)]";
  if (!result) {
    return (
      <div className={cn("grid min-h-[360px] place-items-center rounded-2xl border border-dashed p-8 text-center", isDark ? "border-white/12" : "border-[var(--ui-line-strong)]")}>
        <div className="max-w-sm">
          {running ? <Loader2 className={cn("mx-auto h-6 w-6 ui-spin", muted)} /> : <MessageCircle className={cn("mx-auto h-6 w-6", muted)} />}
          <p className={cn("mt-3 text-base font-bold", ink)}>{running ? "Reading your comments" : "Nothing scanned yet"}</p>
          <p className={cn("mt-1 text-sm leading-6", muted)}>
            {running ? "Checking new comments and the threads you already replied in." : "Run the agent to see every comment and follow-up worth answering, with a drafted reply for each."}
          </p>
        </div>
      </div>
    );
  }
  const items: any[] = result.replied || [];
  const followUps = items.filter((item) => item.kind === "follow_up").length;
  const threads = (result.scanned || []).reduce((sum: number, video: any) => sum + Number(video.comments || 0), 0);
  const selectable = items.filter((item) => drafts[item.commentId]?.status !== "posted");
  const selected = selectable.filter((item) => drafts[item.commentId]?.include && drafts[item.commentId]?.text.trim());
  const skipReasons = Object.entries(
    (result.skipped || []).reduce((counts: Record<string, number>, item: any) => ({ ...counts, [item.reason || "Skipped"]: (counts[item.reason || "Skipped"] || 0) + 1 }), {}),
  ).sort((a: any, b: any) => b[1] - a[1]);
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-[var(--ui-line)]", card)}>
      <div className={cn("flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between", isDark ? "border-white/10" : "border-[var(--ui-line)]")}>
        <div>
          <p className={cn("text-[11px] font-black uppercase tracking-widest", isDark ? "text-[var(--ui-accent-text)]" : "text-[var(--ui-accent-text)]")}>{result.dryRun ? "Drafts to review" : "Posted"}</p>
          <h3 className={cn("mt-0.5 text-lg font-extrabold", ink)}>
            {items.length} {items.length === 1 ? "reply" : "replies"} {result.dryRun ? "ready" : "sent"}
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            ["video", "videos", result.scanned?.length || 0],
            ["thread", "threads", threads],
            ["follow-up", "follow-ups", followUps],
            ["skipped", "skipped", result.skipped?.length || 0],
          ] as const).map(([one, many, value]) => (
            <span key={many} className={cn("rounded-lg px-2.5 py-1.5 text-xs font-bold", isDark ? "bg-white/[0.06] text-white/70" : "bg-[var(--ui-bg)] text-[var(--ui-text)]/70")}>
              <span className={ink}>{compactNumber(Number(value))}</span> {Number(value) === 1 ? one : many}
            </span>
          ))}
        </div>
      </div>

      {result.dryRun && selectable.length ? (
        <div className={cn("flex items-center justify-between gap-3 border-b px-4 py-2.5", isDark ? "border-white/10 bg-white/[0.02]" : "border-[var(--ui-line)] bg-[var(--ui-panel)]")}>
          <label className={cn("flex items-center gap-2 text-sm font-semibold", muted)}>
            <input
              type="checkbox"
              className="ui-check"
              checked={selected.length === selectable.length}
              onChange={(e) => selectable.forEach((item) => onDraft(item.commentId, { include: e.target.checked }))}
            />
            {selected.length} of {selectable.length} selected
          </label>
          <button type="button" disabled={posting || !selected.length} onClick={onPost} className="ui-btn is-primary is-sm">
            {posting ? <Loader2 className="h-4 w-4 ui-spin" /> : <Send className="h-4 w-4" />}
            Post {selected.length || ""} {selected.length === 1 ? "reply" : "replies"}
          </button>
        </div>
      ) : null}

      <div className={cn("max-h-[70vh] space-y-3 overflow-y-auto p-3", isDark ? "bg-black/10" : "bg-[var(--ui-bg)]")}>
        {items.length ? items.map((item) => {
          const draft: ReplyDraft = drafts[item.commentId] || { text: item.replyText, include: true };
          const posted = draft.status === "posted";
          const thread: any[] = item.kind === "follow_up" && Array.isArray(item.context) ? item.context.slice(-3) : [{ author: item.author, owner: false, text: item.comment }];
          return (
            <article key={item.commentId} className={cn("rounded-xl border p-3.5 transition", isDark ? "border-white/10 bg-[var(--ui-panel)]" : "border-[var(--ui-line)] bg-[var(--ui-panel)]", !draft.include && !posted && "opacity-55")}>
              <div className="flex items-center gap-2">
                {result.dryRun && !posted ? (
                  <input type="checkbox" aria-label="Include this reply" className="ui-check shrink-0" checked={draft.include} onChange={(e) => onDraft(item.commentId, { include: e.target.checked })} />
                ) : null}
                <p className={cn("min-w-0 flex-1 truncate text-xs font-bold", muted)}>{item.videoTitle}</p>
                {item.kind === "follow_up" ? <span className="shrink-0 rounded-md bg-[var(--ui-accent)] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[var(--ui-accent-ink)]">Follow-up</span> : null}
                <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider", isDark ? "bg-white/[0.08] text-white/60" : "bg-[var(--ui-bg)] text-[var(--ui-text)]/60")}>{REPLY_TYPE_LABEL[item.replyType] || "Reply"}</span>
              </div>
              <div className="mt-2.5 space-y-1.5">
                {thread.map((message, index) => (
                  <p key={index} className={cn("rounded-lg px-3 py-2 text-sm leading-6", message.owner ? (isDark ? "ml-6 bg-white/[0.06] text-white/70" : "ml-6 bg-[var(--ui-bg)] text-[var(--ui-text)]/70") : isDark ? "bg-white/[0.03] text-white/85" : "bg-[var(--ui-panel)] text-[var(--ui-text)]/85")}>
                    <span className={cn("mr-1.5 font-bold", message.owner ? (isDark ? "text-[var(--ui-accent-text)]" : "text-[var(--ui-accent-text)]") : ink)}>{message.owner ? "You" : message.author}</span>
                    {message.text}
                  </p>
                ))}
              </div>
              <div className="mt-2.5 pl-6">
                {result.dryRun && !posted ? (
                  <textarea
                    aria-label="Reply"
                    value={draft.text}
                    maxLength={500}
                    rows={2}
                    onChange={(e) => onDraft(item.commentId, { text: e.target.value })}
                    className={cn("w-full resize-y rounded-lg border px-3 py-2 text-sm font-semibold leading-6 outline-none transition", isDark ? "border-[var(--ui-accent)]/25 bg-[var(--ui-accent)]/[0.07] text-white" : "border-[var(--ui-accent)]/50 bg-[var(--ui-accent-soft)]/60 text-[var(--ui-text)]")}
                  />
                ) : (
                  <p className={cn("rounded-lg px-3 py-2 text-sm font-semibold leading-6", isDark ? "bg-[var(--ui-accent)]/[0.08] text-white" : "bg-[var(--ui-accent-soft)]/70 text-[var(--ui-text)]")}>{draft.text}</p>
                )}
                {draft.status === "posting" ? <p className={cn("mt-1.5 flex items-center gap-1.5 text-xs font-bold", muted)}><Loader2 className="h-3.5 w-3.5 ui-spin" /> Posting</p> : null}
                {posted ? <p className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-emerald-500"><CheckCircle2 className="h-3.5 w-3.5" /> Posted</p> : null}
                {draft.status === "failed" ? <p className="mt-1.5 flex items-center gap-1.5 text-xs font-bold text-red-500"><AlertCircle className="h-3.5 w-3.5" /> {draft.error || "Could not post"}</p> : null}
              </div>
            </article>
          );
        }) : (
          <p className={cn("rounded-xl p-5 text-sm font-semibold", isDark ? "bg-white/[0.03] text-white/50" : "bg-[var(--ui-panel)] text-[var(--ui-text)]/50")}>Nothing needs an answer right now. New comments and follow-ups will show up here on the next run.</p>
        )}
        {skipReasons.length ? (
          <details className={cn("rounded-xl px-3.5 py-2.5 text-sm", isDark ? "bg-white/[0.03] text-white/55" : "bg-[var(--ui-panel)] text-[var(--ui-text)]/55")}>
            <summary className="cursor-pointer font-bold">{result.skipped.length} skipped</summary>
            <ul className="mt-2 space-y-1">
              {skipReasons.map(([reason, count]: any) => (
                <li key={reason} className="flex justify-between gap-3"><span>{reason}</span><span className="font-bold tabular-nums">{count}</span></li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
