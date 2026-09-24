import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { adminFetch, can, fmt } from "../api";
import { toast } from "../../utils/toast";
import { Avatar, BackLink, Badge, Button, Card, DetailHeader, ErrorState, Facts, JsonView, Loading, Stat, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";

type Detail = {
  type: string; ref: string;
  record: Record<string, any>;
  user: { id: string; email: string; name: string; avatarUrl: string } | null;
  agent: { id: string; name: string; status: string } | null;
};

const TITLES: Record<string, string> = { media: "Media job", job: "Creator job", automation: "Automation run", upload: "Upload", project: "Project" };
const cap = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);
const duration = (from?: string, to?: string) => {
  if (!from || !to) return "—";
  const seconds = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};

export function ActivityDetailPage({ admin, route, navigate }: PageProps) {
  const type = route.id;
  const ref = route.sub;
  // Tickets and sign-ups already have richer pages.
  useEffect(() => {
    if (type === "ticket") navigate(`/admin/support/${ref}`, { replace: true });
    if (type === "signup") navigate(`/admin/users/${ref}`, { replace: true });
  }, [type, ref, navigate]);
  const query = useAdminQuery<Detail>(TITLES[type] ? `/api/admin/activity/${type}/${encodeURIComponent(ref)}` : null);
  const [busy, setBusy] = useState("");
  const back = <BackLink label="Activity" onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/admin/activity"))} />;
  if (!TITLES[type]) return <div className="adm-page">{back}<Loading /></div>;
  if (query.error && !query.data) return <div className="adm-page">{back}<ErrorState message={query.error} onRetry={query.reload} /></div>;
  if (!query.data) return <div className="adm-page">{back}<Loading label={`Loading ${TITLES[type].toLowerCase()}`} /></div>;
  const { record: r, user, agent } = query.data;
  const manage = can(admin, "users.manage");

  const act = async (key: string, path: string, message: string) => {
    setBusy(key);
    try {
      await adminFetch(path, { method: "POST", body: {} });
      toast.success(message);
      query.reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy("");
    }
  };

  let title: ReactNode = TITLES[type];
  let facts: Array<[string, ReactNode]> = [];
  let actions: ReactNode = null;
  let stats: ReactNode = null;
  let body: ReactNode = null;

  if (type === "media") {
    title = `${cap(r.kind)} job`;
    facts = [["Status", <Badge key="s">{r.status}</Badge>], ["Attempts", `${r.attempts} of ${r.max_attempts}`], ["Worker", r.worker_id || "—"], ["Progress", `${Math.round(Number(r.progress || 0) * 100)}%`],
      ["Created", fmt.dateTime(r.created_at)], ["Started", fmt.dateTime(r.started_at)], ["Finished", fmt.dateTime(r.finished_at)], ["Run time", duration(r.started_at, r.finished_at || undefined)]];
    if (manage) actions = <>
      {["failed", "cancelled"].includes(r.status) ? <Button variant="primary" loading={busy === "retry"} onClick={() => act("retry", `/api/admin/jobs/${r.id}/retry`, "Job queued again.")}>Retry job</Button> : null}
      {["queued", "running"].includes(r.status) ? <Button variant="danger" loading={busy === "cancel"} onClick={() => act("cancel", `/api/admin/jobs/${r.id}/cancel`, "Job cancelled.")}>Cancel job</Button> : null}
    </>;
    body = <>
      {r.error ? <Card title="Error"><p className="adm-error-text adm-prewrap">{r.error}</p></Card> : null}
      {r.message ? <Card title="Last message"><p className="adm-prewrap">{r.message}</p></Card> : null}
      <Card title="Input"><pre className="adm-pre">{JSON.stringify(r.params, null, 2)}</pre></Card>
      {r.result ? <Card title="Result"><pre className="adm-pre">{JSON.stringify(r.result, null, 2)}</pre></Card> : null}
    </>;
  } else if (type === "job") {
    title = `${cap(r.stage)} stage`;
    facts = [["Status", <Badge key="s">{r.status}</Badge>], ["Progress", `${r.progress}%`], ["Project", r.project_id ? <code key="p">{r.project_id}</code> : "—"], ["Created", fmt.dateTime(r.created_at)], ["Last update", fmt.dateTime(r.updated_at)], ["Run time", duration(r.created_at, r.updated_at)]];
    if (manage) actions = <>
      {r.status === "failed" ? <Button variant="primary" loading={busy === "retry"} onClick={() => act("retry", `/api/admin/creator-jobs/${r.id}/retry`, "Stage queued again.")}>Retry stage</Button> : null}
      {["queued", "running"].includes(r.status) ? <Button variant="danger" loading={busy === "cancel"} onClick={() => act("cancel", `/api/admin/creator-jobs/${r.id}/cancel`, "Stage cancelled.")}>Cancel stage</Button> : null}
    </>;
    body = <>
      {r.error ? <Card title="Error"><p className="adm-error-text adm-prewrap">{r.error}</p></Card> : null}
      {r.message ? <Card title="Last message"><p className="adm-prewrap">{r.message}</p></Card> : null}
      <Card title="Input"><pre className="adm-pre">{JSON.stringify(r.payload, null, 2)}</pre></Card>
    </>;
  } else if (type === "automation") {
    title = agent?.name ? `${agent.name} run` : "Automation run";
    facts = [["Status", <Badge key="s">{r.status}</Badge>], ["Agent status", agent ? <Badge key="a">{agent.status}</Badge> : "—"], ["Started", fmt.dateTime(r.started_at)], ["Finished", fmt.dateTime(r.finished_at)], ["Run time", duration(r.started_at, r.finished_at || undefined)]];
    if (manage && agent?.status === "active" && user) actions = <Button loading={busy === "pause"} onClick={async () => {
      setBusy("pause");
      try {
        await adminFetch(`/api/admin/users/${user.id}/agents/pause`, { method: "POST", body: { agentId: agent.id } });
        toast.success("Agent paused.");
        query.reload();
      } catch (error) {
        toast.error(error);
      } finally {
        setBusy("");
      }
    }}>Pause this agent</Button>;
    body = <>
      {r.message ? <Card title="Result"><p className="adm-prewrap">{r.message}</p></Card> : null}
      <Card title="Run details"><pre className="adm-pre">{JSON.stringify(r.details, null, 2)}</pre></Card>
    </>;
  } else if (type === "upload") {
    const stats0 = r.metrics?.publicStats || {};
    title = r.title || r.movie_title || "Upload";
    stats = <div className="adm-stats is-4">
      <Stat label="Views" value={fmt.number(stats0.viewCount)} />
      <Stat label="Likes" value={fmt.number(stats0.likeCount)} />
      <Stat label="Comments" value={fmt.number(stats0.commentCount)} />
      <Stat label="Learning score" value={r.metrics?.learningScore != null ? Number(r.metrics.learningScore).toFixed(2) : "—"} />
    </div>;
    facts = [["Status", <Badge key="s">{r.status}</Badge>], ["Agent", agent?.name || "—"], ["Movie", [r.movie_title, r.movie_year].filter(Boolean).join(" · ") || "—"], ["Genre", r.genre || "—"],
      ["Uploaded", fmt.dateTime(r.created_at)], ["Scheduled for", fmt.dateTime(r.schedule_at)], ["Uploaded via", r.metrics?.uploadVia || "YouTube"], ["Source author", r.source_author || "—"]];
    actions = <>
      {/^https:\/\//.test(r.youtube_url || "") ? <a className="adm-btn is-primary" href={r.youtube_url} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" /> Open video</a> : null}
      {/^https:\/\//.test(r.source_url || "") ? <a className="adm-btn" href={r.source_url} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" /> Open source</a> : null}
    </>;
    body = <>
      {r.description ? <Card title="Description"><p className="adm-prewrap">{r.description}</p></Card> : null}
      {r.metrics?.movie?.summary ? <Card title="What the video is about"><p className="adm-prewrap">{r.metrics.movie.summary}</p></Card> : null}
    </>;
  } else if (type === "project") {
    const outputs = Object.entries(r.outputs || {}) as Array<[string, any]>;
    title = r.title || "Untitled project";
    facts = [["Stage", r.stage], ["Status", <Badge key="s">{r.archived_at ? "archived" : r.status}</Badge>], ["Source", String(r.source_type || "").replace(/_/g, " ")], ["Version", r.version ?? "—"],
      ["Created", fmt.dateTime(r.created_at)], ["Last edit", fmt.dateTime(r.updated_at)]];
    body = <Card title="Stages with output" flush>
      {outputs.length ? (
        <ul className="adm-list is-dense">
          {outputs.map(([stage, value]) => (
            <li key={stage}>
              <span className="adm-list-main"><span>{stage}</span><small>{value?.generatedAt ? `generated ${fmt.ago(value.generatedAt).toLowerCase()}` : ""}</small></span>
              {value?.stale ? <Badge tone="warn">Out of date</Badge> : <Badge tone="good">Current</Badge>}
            </li>
          ))}
        </ul>
      ) : <p className="adm-help adm-pad">Nothing generated yet.</p>}
    </Card>;
  }

  return (
    <div className="adm-page">
      {back}
      <DetailHeader
        title={title}
        subtitle={TITLES[type]}
        badges={r.status ? <Badge>{r.archived_at ? "archived" : r.status}</Badge> : null}
        meta={<>Id <code>{String(r.id)}</code></>}
        actions={actions}
      />
      {user ? (
        <Card>
          <div className="adm-owner">
            <Avatar src={user.avatarUrl} name={user.name || user.email} size={36} />
            <span className="adm-list-main"><strong>{user.name || user.email}</strong><small>{user.email}</small></span>
            <Button size="sm" onClick={() => navigate(`/admin/users/${user.id}${type === "upload" || type === "automation" ? "/automation" : "/content"}`)}>Open user</Button>
          </div>
        </Card>
      ) : null}
      {stats}
      <Card title="Details"><Facts items={facts} columns={3} /></Card>
      {body}
      <Card><JsonView value={r} /></Card>
    </div>
  );
}
