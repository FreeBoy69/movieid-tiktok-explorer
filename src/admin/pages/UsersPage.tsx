import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { adminFetch, can, fmt } from "../api";
import { toast } from "../../utils/toast";
import {
  Badge, BarChart, Button, Card, DataTable, Drawer, Empty, ErrorState, Field, Loading, Modal, Page, Pager, Person, Segmented, Stat, Toggle, useAdminQuery,
} from "../ui";
import type { PageProps } from "../AdminApp";

type UserRow = { id: string; email: string; name: string; avatarUrl: string; status: string; createdAt: string; lastSeenAt: string | null; planName: string; planId: string; unlimited: boolean; balance: number | null; tokens30d: number; channels: number };
type Plan = { id: string; name: string; priceCents: number; monthlyTokens: number; active: boolean };

export function UsersPage({ admin, route, navigate }: PageProps) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "active" | "suspended">("");
  const [sort, setSort] = useState("recent");
  const [plan, setPlan] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(q.trim()); setOffset(0); }, 250);
    return () => window.clearTimeout(timer);
  }, [q]);
  const params = new URLSearchParams({ q: search, status, sort, plan, offset: String(offset), limit: "50" });
  const query = useAdminQuery<{ users: UserRow[]; total: number; limit: number; offset: number }>(`/api/admin/users?${params}`);
  const plans = useAdminQuery<{ plans: Plan[] }>("/api/admin/billing/plans");

  return (
    <Page title="Users" description="Everyone who has signed in to AutoYT. Open someone to manage their plan, tokens and access.">
      <div className="adm-toolbar">
        <label className="adm-search">
          <Search size={16} aria-hidden="true" />
          <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search name, email or user id" aria-label="Search users" />
        </label>
        <Segmented label="Status" value={status} onChange={(value) => { setStatus(value); setOffset(0); }} options={[{ value: "", label: "All" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }]} />
        <select className="adm-select" value={plan} onChange={(event) => { setPlan(event.target.value); setOffset(0); }} aria-label="Plan">
          <option value="">All plans</option>
          {(plans.data?.plans || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="adm-select" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort">
          <option value="recent">Newest first</option>
          <option value="active">Recently active</option>
          <option value="usage">Most tokens (30d)</option>
          <option value="name">Name</option>
        </select>
      </div>
      <Card flush>
        {query.error && !query.data ? <ErrorState message={query.error} onRetry={query.reload} /> : !query.data ? <Loading label="Loading users" /> : (
          <>
            <DataTable
              rowKey={(u) => u.id}
              rows={query.data.users}
              onRowClick={(u) => navigate(`/admin/users/${u.id}`)}
              empty={<Empty title={search ? `No users match "${search}"` : "No users here"} />}
              columns={[
                { key: "user", label: "User", render: (u) => <Person name={u.name} email={u.email} avatarUrl={u.avatarUrl} /> },
                { key: "plan", label: "Plan", render: (u) => <span className="adm-inline">{u.planName}{u.unlimited ? <Badge tone="accent">Unlimited</Badge> : null}</span> },
                { key: "balance", label: "Balance", align: "right", render: (u) => (u.unlimited ? "∞" : u.balance === null ? <span className="adm-muted">—</span> : <span className={u.balance <= 0 ? "adm-bad-text" : undefined}>{fmt.tokens(u.balance)}</span>) },
                { key: "used", label: "Used (30d)", align: "right", render: (u) => fmt.tokens(u.tokens30d) },
                { key: "channels", label: "Channels", align: "right", render: (u) => fmt.number(u.channels) },
                { key: "seen", label: "Last active", render: (u) => <span className="adm-muted">{fmt.ago(u.lastSeenAt)}</span> },
                { key: "status", label: "Status", render: (u) => <Badge>{u.status}</Badge> },
              ]}
            />
            <Pager offset={offset} limit={50} total={query.data.total} count={query.data.users.length} onChange={setOffset} />
          </>
        )}
      </Card>
      <UserDrawer
        userId={route.id}
        admin={admin}
        plans={plans.data?.plans || []}
        onClose={() => navigate("/admin/users")}
        onChanged={query.reload}
        navigate={navigate}
      />
    </Page>
  );
}

type Detail = {
  user: { id: string; email: string; name: string; avatarUrl: string; status: string; statusReason: string; createdAt: string; lastSeenAt: string | null };
  billing: { planId: string; planName: string; priceCents: number; monthlyTokens: number; allowanceRemaining: number; bonusBalance: number; balance: number; unlimited: boolean; status: string; periodEnd: string; periodUsed: number; notes: string } | null;
  counts: Record<string, number>;
  channels: Array<{ id: string; platform: string; title: string; handle: string; thumbnailUrl: string; connectedAt: string }>;
  usageByDay: Array<{ day: string; tokens: number }>;
  usageByFeature: Array<{ feature: string; operation: string; tokens: number; calls: number }>;
  ledger: Array<{ id: string; kind: string; tokens: number; balanceAfter: number; actor: string; note: string; createdAt: string }>;
  tickets: Array<{ id: string; subject: string; status: string; priority: string; lastMessageAt: string }>;
  agents: Array<{ id: string; name: string; status: string; lastRunAt: string | null; nextRunAt: string | null }>;
};

export function UserDrawer({ userId, admin, plans, onClose, onChanged, navigate }: { userId: string; admin: PageProps["admin"]; plans: Plan[]; onClose: () => void; onChanged: () => void; navigate: PageProps["navigate"] }) {
  const query = useAdminQuery<Detail>(userId ? `/api/admin/users/${encodeURIComponent(userId)}` : null);
  const [busy, setBusy] = useState("");
  const [grant, setGrant] = useState({ tokens: "", note: "" });
  const [planId, setPlanId] = useState("");
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => {
    setGrant({ tokens: "", note: "" });
    setPlanId("");
    setReason("");
  }, [userId]);

  const act = async (key: string, path: string, body: unknown, success: string) => {
    setBusy(key);
    try {
      await adminFetch(path, { method: "POST", body });
      toast.success(success);
      await query.reload();
      onChanged();
      return true;
    } catch (error) {
      toast.error(error);
      return false;
    } finally {
      setBusy("");
    }
  };

  const d = query.data;
  const billingOk = can(admin, "billing.manage");
  const usersOk = can(admin, "users.manage");
  return (
    <Drawer
      open={Boolean(userId)}
      onClose={onClose}
      title={d ? <Person name={d.user.name} email={d.user.email} avatarUrl={d.user.avatarUrl} /> : "User"}
    >
      {query.error && !d ? <ErrorState message={query.error} onRetry={query.reload} /> : !d ? <Loading label="Loading user" /> : (
        <div className="adm-stack">
          {d.user.status === "suspended" ? (
            <div className="adm-banner is-bad" role="status">
              <strong>Suspended.</strong> {d.user.statusReason || "No reason recorded."}
            </div>
          ) : null}
          <div className="adm-stats is-compact">
            <Stat label="Balance" value={d.billing?.unlimited ? "Unlimited" : fmt.tokens(d.billing?.balance)} hint={d.billing ? `renews ${fmt.date(d.billing.periodEnd)}` : undefined} />
            <Stat label="Used this period" value={fmt.tokens(d.billing?.periodUsed)} hint={d.billing ? `of ${fmt.tokens(d.billing.monthlyTokens)} allowance` : undefined} />
            <Stat label="Cost (30d)" value={fmt.usd(d.counts.cost30d)} hint={`${fmt.tokens(d.counts.tokensAllTime)} tokens all time`} />
          </div>
          <dl className="adm-facts">
            <div><dt>Plan</dt><dd>{d.billing?.planName || "—"} {d.billing?.priceCents ? <span className="adm-muted">{fmt.cents(d.billing.priceCents)}/mo</span> : null}</dd></div>
            <div><dt>Joined</dt><dd>{fmt.date(d.user.createdAt)}</dd></div>
            <div><dt>Last active</dt><dd>{fmt.ago(d.user.lastSeenAt)}</dd></div>
            <div><dt>Signed-in devices</dt><dd>{fmt.number(d.counts.sessions)}</dd></div>
            <div><dt>Projects</dt><dd>{fmt.number(d.counts.projects)}</dd></div>
            <div><dt>Automation agents</dt><dd>{fmt.number(d.counts.activeAgents)} live of {fmt.number(d.counts.agents)}</dd></div>
            <div><dt>Uploads</dt><dd>{fmt.number(d.counts.uploads)}</dd></div>
            <div><dt>User id</dt><dd><code>{d.user.id}</code></dd></div>
          </dl>

          <Card title="Token usage, last 30 days">
            <BarChart label="Tokens per day" data={d.usageByDay.map((x) => ({ label: x.day, value: Number(x.tokens) }))} format={fmt.tokens} height={120} />
            {d.usageByFeature.length ? (
              <ul className="adm-list is-dense">
                {d.usageByFeature.map((f) => (
                  <li key={`${f.feature}-${f.operation}`}>
                    <span className="adm-list-main"><code>{f.feature || "unknown"}</code><small>{f.operation} · {fmt.number(f.calls)} calls</small></span>
                    <span>{fmt.tokens(f.tokens)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          {billingOk ? (
            <Card title="Billing">
              <div className="adm-form-grid">
                <Field label="Plan">
                  {(id) => (
                    <div className="adm-inline-form">
                      <select id={id} className="adm-select" value={planId || d.billing?.planId || ""} onChange={(event) => setPlanId(event.target.value)}>
                        {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {fmt.tokens(p.monthlyTokens)}/mo{p.active ? "" : " (retired)"}</option>)}
                      </select>
                      <Button size="sm" variant="primary" disabled={!planId || planId === d.billing?.planId} loading={busy === "plan"}
                        onClick={() => act("plan", `/api/admin/users/${d.user.id}/plan`, { planId }, "Plan changed. The allowance was reset to the new plan.").then((ok) => ok && setPlanId(""))}>
                        Change
                      </Button>
                    </div>
                  )}
                </Field>
                <Field label="Grant or remove tokens" hint="Bonus tokens don't expire. Use a negative number to remove.">
                  {(id) => (
                    <div className="adm-inline-form">
                      <input id={id} className="adm-input" inputMode="numeric" placeholder="Tokens" value={grant.tokens} onChange={(event) => setGrant({ ...grant, tokens: event.target.value.replace(/[^\d-]/g, "") })} />
                      <input className="adm-input" placeholder="Reason (shown in the ledger)" aria-label="Reason" value={grant.note} onChange={(event) => setGrant({ ...grant, note: event.target.value })} />
                      <Button size="sm" variant="primary" disabled={!Number(grant.tokens) || !grant.note.trim()} loading={busy === "grant"}
                        onClick={() => act("grant", `/api/admin/users/${d.user.id}/tokens`, { tokens: Number(grant.tokens), note: grant.note }, Number(grant.tokens) > 0 ? "Tokens added." : "Tokens removed.").then((ok) => ok && setGrant({ tokens: "", note: "" }))}>
                        Apply
                      </Button>
                    </div>
                  )}
                </Field>
              </div>
              <Toggle
                label="Unlimited tokens"
                description="Usage is still recorded, but this account is never blocked. Use for staff and partners."
                checked={Boolean(d.billing?.unlimited)}
                disabled={busy === "unlimited"}
                onChange={(value) => void act("unlimited", `/api/admin/users/${d.user.id}/billing`, { unlimited: value }, value ? "Unlimited tokens on." : "Unlimited tokens off.")}
              />
            </Card>
          ) : null}

          <Card title="Token ledger" flush>
            {d.ledger.length ? (
              <ul className="adm-list is-dense">
                {d.ledger.map((l) => (
                  <li key={l.id}>
                    <span className="adm-list-main"><span>{l.note || l.kind.replace(/_/g, " ")}</span><small>{l.actor} · {fmt.dateTime(l.createdAt)}</small></span>
                    <span className={l.tokens < 0 ? "adm-bad-text" : "adm-good-text"}>{l.tokens > 0 ? "+" : ""}{fmt.tokens(l.tokens)}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty title="No ledger entries yet">Grants, plan changes and monthly renewals appear here.</Empty>}
          </Card>

          <Card title="Connected channels" flush>
            {d.channels.length ? (
              <ul className="adm-list is-dense">
                {d.channels.map((c) => (
                  <li key={c.id}>
                    <span className="adm-list-main"><span>{c.title}</span><small>{c.platform}{c.handle ? ` · ${c.handle}` : ""}</small></span>
                    <span className="adm-muted">{fmt.date(c.connectedAt)}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty title="No channels connected" />}
          </Card>

          <Card title="Automation agents" flush action={usersOk && d.counts.activeAgents > 0 ? (
            <Button size="sm" loading={busy === "pause"} onClick={() => act("pause", `/api/admin/users/${d.user.id}/agents/pause`, {}, "All agents paused.")}>Pause all</Button>
          ) : null}>
            {d.agents.length ? (
              <ul className="adm-list is-dense">
                {d.agents.map((a) => (
                  <li key={a.id}>
                    <span className="adm-list-main"><span>{a.name}</span><small>Last run {fmt.ago(a.lastRunAt)}</small></span>
                    <span className="adm-inline">
                      <Badge>{a.status}</Badge>
                      {usersOk && a.status === "active" ? <Button size="sm" variant="ghost" onClick={() => act(`pause-${a.id}`, `/api/admin/users/${d.user.id}/agents/pause`, { agentId: a.id }, `${a.name} paused.`)}>Pause</Button> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <Empty title="No automation agents" />}
          </Card>

          {d.tickets.length ? (
            <Card title="Support requests" flush>
              <ul className="adm-list is-dense">
                {d.tickets.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="adm-link is-plain adm-list-main" onClick={() => navigate(`/admin/support/${t.id}`)}><span>{t.subject}</span><small>{fmt.ago(t.lastMessageAt)}</small></button>
                    <Badge>{t.status}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {usersOk ? (
            <Card title="Access">
              <div className="adm-actions-row">
                <Button loading={busy === "sessions"} disabled={!d.counts.sessions} onClick={() => act("sessions", `/api/admin/users/${d.user.id}/sessions/revoke`, {}, "Signed out everywhere.")}>Sign out everywhere</Button>
                {d.user.status === "suspended" ? (
                  <Button variant="primary" loading={busy === "restore"} onClick={() => act("restore", `/api/admin/users/${d.user.id}/status`, { status: "active" }, "Account restored.")}>Restore account</Button>
                ) : (
                  <Button variant="danger" onClick={() => setSuspendOpen(true)}>Suspend account</Button>
                )}
              </div>
            </Card>
          ) : null}
        </div>
      )}
      <Modal
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        title={`Suspend ${d?.user.name || d?.user.email || "this user"}?`}
        actions={<>
          <Button onClick={() => setSuspendOpen(false)}>Cancel</Button>
          <Button variant="danger" disabled={!reason.trim()} loading={busy === "suspend"}
            onClick={() => d && act("suspend", `/api/admin/users/${d.user.id}/status`, { status: "suspended", reason }, "Account suspended.").then((ok) => ok && setSuspendOpen(false))}>
            Suspend
          </Button>
        </>}
      >
        <p>They're signed out on every device and can't use AutoYT until you restore the account. Their running AI jobs stop at the next call.</p>
        <Field label="Reason" hint="The user sees this if they contact support.">
          {(id) => <textarea id={id} className="adm-input" rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Repeated uploads of copyrighted films" />}
        </Field>
      </Modal>
    </Drawer>
  );
}
