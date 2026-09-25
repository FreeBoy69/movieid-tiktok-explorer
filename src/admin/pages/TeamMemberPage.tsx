import { useState } from "react";
import { adminFetch, can, fmt } from "../api";
import { toast } from "../../utils/toast";
import { Avatar, BackLink, Badge, Button, Card, DataTable, DetailHeader, Empty, ErrorState, Facts, Loading, Modal, RankBars, Stat, useAdminQuery } from "../ui";
import { ROLE_LABEL } from "./TeamPage";
import type { PageProps } from "../AdminApp";

type Member = {
  email: string; role: string; source: "ADMIN_EMAILS" | "team";
  member: { email: string; role: string; addedBy: string; createdAt: string } | null;
  user: { id: string; name: string; avatarUrl: string; lastSeenAt: string | null; createdAt: string } | null;
  stats: { total: number; last30d: number; lastAt: string | null; tokensGranted: number; suspensions: number; replies: number };
  byAction: Array<{ action: string; n: number }>;
  recent: Array<{ id: string; action: string; targetType: string; targetId: string; detail: Record<string, unknown>; createdAt: string }>;
};

const ROLE_POWERS: Record<string, string[]> = {
  owner: ["Everything below", "Add, change and remove admins"],
  admin: ["Manage users, plans and credits", "Change governance and pricing", "Answer support"],
  support: ["See everything", "Answer support requests"],
  viewer: ["See everything", "Change nothing"],
};

export function TeamMemberPage({ admin, route, navigate }: PageProps) {
  const email = route.id;
  const query = useAdminQuery<Member>(`/api/admin/team/${encodeURIComponent(email)}`);
  const [role, setRole] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState("");
  const back = <BackLink label="Team & audit" onClick={() => navigate("/admin/team")} />;
  if (query.error && !query.data) return <div className="adm-page">{back}<ErrorState message={query.error} onRetry={query.reload} /></div>;
  if (!query.data) return <div className="adm-page">{back}<Loading label="Loading admin" /></div>;
  const m = query.data;
  const manage = can(admin, "team.manage") && m.source === "team" && m.email !== admin.email;
  const selected = role || m.role;

  const saveRole = async () => {
    setBusy("role");
    try {
      await adminFetch("/api/admin/team", { method: "POST", body: { email: m.email, role: selected } });
      toast.success(`${m.email} is now ${ROLE_LABEL[selected] || selected}.`);
      setRole("");
      query.reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy("");
    }
  };
  const remove = async () => {
    setBusy("remove");
    try {
      await adminFetch(`/api/admin/team/${encodeURIComponent(m.email)}`, { method: "DELETE" });
      toast.success(`${m.email} no longer has admin access.`);
      navigate("/admin/team");
    } catch (error) {
      toast.error(error);
      setBusy("");
    }
  };

  return (
    <div className="adm-page">
      {back}
      <DetailHeader
        leading={<Avatar src={m.user?.avatarUrl || ""} name={m.user?.name || m.email} size={64} />}
        title={m.user?.name || m.email}
        subtitle={m.email}
        badges={<>
          <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{ROLE_LABEL[m.role] || m.role}</Badge>
          {m.source === "ADMIN_EMAILS" ? <Badge tone="neutral">Set on the server</Badge> : null}
          {!m.user ? <Badge tone="warn">Hasn't signed in yet</Badge> : null}
        </>}
        meta={m.member ? `Added by ${m.member.addedBy} on ${fmt.date(m.member.createdAt)} · last active ${fmt.ago(m.user?.lastSeenAt).toLowerCase()}` : `Last active ${fmt.ago(m.user?.lastSeenAt).toLowerCase()}`}
        actions={m.user ? <Button onClick={() => navigate(`/admin/users/${m.user!.id}`)}>Open their user account</Button> : null}
      />
      <div className="adm-stats is-4">
        <Stat label="Admin actions" value={fmt.number(m.stats.total)} hint={`${fmt.number(m.stats.last30d)} in the last 30 days`} />
        <Stat label="Last action" value={fmt.ago(m.stats.lastAt)} />
        <Stat label="Credits granted" value={fmt.credits(m.stats.tokensGranted)} hint="all time" />
        <Stat label="Support replies" value={fmt.number(m.stats.replies)} hint={`${fmt.number(m.stats.suspensions)} suspensions`} />
      </div>
      <div className="adm-grid is-2">
        <Card title="Role and access">
          {manage ? (
            <div className="adm-plan-pick" role="radiogroup" aria-label="Role">
              {["admin", "support", "viewer"].map((r) => (
                <button key={r} type="button" role="radio" aria-checked={selected === r} className={selected === r ? "is-on" : undefined} onClick={() => setRole(r)}>
                  <strong>{ROLE_LABEL[r]}{r === m.role ? " (current)" : ""}</strong>
                  <span>{ROLE_POWERS[r].join(" · ")}</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <Facts columns={1} items={[["Role", ROLE_LABEL[m.role] || m.role], ["Can", ROLE_POWERS[m.role]?.join(" · ") || "—"]]} />
              <p className="adm-help adm-mt">
                {m.source === "ADMIN_EMAILS" ? "Super admins are set in the server's ADMIN_EMAILS setting and can't be changed here." : m.email === admin.email ? "You can't change your own role." : "Only super admins can change roles."}
              </p>
            </>
          )}
          {manage ? (
            <div className="adm-actions-row adm-mt">
              <Button variant="primary" disabled={selected === m.role} loading={busy === "role"} onClick={saveRole}>Save role</Button>
              <Button variant="danger" onClick={() => setConfirm(true)}>Remove from team</Button>
            </div>
          ) : null}
        </Card>
        <Card title="What they do most">
          <RankBars format={(v) => fmt.number(v)} items={m.byAction.map((a) => ({ key: a.action, label: <code>{a.action}</code>, value: Number(a.n) }))} />
        </Card>
      </div>
      <Card title="Their recent actions" flush>
        <DataTable
          rowKey={(e) => e.id}
          rows={m.recent}
          onRowClick={(e) => (e.targetType === "user" ? navigate(`/admin/users/${e.targetId}`) : e.targetType === "ticket" ? navigate(`/admin/support/${e.targetId}`) : e.targetType === "plan" ? navigate(`/admin/billing/${e.targetId}`) : undefined)}
          empty={<Empty title="No admin actions yet" />}
          columns={[
            { key: "when", label: "When", render: (e) => <span className="adm-muted">{fmt.dateTime(e.createdAt)}</span> },
            { key: "action", label: "Action", render: (e) => <code>{e.action}</code> },
            { key: "target", label: "Target", render: (e) => String(e.detail?.email || e.targetId || "—") },
            { key: "detail", label: "Detail", render: (e) => <span className="adm-audit-detail">{Object.entries(e.detail || {}).filter(([k]) => !["email", "after"].includes(k)).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ") || "—"}</span> },
          ]}
        />
      </Card>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Remove ${m.email}?`} actions={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" loading={busy === "remove"} onClick={remove}>Remove access</Button></>}>
        <p>They lose access to the admin console right away. Their user account and past actions in the audit log stay.</p>
      </Modal>
    </div>
  );
}
