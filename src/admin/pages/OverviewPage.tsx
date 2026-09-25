import { AlertTriangle } from "lucide-react";
import { fmt } from "../api";
import { BarChart, Card, Empty, Guarded, Page, Person, RankBars, Stat, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";

type Overview = {
  totals: Record<string, number>;
  series: Array<{ day: string; tokens: number; cost: number; signups: number }>;
  topUsers: Array<{ id: string; email: string; name: string; avatarUrl: string; tokens: number; cost: number; calls: number }>;
  signups: Array<{ id: string; email: string; name: string; avatarUrl: string; createdAt: string }>;
  audit: Array<{ adminEmail: string; action: string; targetType: string; targetId: string; createdAt: string }>;
};

export function OverviewPage({ navigate }: PageProps) {
  const query = useAdminQuery<Overview>("/api/admin/overview");
  return (
    <Page title="Overview" description="How AutoYT is doing over the last 30 days.">
      <Guarded query={query} label="Loading overview">
        {({ totals: t, series, topUsers, signups, audit }) => {
          const margin = (t.mrrCents / 100) - t.cost30d;
          return (
            <>
              {t.jobsFailed24h > 0 || t.openTickets > 0 ? (
                <div className="adm-callouts">
                  {t.openTickets > 0 ? (
                    <button type="button" className="adm-callout" onClick={() => navigate("/admin/support")}>
                      <strong>{fmt.number(t.openTickets)}</strong> support {t.openTickets === 1 ? "request needs" : "requests need"} a reply
                    </button>
                  ) : null}
                  {t.jobsFailed24h > 0 ? (
                    <button type="button" className="adm-callout is-bad" onClick={() => navigate("/admin/system")}>
                      <AlertTriangle size={15} aria-hidden="true" /><strong>{fmt.number(t.jobsFailed24h)}</strong> jobs failed in the last 24 hours
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="adm-stats">
                <Stat label="Users" value={fmt.number(t.users)} delta={fmt.delta(t.newUsers7d, t.newUsersPrev7d)} hint={`${fmt.number(t.newUsers7d)} new this week`} />
                <Stat label="Active this week" value={fmt.number(t.activeUsers7d)} hint={t.users ? `${Math.round((t.activeUsers7d / t.users) * 100)}% of users` : undefined} />
                <Stat label="Plan revenue (MRR)" value={fmt.cents(t.mrrCents)} hint={`${fmt.number(t.paidSubscribers)} paid accounts`} />
                <Stat label="Credits used" value={fmt.credits(t.tokens30d)} delta={fmt.delta(t.tokens30d, t.tokensPrev30d)} hint={`${fmt.number(t.calls30d)} AI calls`} />
                <Stat label="Provider cost" value={fmt.usd(t.cost30d)} delta={fmt.delta(t.cost30d, t.costPrev30d)} invertDelta hint={`${margin >= 0 ? "+" : "−"}${fmt.usd(Math.abs(margin))} vs plan revenue`} />
                <Stat label="Automation" value={fmt.number(t.activeAgents)} hint={`agents live · ${fmt.number(t.uploads7d)} uploads this week`} />
              </div>
              <div className="adm-grid is-2-1">
                  <Card title="Credits charged per day">
                    <BarChart label="Credits charged per day" data={series.map((d) => ({ label: d.day, value: Number(d.tokens) }))} format={fmt.credits} />
                </Card>
                <Card title="Heaviest users" action={<button type="button" className="adm-link" onClick={() => navigate("/admin/usage")}>All usage</button>}>
                  <RankBars
                    format={fmt.credits}
                    items={topUsers.map((u) => ({ key: u.id, value: Number(u.tokens), label: <button type="button" className="adm-link is-plain" onClick={() => navigate(`/admin/users/${u.id}`)}>{u.name || u.email}</button>, sub: `${fmt.usd(u.cost)} cost` }))}
                  />
                </Card>
              </div>
              <div className="adm-grid is-2">
                <Card title="Newest users" action={<button type="button" className="adm-link" onClick={() => navigate("/admin/users")}>All users</button>} flush>
                  {signups.length ? (
                    <ul className="adm-list">
                      {signups.map((u) => (
                        <li key={u.id}>
                          <Person name={u.name} email={u.email} avatarUrl={u.avatarUrl} onClick={() => navigate(`/admin/users/${u.id}`)} />
                          <span className="adm-muted">{fmt.ago(u.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <Empty title="No users yet" />}
                </Card>
                <Card title="Recent admin actions" action={<button type="button" className="adm-link" onClick={() => navigate("/admin/team")}>Audit log</button>} flush>
                  {audit.length ? (
                    <ul className="adm-list">
                      {audit.map((a, index) => (
                        <li key={`${a.createdAt}-${index}`}>
                          <span className="adm-list-main"><code>{a.action}</code><small>{a.adminEmail}</small></span>
                          <span className="adm-muted">{fmt.ago(a.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <Empty title="No admin actions yet">Changes you make here show up in this list.</Empty>}
                </Card>
              </div>
            </>
          );
        }}
      </Guarded>
    </Page>
  );
}
