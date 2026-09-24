import { CheckCircle2, CircleSlash } from "lucide-react";
import { fmt } from "../api";
import { Badge, Button, Card, DataTable, Empty, Guarded, Page, Stat, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";
import { QueuePage } from "./QueuePage";

type System = {
  process: { uptimeSeconds: number; node: string; rssMb: number; heapMb: number };
  queues: Array<{ queue: string; kind: string; status: string; n: number }>;
  failures: Array<{ queue: string; id: string; userId: string; kind: string; error: string; updatedAt: string }>;
  providers?: Record<string, boolean>;
  mediaWorker?: Record<string, unknown>;
  adminEmailsConfigured?: boolean;
};

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "OpenRouter", videorouter: "VideoRouter", gemini: "Gemini", deepseek: "DeepSeek", dashscope: "DashScope (Qwen)", runway: "Runway", googleOAuth: "Google sign-in", database: "Database",
};

const uptime = (seconds: number) => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

export function SystemPage(props: PageProps) {
  return props.route.id ? <QueuePage {...props} /> : <SystemOverview {...props} />;
}

function SystemOverview({ navigate }: PageProps) {
  const query = useAdminQuery<System>("/api/admin/system");
  return (
    <Page title="System" description="Job queues, providers and the server process." actions={<Button size="sm" onClick={query.reload}>Refresh</Button>}>
      <Guarded query={query} label="Loading system status">
        {(s) => {
          const queues = groupQueues(s.queues);
          return (
            <>
              {s.adminEmailsConfigured === false ? <div className="adm-banner is-bad">ADMIN_EMAILS isn't set on the server, so nobody is an owner. Add it to the hosted-app secrets.</div> : null}
              <div className="adm-stats">
                <Stat label="Uptime" value={uptime(s.process.uptimeSeconds)} hint={`restarts on every deploy · Node ${s.process.node}`} />
                <Stat label="Memory" value={`${fmt.number(s.process.rssMb)} MB`} hint={`${fmt.number(s.process.heapMb)} MB heap`} />
                <Stat label="Jobs waiting or running" value={fmt.number(s.queues.filter((q) => ["queued", "running"].includes(q.status)).reduce((sum, q) => sum + Number(q.n), 0))} />
                <Stat label="Failed (7d)" value={fmt.number(s.queues.filter((q) => q.status === "failed").reduce((sum, q) => sum + Number(q.n), 0))} />
              </div>
              <div className="adm-grid is-2">
                <Card title="Providers">
                  <ul className="adm-checks">
                    {Object.entries(s.providers || {}).map(([name, ok]) => (
                      <li key={name}>
                        {ok ? <CheckCircle2 size={16} className="adm-good-text" aria-hidden="true" /> : <CircleSlash size={16} className="adm-muted" aria-hidden="true" />}
                        <span>{PROVIDER_LABELS[name] || name}</span>
                        <span className="adm-muted">{ok ? "Configured" : "Not configured"}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card title="Job queues, last 7 days" flush action={<span className="adm-inline"><button type="button" className="adm-link" onClick={() => navigate("/admin/system/media")}>All media jobs</button><button type="button" className="adm-link" onClick={() => navigate("/admin/system/creator")}>All creator jobs</button></span>}>
                  <DataTable
                    rowKey={(q) => q.key}
                    rows={queues}
                    onRowClick={(q) => navigate(`/admin/system/${q.queue}/${encodeURIComponent(q.kind)}`)}
                    empty={<Empty title="No jobs in the last 7 days" />}
                    columns={[
                      { key: "kind", label: "Job", render: (q) => <span className="adm-list-main"><span>{q.kind}</span><small>{q.queue}</small></span> },
                      { key: "active", label: "Active", align: "right", render: (q) => fmt.number(q.active) },
                      { key: "done", label: "Done", align: "right", render: (q) => fmt.number(q.done) },
                      { key: "failed", label: "Failed", align: "right", render: (q) => <span className={q.failed ? "adm-bad-text" : undefined}>{fmt.number(q.failed)}</span> },
                    ]}
                  />
                </Card>
              </div>
              <Card title="Latest failures" flush>
                <DataTable
                  rowKey={(f) => `${f.queue}-${f.id}`}
                  rows={s.failures}
                  onRowClick={(f) => navigate(`/admin/activity/${f.queue === "media" ? "media" : "job"}/${f.id}`)}
                  empty={<Empty title="No failed jobs" />}
                  columns={[
                    { key: "when", label: "When", render: (f) => <span className="adm-muted">{fmt.dateTime(f.updatedAt)}</span> },
                    { key: "kind", label: "Job", render: (f) => <span className="adm-inline"><Badge tone="neutral">{f.queue}</Badge>{f.kind}</span> },
                    { key: "error", label: "Error", render: (f) => <span className="adm-error-text">{f.error || "No message"}</span> },
                  ]}
                />
              </Card>
              {s.mediaWorker ? (
                <Card title="Media worker">
                  <pre className="adm-pre">{JSON.stringify(s.mediaWorker, null, 2)}</pre>
                </Card>
              ) : null}
            </>
          );
        }}
      </Guarded>
    </Page>
  );
}

function groupQueues(rows: System["queues"]) {
  const map = new Map<string, { key: string; queue: string; kind: string; active: number; done: number; failed: number }>();
  for (const row of rows) {
    const key = `${row.queue}:${row.kind}`;
    const entry = map.get(key) || { key, queue: row.queue, kind: row.kind, active: 0, done: 0, failed: 0 };
    const n = Number(row.n) || 0;
    if (["queued", "running"].includes(row.status)) entry.active += n;
    else if (["failed", "cancelled"].includes(row.status)) entry.failed += n;
    else entry.done += n;
    map.set(key, entry);
  }
  return [...map.values()].sort((a, b) => b.active + b.failed - (a.active + a.failed));
}
