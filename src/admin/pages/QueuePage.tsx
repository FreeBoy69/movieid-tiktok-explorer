import { useState } from "react";
import { adminFetch, can, fmt } from "../api";
import { toast } from "../../utils/toast";
import { BackLink, Badge, Button, Card, DataTable, DetailHeader, Empty, Guarded, Modal, Pager, Person, Segmented, Stat, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";

type Job = { id: string; kind: string; status: string; attempts?: number; maxAttempts?: number; error: string; message: string; progress: number; workerId?: string; createdAt: string; startedAt?: string; finishedAt?: string; updatedAt?: string; projectTitle?: string; userId: string | null; email: string | null; name: string | null };

const STATUSES: Record<string, Array<{ value: string; label: string }>> = {
  media: [{ value: "", label: "All" }, { value: "queued", label: "Queued" }, { value: "running", label: "Running" }, { value: "failed", label: "Failed" }, { value: "done", label: "Done" }, { value: "cancelled", label: "Cancelled" }],
  creator: [{ value: "", label: "All" }, { value: "queued", label: "Queued" }, { value: "running", label: "Running" }, { value: "failed", label: "Failed" }, { value: "ready", label: "Done" }],
};

export function QueuePage({ admin, route, navigate }: PageProps) {
  const queue = route.id === "creator" ? "creator" : "media";
  const kind = route.sub;
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const query = useAdminQuery<{ jobs: Job[]; counts: Record<string, number> }>(`/api/admin/queues/${queue}?kind=${encodeURIComponent(kind)}&status=${status}&limit=50&offset=${offset}`);
  const [confirm, setConfirm] = useState<"" | "retry_failed" | "cancel_queued">("");
  const [busy, setBusy] = useState("");
  const manage = can(admin, "users.manage");
  const counts = query.data?.counts || {};
  const detailType = queue === "media" ? "media" : "job";

  const bulk = async () => {
    setBusy("bulk");
    try {
      const result = await adminFetch<{ affected: number }>(`/api/admin/queues/${queue}/bulk`, { method: "POST", body: { action: confirm, kind } });
      toast.success(`${fmt.number(result.affected)} jobs updated.`);
      setConfirm("");
      query.reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy("");
    }
  };
  const one = async (job: Job, action: "retry" | "cancel") => {
    setBusy(job.id);
    try {
      const path = queue === "media" ? `/api/admin/jobs/${job.id}/${action}` : `/api/admin/creator-jobs/${job.id}/${action}`;
      await adminFetch(path, { method: "POST", body: {} });
      toast.success(action === "retry" ? "Queued again." : "Cancelled.");
      query.reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="adm-page">
      <BackLink label="System" onClick={() => navigate("/admin/system")} />
      <DetailHeader
        title={kind ? `${kind.charAt(0).toUpperCase()}${kind.slice(1)} jobs` : `${queue === "media" ? "Media" : "Creator"} jobs`}
        subtitle={queue === "media" ? "Downloads, transcription and rendering run by the media workers." : "Create Video stages run by the creator worker."}
        actions={manage ? <>
          {queue === "media" && counts.failed ? <Button onClick={() => setConfirm("retry_failed")}>Retry failed (7d)</Button> : null}
          {counts.queued ? <Button variant="danger" onClick={() => setConfirm("cancel_queued")}>Cancel all queued</Button> : null}
        </> : null}
      />
      <div className="adm-stats is-4">
        <Stat label="Queued" value={fmt.number(counts.queued)} />
        <Stat label="Running" value={fmt.number(counts.running)} />
        <Stat label="Failed" value={fmt.number(counts.failed)} />
        <Stat label="Done" value={fmt.number(n(counts.done) + n(counts.ready))} hint={counts.cancelled ? `${fmt.number(counts.cancelled)} cancelled` : undefined} />
      </div>
      <div className="adm-toolbar is-scroll">
        <Segmented label="Status" value={status} onChange={(v) => { setStatus(v); setOffset(0); }} options={STATUSES[queue]} />
        <Button size="sm" onClick={query.reload}>Refresh</Button>
      </div>
      <Card flush>
        <Guarded query={query} label="Loading jobs">
          {({ jobs }) => (
            <>
              <DataTable
                rowKey={(j) => j.id}
                rows={jobs}
                onRowClick={(j) => navigate(`/admin/activity/${detailType}/${j.id}`)}
                empty={<Empty title="No jobs match" />}
                columns={[
                  { key: "job", label: "Job", render: (j) => <span className="adm-list-main"><strong>{j.kind}</strong><small>{j.projectTitle || (j.attempts !== undefined ? `attempt ${j.attempts} of ${j.maxAttempts}` : "")}</small></span> },
                  { key: "user", label: "User", render: (j) => (j.email ? <Person name={j.name || undefined} email={j.email} /> : <span className="adm-muted">—</span>) },
                  { key: "status", label: "Status", render: (j) => <Badge>{j.status}</Badge> },
                  { key: "detail", label: "Detail", render: (j) => <span className={j.error ? "adm-error-text adm-clip" : "adm-muted adm-clip"}>{j.error || j.message || "—"}</span> },
                  { key: "when", label: "Created", render: (j) => <span className="adm-muted">{fmt.dateTime(j.createdAt)}</span> },
                  {
                    key: "x", label: "", align: "right", render: (j) => (!manage ? null
                      : ["failed", "cancelled"].includes(j.status) && (queue === "media" || j.status === "failed") ? <Button size="sm" variant="ghost" loading={busy === j.id} onClick={() => one(j, "retry")}>Retry</Button>
                        : ["queued", "running"].includes(j.status) ? <Button size="sm" variant="ghost" loading={busy === j.id} onClick={() => one(j, "cancel")}>Cancel</Button> : null),
                  },
                ]}
              />
              <Pager offset={offset} limit={50} count={jobs.length} onChange={setOffset} />
            </>
          )}
        </Guarded>
      </Card>
      <Modal open={Boolean(confirm)} onClose={() => setConfirm("")} title={confirm === "retry_failed" ? "Retry every failed job?" : "Cancel every queued job?"}
        actions={<><Button onClick={() => setConfirm("")}>Keep them</Button><Button variant={confirm === "cancel_queued" ? "danger" : "primary"} loading={busy === "bulk"} onClick={bulk}>{confirm === "retry_failed" ? "Retry all" : "Cancel all"}</Button></>}>
        <p>{confirm === "retry_failed"
          ? `${fmt.number(counts.failed)} failed ${kind || queue} jobs from the last 7 days go back in the queue. Retries can cost tokens again.`
          : `${fmt.number(counts.queued)} queued ${kind || queue} jobs are cancelled. Users see them as cancelled and can start them again.`}</p>
      </Modal>
    </div>
  );
}

const n = (v: unknown) => Number(v) || 0;
