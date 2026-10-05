import { useEffect, useState } from "react";
import { Download, Search } from "lucide-react";
import { fmt } from "../api";
import { Badge, Button, Card, DataTable, Empty, ErrorState, Loading, Page, Pager, Person, Segmented, useAdminQuery } from "../ui";
import { downloadCsv } from "../charts";
import { GrowthInsights } from "../sections";
import { UserDetailPage } from "./UserDetailPage";
import type { PageProps } from "../AdminApp";

type UserRow = { id: string; email: string; name: string; avatarUrl: string; status: string; createdAt: string; lastSeenAt: string | null; planName: string; planId: string; unlimited: boolean; balance: number | null; tokens30d: number; channels: number };
type Plan = { id: string; name: string; priceCents: number; monthlyTokens: number; active: boolean };

export function UsersPage(props: PageProps) {
  return props.route.id ? <UserDetailPage {...props} /> : <UserList {...props} />;
}

function UserList({ navigate }: PageProps) {
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
    <Page title="Users" description="Everyone who has signed in to AutoYT. Open someone to manage their plan, credits and access.">
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
          <option value="usage">Most credits (30d)</option>
          <option value="name">Name</option>
        </select>
        <Button size="sm" variant="ghost" disabled={!query.data?.users.length}
          onClick={() => downloadCsv(`autoyt-users-${new Date().toISOString().slice(0, 10)}.csv`, (query.data?.users || []).map((u) => ({
            id: u.id, email: u.email, name: u.name, status: u.status, plan: u.planName, unlimited: u.unlimited, credits: u.balance, used30d: u.tokens30d, channels: u.channels, createdAt: u.createdAt, lastSeenAt: u.lastSeenAt,
          })))}>
          <Download size={14} aria-hidden="true" />Export page
        </Button>
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
                { key: "balance", label: "Credits", align: "right", render: (u) => (u.unlimited ? "∞" : u.balance === null ? <span className="adm-muted">—</span> : <span className={u.balance <= 0 ? "adm-bad-text" : undefined}>{fmt.credits(u.balance)}</span>) },
                { key: "used", label: "Used (30d)", align: "right", render: (u) => fmt.credits(u.tokens30d) },
                { key: "channels", label: "Channels", align: "right", render: (u) => fmt.number(u.channels) },
                { key: "seen", label: "Last active", render: (u) => <span className="adm-muted">{fmt.ago(u.lastSeenAt)}</span> },
                { key: "status", label: "Status", render: (u) => <Badge>{u.status}</Badge> },
              ]}
            />
            <Pager offset={offset} limit={50} total={query.data.total} count={query.data.users.length} onChange={setOffset} />
          </>
        )}
      </Card>
      <GrowthInsights />
    </Page>
  );
}
