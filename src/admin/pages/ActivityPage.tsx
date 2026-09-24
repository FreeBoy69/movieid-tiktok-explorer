import { useState, type ReactNode } from "react";
import { Bot, Clapperboard, FolderOpen, LifeBuoy, Upload, UserPlus, Workflow } from "lucide-react";
import { adminFetch, can, fmt } from "../api";
import { toast } from "../../utils/toast";
import { Badge, Button, Card, Empty, Guarded, Page, Person, Segmented, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";

type Item = { type: string; ref: string; userId: string; email: string; name: string; avatarUrl: string; title: string; detail: string; status: string; at: string };

const TYPES = [
  { value: "", label: "Everything" },
  { value: "signup", label: "Sign-ups" },
  { value: "project", label: "Projects" },
  { value: "job", label: "Creator jobs" },
  { value: "media", label: "Media jobs" },
  { value: "automation", label: "Automation" },
  { value: "upload", label: "Uploads" },
  { value: "ticket", label: "Support" },
];
const ICONS: Record<string, ReactNode> = {
  signup: <UserPlus size={16} />, project: <FolderOpen size={16} />, job: <Clapperboard size={16} />, media: <Workflow size={16} />,
  automation: <Bot size={16} />, upload: <Upload size={16} />, ticket: <LifeBuoy size={16} />,
};
const VERBS: Record<string, string> = {
  signup: "Signed up", project: "Created a project", job: "Creator stage", media: "Media job", automation: "Automation run", upload: "Uploaded", ticket: "Opened a support request",
};

export function ActivityPage({ admin, navigate }: PageProps) {
  const [type, setType] = useState("");
  return (
    <Page title="Activity" description="What people are doing across AutoYT, newest first.">
      <ActivityFeed admin={admin} navigate={navigate} type={type} onType={setType} />
    </Page>
  );
}

// Shared by the Activity page and the Activity tab of a user's page.
export function ActivityFeed({ admin, navigate, userId = "", type, onType, limit = 120, compact = false }: {
  admin: PageProps["admin"]; navigate: PageProps["navigate"]; userId?: string; type: string; onType?: (type: string) => void; limit?: number; compact?: boolean;
}) {
  const query = useAdminQuery<{ items: Item[] }>(`/api/admin/activity?type=${type}&limit=${limit}${userId ? `&userId=${encodeURIComponent(userId)}` : ""}`);
  const [cancelling, setCancelling] = useState("");
  const cancel = async (item: Item) => {
    setCancelling(item.ref);
    try {
      await adminFetch(`/api/admin/jobs/${item.ref}/cancel`, { method: "POST", body: {} });
      toast.success("Job cancelled.");
      query.reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setCancelling("");
    }
  };
  return (
    <>
      {onType ? (
        <div className="adm-toolbar is-scroll">
          <Segmented label="Activity type" value={type} onChange={onType} options={userId ? TYPES.filter((t) => t.value !== "signup") : TYPES} />
          <Button size="sm" onClick={query.reload}>Refresh</Button>
        </div>
      ) : null}
      <Card flush>
        <Guarded query={query} label="Loading activity">
          {({ items }) => items.length ? (
            <ol className="adm-feed">
              {items.map((item) => (
                <li key={`${item.type}-${item.ref}`}>
                  <span className="adm-feed-icon" aria-hidden="true">{ICONS[item.type]}</span>
                  <div className="adm-feed-body">
                    <div className="adm-feed-line">
                      {userId ? null : item.userId ? <Person name={item.name} email={item.email} avatarUrl={item.avatarUrl} onClick={() => navigate(`/admin/users/${item.userId}`)} /> : <span className="adm-muted">System</span>}
                      <span className="adm-muted">{VERBS[item.type]}</span>
                      {item.type !== "signup" ? <strong className="adm-feed-title">{item.type === "ticket" ? <button type="button" className="adm-link is-plain" onClick={() => navigate(`/admin/support/${item.ref}`)}>{item.title}</button> : item.title}</strong> : null}
                    </div>
                    {item.detail && item.type !== "signup" && !compact ? (
                      item.type === "upload" && /^https:\/\//.test(item.detail)
                        ? <a className="adm-feed-detail adm-link" href={item.detail} target="_blank" rel="noreferrer">{item.detail}</a>
                        : <p className="adm-feed-detail">{item.detail}</p>
                    ) : null}
                  </div>
                  <div className="adm-feed-side">
                    {item.type !== "signup" ? <Badge>{item.status}</Badge> : null}
                    {item.type === "media" && ["queued", "running"].includes(item.status) && can(admin, "users.manage") ? (
                      <Button size="sm" variant="ghost" loading={cancelling === item.ref} onClick={() => cancel(item)}>Cancel</Button>
                    ) : null}
                    <time className="adm-muted" dateTime={item.at} title={fmt.dateTime(item.at)}>{fmt.ago(item.at)}</time>
                  </div>
                </li>
              ))}
            </ol>
          ) : <Empty title="Nothing has happened yet" />}
        </Guarded>
      </Card>
    </>
  );
}
