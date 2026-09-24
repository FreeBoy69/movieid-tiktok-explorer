import { useState } from "react";
import { adminFetch, can, fmt } from "../api";
import { toast } from "../../utils/toast";
import { Badge, Button, Card, DataTable, Empty, Field, Guarded, Page, Pager, Person, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";
import { TeamMemberPage } from "./TeamMemberPage";

type Team = { owners: Array<{ email: string; role: string }>; members: Array<{ email: string; role: string; addedBy: string; createdAt: string; name: string | null; avatarUrl: string | null; lastSeenAt: string | null }> };
type AuditEntry = { id: string; adminEmail: string; action: string; targetType: string; targetId: string; detail: Record<string, unknown>; ip: string; createdAt: string };

export const ROLE_LABEL: Record<string, string> = { owner: "Super admin", admin: "Admin", support: "Support", viewer: "Viewer" };
const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including adding and removing admins. Set with ADMIN_EMAILS on the server.",
  admin: "Everything except managing the team.",
  support: "Reads everything and answers support requests.",
  viewer: "Read-only.",
};

export function TeamPage(props: PageProps) {
  return props.route.id ? <TeamMemberPage {...props} /> : <TeamOverview {...props} />;
}

function TeamOverview({ admin, navigate }: PageProps) {
  const team = useAdminQuery<Team>("/api/admin/team");
  const [offset, setOffset] = useState(0);
  const [who, setWho] = useState("");
  const audit = useAdminQuery<{ entries: AuditEntry[] }>(`/api/admin/audit?limit=30&offset=${offset}&admin=${encodeURIComponent(who)}`);
  const [form, setForm] = useState({ email: "", role: "support" });
  const [busy, setBusy] = useState("");
  const manage = can(admin, "team.manage");

  const add = async () => {
    setBusy("add");
    try {
      await adminFetch("/api/admin/team", { method: "POST", body: form });
      toast.success(`${form.email} can now sign in at /admin.`);
      setForm({ email: "", role: form.role });
      team.reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy("");
    }
  };
  const remove = async (email: string) => {
    setBusy(email);
    try {
      await adminFetch(`/api/admin/team/${encodeURIComponent(email)}`, { method: "DELETE" });
      toast.success(`${email} removed from the team.`);
      team.reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy("");
    }
  };

  return (
    <Page title="Team & audit" description="Who can use this console, and everything they've changed.">
      <div className="adm-grid is-2-1">
        <Card title="Admins" flush>
          <Guarded query={team} label="Loading team">
            {({ owners, members }) => (
              <DataTable
                rowKey={(m) => m.email}
                onRowClick={(m) => navigate(`/admin/team/${encodeURIComponent(m.email)}`)}
                rows={[...owners.map((o) => ({ ...o, name: null, avatarUrl: null, lastSeenAt: null, addedBy: "ADMIN_EMAILS", createdAt: "" })), ...members]}
                columns={[
                  { key: "who", label: "Person", render: (m) => <Person name={m.name || undefined} email={m.email} avatarUrl={m.avatarUrl || undefined} /> },
                  { key: "role", label: "Role", render: (m) => <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{ROLE_LABEL[m.role] || m.role}</Badge> },
                  { key: "added", label: "Added by", render: (m) => <span className="adm-muted">{m.addedBy}</span> },
                  { key: "x", label: "", align: "right", render: (m) => (manage && m.role !== "owner" && m.email !== admin.email ? <Button size="sm" variant="ghost" loading={busy === m.email} onClick={() => remove(m.email)}>Remove</Button> : null) },
                ]}
              />
            )}
          </Guarded>
        </Card>
        <Card title="Add an admin">
          {manage ? (
            <div className="adm-form-grid">
              <Field label="Google account email">{(id) => <input id={id} className="adm-input" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="name@example.com" />}</Field>
              <Field label="Role" hint={ROLE_HELP[form.role]}>
                {(id) => (
                  <select id={id} className="adm-select" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
                    <option value="admin">Admin</option>
                    <option value="support">Support</option>
                    <option value="viewer">Viewer</option>
                  </select>
                )}
              </Field>
              <Button variant="primary" disabled={!/^\S+@\S+\.\S+$/.test(form.email)} loading={busy === "add"} onClick={add}>Add to team</Button>
            </div>
          ) : (
            <p className="adm-help">Only super admins can change the team.</p>
          )}
          <dl className="adm-roles">
            {Object.entries(ROLE_HELP).map(([role, help]) => <div key={role}><dt>{ROLE_LABEL[role]}</dt><dd>{help}</dd></div>)}
          </dl>
        </Card>
      </div>
      <Card title="Audit log" flush action={
        <select className="adm-select" value={who} onChange={(event) => { setWho(event.target.value); setOffset(0); }} aria-label="Filter by admin">
          <option value="">Everyone</option>
          {[...(team.data?.owners || []), ...(team.data?.members || [])].map((m) => <option key={m.email} value={m.email}>{m.email}</option>)}
        </select>
      }>
        <Guarded query={audit} label="Loading audit log">
          {({ entries }) => (
            <>
              <DataTable
                rowKey={(e) => e.id}
                rows={entries}
                empty={<Empty title="No admin actions yet" />}
                columns={[
                  { key: "when", label: "When", render: (e) => <span className="adm-muted">{fmt.dateTime(e.createdAt)}</span> },
                  { key: "who", label: "Admin", render: (e) => e.adminEmail },
                  { key: "action", label: "Action", render: (e) => <code>{e.action}</code> },
                  {
                    key: "target", label: "Target", render: (e) => (e.targetType === "user"
                      ? <button type="button" className="adm-link" onClick={() => navigate(`/admin/users/${e.targetId}`)}>{String(e.detail?.email || e.targetId)}</button>
                      : e.targetType === "ticket" ? <button type="button" className="adm-link" onClick={() => navigate(`/admin/support/${e.targetId}`)}>{e.targetId}</button>
                        : <span>{e.targetId}</span>),
                  },
                  { key: "detail", label: "Detail", render: (e) => <AuditDetail detail={e.detail} /> },
                ]}
              />
              <Pager offset={offset} limit={30} count={entries.length} onChange={setOffset} />
            </>
          )}
        </Guarded>
      </Card>
    </Page>
  );
}

function AuditDetail({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail || {}).filter(([key]) => key !== "email" && key !== "after");
  if (!entries.length) return <span className="adm-muted">—</span>;
  return <span className="adm-audit-detail">{entries.map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ")}</span>;
}
