import { useEffect, useState } from "react";
import { ArrowLeft, Lock } from "lucide-react";
import { adminFetch, can, fmt } from "../api";
import { toast } from "../../utils/toast";
import { Avatar, Badge, Button, Card, cx, Empty, ErrorState, Loading, Page, Person, Segmented, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";

type TicketRow = { id: string; subject: string; category: string; status: string; priority: string; assignedTo: string; createdAt: string; lastMessageAt: string; userId: string; email: string; name: string; avatarUrl: string; lastAuthor: string };
type Thread = {
  id: string; subject: string; category: string; status: string; priority: string; assignedTo: string; createdAt: string;
  user: { id: string; email: string; name: string; avatarUrl: string };
  messages: Array<{ id: string; authorType: "user" | "admin" | "note"; authorEmail: string; body: string; createdAt: string }>;
};

export function SupportPage({ admin, route, navigate }: PageProps) {
  const [status, setStatus] = useState("active");
  const [assigned, setAssigned] = useState("");
  const list = useAdminQuery<{ tickets: TicketRow[]; counts: Record<string, number> }>(`/api/admin/support/tickets?status=${status}&assigned=${assigned}`);
  const counts = list.data?.counts || {};
  const openId = route.id;
  return (
    <Page title="Support" description="Requests people send from Help & support in the app.">
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
  const query = useAdminQuery<{ ticket: Thread }>(`/api/admin/support/tickets/${encodeURIComponent(id)}`);
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
      query.setData(result);
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
      query.setData(result);
      onChanged();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy("");
    }
  };

  if (query.error && !t) return <ErrorState message={query.error} onRetry={query.reload} />;
  if (!t) return <Card><Loading label="Loading request" /></Card>;
  return (
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
            <label className="adm-check"><input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} /> Internal note</label>
            <Button variant="primary" disabled={!body.trim()} loading={busy === "send"} onClick={send}>{internal ? "Add note" : "Send reply"}</Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
