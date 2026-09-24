import { useEffect, useState } from "react";
import { ArrowLeft, Lock } from "lucide-react";
import { adminFetch, can, fmt } from "../api";
import { toast } from "../../utils/toast";
import { Avatar, BackLink, Badge, Button, Card, cx, DetailHeader, Empty, ErrorState, Loading, Page, Person, Segmented, Stat, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";
import { TokensModal } from "./UserDetailPage";

type TicketRow = { id: string; subject: string; category: string; status: string; priority: string; assignedTo: string; createdAt: string; lastMessageAt: string; userId: string; email: string; name: string; avatarUrl: string; lastAuthor: string };
type Thread = {
  id: string; subject: string; category: string; status: string; priority: string; assignedTo: string; createdAt: string;
  user: { id: string; email: string; name: string; avatarUrl: string };
  messages: Array<{ id: string; authorType: "user" | "admin" | "note"; authorEmail: string; body: string; createdAt: string }>;
};

export function SupportPage(props: PageProps) {
  return props.route.id === "settings" ? <SupportSettingsPage {...props} /> : <SupportInbox {...props} />;
}

function SupportInbox({ admin, route, navigate }: PageProps) {
  const [status, setStatus] = useState("active");
  const [assigned, setAssigned] = useState("");
  const list = useAdminQuery<{ tickets: TicketRow[]; counts: Record<string, number> }>(`/api/admin/support/tickets?status=${status}&assigned=${assigned}`);
  const counts = list.data?.counts || {};
  const openId = route.id;
  return (
    <Page title="Support" description="Requests people send from Help & support in the app." actions={<Button size="sm" onClick={() => navigate("/admin/support/settings")}>Saved replies & settings</Button>}>
      <div className={cx("adm-inbox", openId && "has-open")}>
        <div className="adm-inbox-list">
          <div className="adm-toolbar">
            <Segmented label="Status" value={status} onChange={setStatus} options={[
              { value: "active", label: "Needs work", count: (counts.open || 0) + (counts.pending || 0) },
              { value: "resolved", label: "Resolved", count: counts.resolved || 0 },
              { value: "closed", label: "Closed", count: counts.closed || 0 },
              { value: "all", label: "All" },
            ]} />
            <Segmented label="Assigned" value={assigned} onChange={setAssigned} options={[{ value: "", label: "Everyone" }, { value: "me", label: "Mine" }]} />
          </div>
          <Card flush>
            {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <Loading label="Loading requests" /> : list.data.tickets.length ? (
              <ul className="adm-tickets">
                {list.data.tickets.map((t) => (
                  <li key={t.id}>
                    <button type="button" className={cx("adm-ticket", openId === t.id && "is-current")} onClick={() => navigate(`/admin/support/${t.id}`)} aria-current={openId === t.id ? "true" : undefined}>
                      <Avatar src={t.avatarUrl} name={t.name || t.email} size={30} />
                      <span className="adm-ticket-main">
                        <span className="adm-ticket-top">
                          <strong>{t.subject}</strong>
                          <time className="adm-muted">{fmt.ago(t.lastMessageAt)}</time>
                        </span>
                        <small>{t.name || t.email} · {t.category}</small>
                        <span className="adm-inline">
                          <Badge>{t.status}</Badge>
                          {t.priority !== "normal" ? <Badge>{t.priority}</Badge> : null}
                          {t.lastAuthor === "user" && t.status !== "closed" ? <Badge tone="accent">Awaiting reply</Badge> : null}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <Empty title={status === "active" ? "Inbox zero" : "No requests here"}>{status === "active" ? "Every request has a reply." : undefined}</Empty>}
          </Card>
        </div>
        <div className="adm-inbox-thread">
          {openId ? <TicketThread id={openId} admin={admin} navigate={navigate} onChanged={list.reload} /> : (
            <Card><Empty title="Pick a request">Replies go to the user in the app. Internal notes stay here.</Empty></Card>
          )}
        </div>
      </div>
    </Page>
  );
}

function TicketThread({ id, admin, navigate, onChanged }: { id: string; admin: PageProps["admin"]; navigate: PageProps["navigate"]; onChanged: () => void }) {
  const query = useAdminQuery<{ ticket: Thread; context: Context }>(`/api/admin/support/tickets/${encodeURIComponent(id)}`);
  const settings = useAdminQuery<{ support: { cannedReplies: Array<{ id: string; title: string; body: string }>; signature: string } }>("/api/admin/settings");
  const [tokensOpen, setTokensOpen] = useState(false);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState("");
  useEffect(() => { setBody(""); setInternal(false); }, [id]);
  const manage = can(admin, "support.manage");
  const t = query.data?.ticket;

  const send = async () => {
    setBusy("send");
    try {
      const result = await adminFetch<{ ticket: Thread }>(`/api/admin/support/tickets/${id}/messages`, { method: "POST", body: { body, internal } });
      query.setData((current) => (current ? { ...current, ticket: result.ticket } : current));
      setBody("");
      toast.success(internal ? "Note added." : "Reply sent.");
      onChanged();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy("");
    }
  };
  const update = async (patch: Record<string, string>) => {
    setBusy(Object.keys(patch)[0]);
    try {
      const result = await adminFetch<{ ticket: Thread }>(`/api/admin/support/tickets/${id}`, { method: "POST", body: patch });
      query.setData((current) => (current ? { ...current, ticket: result.ticket } : current));
      onChanged();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy("");
    }
  };

  if (query.error && !t) return <ErrorState message={query.error} onRetry={query.reload} />;
  if (!t) return <Card><Loading label="Loading request" /></Card>;
  const ctx = query.data?.context;
  const replies = settings.data?.support.cannedReplies || [];
  const firstName = String(t.user.name || "").split(" ")[0] || "there";
  const insertReply = (replyId: string) => {
    const reply = replies.find((r) => r.id === replyId);
    if (!reply) return;
    const signature = settings.data?.support.signature ? `\n\n${settings.data.support.signature}` : "";
    const text = reply.body.replace(/\{name\}/g, firstName) + signature;
    setInternal(false);
    setBody((current) => (current.trim() ? `${current.trim()}\n\n${text}` : text));
  };
  return (
    <div className="adm-stack">
    <TokensModal open={tokensOpen} onClose={() => setTokensOpen(false)} userId={t.user.id} name={t.user.name || t.user.email} onDone={query.reload} />
    <Card className="adm-thread">
      <header className="adm-thread-head">
        <button type="button" className="adm-icon-btn adm-thread-back" onClick={() => navigate("/admin/support")} aria-label="Back to requests"><ArrowLeft size={17} /></button>
        <div>
          <h2>{t.subject}</h2>
          <Person name={t.user.name} email={t.user.email} avatarUrl={t.user.avatarUrl} onClick={() => navigate(`/admin/users/${t.user.id}`)} />
        </div>
      </header>
      <div className="adm-thread-controls">
        <label>Status
          <select className="adm-select" value={t.status} disabled={!manage || busy === "status"} onChange={(event) => update({ status: event.target.value })}>
            {["open", "pending", "resolved", "closed"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </label>
        <label>Priority
          <select className="adm-select" value={t.priority} disabled={!manage || busy === "priority"} onChange={(event) => update({ priority: event.target.value })}>
            {["low", "normal", "high", "urgent"].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </label>
        <span className="adm-muted">{t.assignedTo ? `Assigned to ${t.assignedTo}` : "Unassigned"}</span>
        {manage && t.assignedTo !== admin.email ? <Button size="sm" variant="ghost" loading={busy === "assignedTo"} onClick={() => update({ assignedTo: admin.email })}>Assign to me</Button> : null}
      </div>
      <ol className="adm-messages">
        {t.messages.map((m) => (
          <li key={m.id} className={cx("adm-message", `is-${m.authorType}`)}>
            <div className="adm-message-meta">
              {m.authorType === "note" ? <Lock size={12} aria-hidden="true" /> : null}
              <strong>{m.authorType === "user" ? t.user.name || t.user.email : m.authorEmail}</strong>
              <span>{m.authorType === "note" ? "Internal note" : m.authorType === "admin" ? "Support" : "User"}</span>
              <time>{fmt.dateTime(m.createdAt)}</time>
            </div>
            <p>{m.body}</p>
          </li>
        ))}
      </ol>
      {manage ? (
        <div className={cx("adm-composer", internal && "is-note")}>
          <textarea className="adm-input" rows={4} value={body} onChange={(event) => setBody(event.target.value)} placeholder={internal ? "Only admins see this note" : `Reply to ${t.user.name || t.user.email}`} aria-label={internal ? "Internal note" : "Reply"} />
          <div className="adm-composer-actions">
            <span className="adm-inline">
              <label className="adm-check"><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /> Internal note</label>
              {replies.length ? (
                <select className="adm-select adm-select-sm" value="" onChange={(event) => insertReply(event.target.value)} aria-label="Insert a saved reply">
                  <option value="">Insert saved reply…</option>
                  {replies.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              ) : null}
            </span>
            <Button variant="primary" disabled={!body.trim()} loading={busy === "send"} onClick={send}>{internal ? "Add note" : "Send reply"}</Button>
          </div>
        </div>
      ) : null}
    </Card>
    {ctx ? (
      <Card title="Customer" action={<Button size="sm" onClick={() => navigate(`/admin/users/${t.user.id}`)}>Open profile</Button>}>
        <div className="adm-stats is-4 is-mini">
          <Stat label="Plan" value={ctx.billing?.planName || "—"} hint={ctx.billing?.unlimited ? "Unlimited tokens" : `${fmt.tokens(ctx.billing?.balance)} tokens left`} />
          <Stat label="AI use (7d)" value={fmt.tokens(ctx.tokens7d)} hint={`${fmt.number(ctx.calls7d)} calls`} />
          <Stat label="Uploads (7d)" value={fmt.number(ctx.uploads7d)} hint={`${fmt.number(ctx.activeAgents)} live agents`} />
          <Stat label="Account" value={<Badge>{ctx.status || "active"}</Badge>} hint={`Joined ${fmt.date(ctx.joinedAt)} · seen ${fmt.ago(ctx.lastSeenAt).toLowerCase()}`} />
        </div>
        {ctx.failures.length ? (
          <>
            <h3 className="adm-subhead">Recent failures</h3>
            <ul className="adm-list is-dense">
              {ctx.failures.map((f) => (
                <li key={`${f.type}-${f.id}`}>
                  <button type="button" className="adm-link is-plain adm-list-main" onClick={() => navigate(`/admin/activity/${f.type}/${f.id}`)}><span>{f.kind}</span><small className="adm-error-text">{f.error || "No message"}</small></button>
                  <span className="adm-muted">{fmt.ago(f.at)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {ctx.otherTickets.length ? (
          <>
            <h3 className="adm-subhead">Earlier requests</h3>
            <ul className="adm-list is-dense">
              {ctx.otherTickets.map((o) => (
                <li key={o.id}>
                  <button type="button" className="adm-link is-plain" onClick={() => navigate(`/admin/support/${o.id}`)}>{o.subject}</button>
                  <Badge>{o.status}</Badge>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {can(admin, "billing.manage") ? <div className="adm-actions-row adm-mt"><Button size="sm" variant="primary" onClick={() => setTokensOpen(true)}>Give tokens</Button></div> : null}
      </Card>
    ) : null}
    </div>
  );
}

type Context = {
  billing: { planName: string; balance: number; unlimited: boolean } | null;
  tokens7d: number; calls7d: number; uploads7d: number; activeAgents: number; lastSeenAt: string | null; joinedAt: string; status: string;
  failures: Array<{ type: string; id: string; kind: string; error: string; at: string }>;
  otherTickets: Array<{ id: string; subject: string; status: string; lastMessageAt: string }>;
};

type Reply = { id: string; title: string; body: string };
function SupportSettingsPage({ admin, navigate }: PageProps) {
  const query = useAdminQuery<{ support: { cannedReplies: Reply[]; signature: string } }>("/api/admin/settings");
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [signature, setSignature] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (query.data && replies === null) {
      setReplies(query.data.support.cannedReplies);
      setSignature(query.data.support.signature);
    }
  }, [query.data, replies]);
  const canEdit = can(admin, "support.manage") && can(admin, "settings.manage");
  const save = async () => {
    setSaving(true);
    try {
      await adminFetch("/api/admin/settings/support", { method: "PUT", body: { cannedReplies: replies, signature } });
      toast.success("Saved replies updated.");
      query.reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setSaving(false);
    }
  };
  const update = (index: number, patch: Partial<Reply>) => setReplies((list) => (list || []).map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const dirty = query.data && replies !== null && (JSON.stringify(replies) !== JSON.stringify(query.data.support.cannedReplies) || signature !== query.data.support.signature);
  return (
    <div className="adm-page">
      <BackLink label="Support" onClick={() => navigate("/admin/support")} />
      <DetailHeader title="Saved replies & settings" subtitle="Answers you send often. Use {name} for the customer's first name." actions={canEdit ? <Button variant="primary" disabled={!dirty} loading={saving} onClick={save}>Save changes</Button> : null} />
      {replies === null ? <Loading label="Loading settings" /> : (
        <>
          <Card title="Signature" >
            <p className="adm-help">Added to the end of a saved reply when you insert it.</p>
            <textarea className="adm-input" rows={3} value={signature} disabled={!canEdit} onChange={(e) => setSignature(e.target.value)} placeholder={"Thanks,\nThe AutoYT team"} aria-label="Signature" />
          </Card>
          <Card title={`Saved replies (${replies.length})`} action={canEdit ? <Button size="sm" onClick={() => setReplies([...replies, { id: `reply_${Date.now().toString(36)}`, title: "", body: "" }])}>Add reply</Button> : null}>
            {replies.length ? (
              <div className="adm-stack">
                {replies.map((r, i) => (
                  <div key={r.id} className="adm-reply-edit">
                    <div className="adm-inline-form">
                      <input className="adm-input" value={r.title} disabled={!canEdit} onChange={(e) => update(i, { title: e.target.value })} placeholder="Title, e.g. Refunded tokens" aria-label="Reply title" />
                      {canEdit ? <Button size="sm" variant="ghost" onClick={() => setReplies(replies.filter((_, j) => j !== i))}>Remove</Button> : null}
                    </div>
                    <textarea className="adm-input" rows={4} value={r.body} disabled={!canEdit} onChange={(e) => update(i, { body: e.target.value })} placeholder="Hi {name}, ..." aria-label="Reply text" />
                  </div>
                ))}
              </div>
            ) : <Empty title="No saved replies yet">Add the answers you send most, like refunds or export troubleshooting.</Empty>}
          </Card>
        </>
      )}
    </div>
  );
}
