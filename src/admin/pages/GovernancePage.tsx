import { useState } from "react";
import { adminFetch, can } from "../api";
import { toast } from "../../utils/toast";
import { Button, Card, cx, Field, Guarded, Modal, Page, Toggle, useAdminQuery } from "../ui";
import type { PageProps } from "../AdminApp";

type Governance = {
  aiEnabled: boolean;
  signupsOpen: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  disabledProviders: string[];
  blockedModels: string[];
  announcement: { active: boolean; tone: "info" | "warning" | "success"; text: string };
};

const PROVIDER_NOTES: Record<string, string> = {
  openrouter: "Chat, images, video, voices and music",
  videorouter: "Image and video jobs, tried before OpenRouter",
  gemini: "Movie ID and multimodal fallback",
  deepseek: "Script writing fallback",
  dashscope: "Qwen movie ID and agent chat",
  runway: "Runway video generation",
};

export function GovernancePage({ admin }: PageProps) {
  const query = useAdminQuery<{ governance: Governance; providers: string[] }>("/api/admin/settings");
  return (
    <Page title="Governance" description="Switches that change what every user can do. Changes apply within 15 seconds and are recorded in the audit log.">
      <Guarded query={query} label="Loading settings">
        {({ governance, providers }) => <GovernanceForm initial={governance} providers={providers} canEdit={can(admin, "settings.manage")} onSaved={query.reload} />}
      </Guarded>
    </Page>
  );
}

function GovernanceForm({ initial, providers, canEdit, onSaved }: { initial: Governance; providers: string[]; canEdit: boolean; onSaved: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  // Turning off AI or turning on maintenance affects every user at once; ask first.
  const risky = (!draft.aiEnabled && initial.aiEnabled) || (draft.maintenanceMode && !initial.maintenanceMode) || (!draft.signupsOpen && initial.signupsOpen);
  const save = async () => {
    setSaving(true);
    try {
      await adminFetch("/api/admin/settings/governance", { method: "PUT", body: draft });
      toast.success("Saved. Users see the change within 15 seconds.");
      setConfirm(false);
      onSaved();
    } catch (error) {
      toast.error(error);
    } finally {
      setSaving(false);
    }
  };
  const set = (patch: Partial<Governance>) => setDraft({ ...draft, ...patch });
  return (
    <>
      <div className="adm-savebar" data-visible={dirty || undefined}>
        <span>{dirty ? "You have unsaved changes." : "All changes saved."}</span>
        <div className="adm-inline">
          <Button size="sm" disabled={!dirty} onClick={() => setDraft(initial)}>Discard</Button>
          <Button size="sm" variant="primary" disabled={!dirty || !canEdit} loading={saving && !confirm} onClick={() => (risky ? setConfirm(true) : void save())}>Save changes</Button>
        </div>
      </div>
      <fieldset className="adm-stack" disabled={!canEdit}>
        <div className="adm-grid is-2">
          <Card title="Access">
            <Toggle label="AI generation" description="Off stops every paid AI call for everyone, including automation. Use it if a provider bill spikes." checked={draft.aiEnabled} onChange={(v) => set({ aiEnabled: v })} />
            <Toggle label="New sign-ups" description="Off lets existing users and admins sign in, but no new accounts can be created." checked={draft.signupsOpen} onChange={(v) => set({ signupsOpen: v })} />
            <Toggle label="Maintenance mode" description="Blocks every change users try to make. Pages still load and admins can still work." checked={draft.maintenanceMode} onChange={(v) => set({ maintenanceMode: v })} />
            <Field label="Maintenance message">
              {(id) => <textarea id={id} className="adm-input" rows={2} value={draft.maintenanceMessage} onChange={(event) => set({ maintenanceMessage: event.target.value })} />}
            </Field>
          </Card>
          <Card title="AI providers">
            <p className="adm-help">Pausing a provider blocks new calls to it. Features that have a fallback switch to the next provider.</p>
            {providers.map((provider) => (
              <Toggle
                key={provider}
                label={provider}
                description={PROVIDER_NOTES[provider]}
                checked={!draft.disabledProviders.includes(provider)}
                onChange={(on) => set({ disabledProviders: on ? draft.disabledProviders.filter((p) => p !== provider) : [...draft.disabledProviders, provider] })}
              />
            ))}
          </Card>
        </div>
        <Card title="Turned-off models">
          <p className="adm-help">Exact model ids that can't be called. Features that have a fallback model use it instead. You can also turn a model off from its page under Token usage.</p>
          <ModelList models={draft.blockedModels} onChange={(blockedModels) => set({ blockedModels })} />
        </Card>
        <Card title="Announcement">
          <p className="adm-help">A banner across the top of the app for every signed-in user.</p>
          <Toggle label="Show announcement" checked={draft.announcement.active} onChange={(v) => set({ announcement: { ...draft.announcement, active: v } })} />
          <div className="adm-form-grid is-2-1">
            <Field label="Message" hint={`${draft.announcement.text.length}/280`}>
              {(id) => <input id={id} className="adm-input" maxLength={280} value={draft.announcement.text} onChange={(event) => set({ announcement: { ...draft.announcement, text: event.target.value } })} placeholder="e.g. Video generation is faster starting today." />}
            </Field>
            <Field label="Tone">
              {(id) => (
                <select id={id} className="adm-select" value={draft.announcement.tone} onChange={(event) => set({ announcement: { ...draft.announcement, tone: event.target.value as Governance["announcement"]["tone"] } })}>
                  <option value="info">Info</option>
                  <option value="success">Good news</option>
                  <option value="warning">Warning</option>
                </select>
              )}
            </Field>
          </div>
          {draft.announcement.text ? (
            <div className={cx("adm-preview-banner", `is-${draft.announcement.tone}`)} aria-label="Preview">{draft.announcement.text}</div>
          ) : null}
        </Card>
      </fieldset>
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title="This affects every user"
        actions={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" loading={saving} onClick={save}>Apply now</Button></>}
      >
        <ul className="adm-bullets">
          {!draft.aiEnabled && initial.aiEnabled ? <li>All AI generation stops, including scheduled automation.</li> : null}
          {draft.maintenanceMode && !initial.maintenanceMode ? <li>Users can't save or start anything until you turn maintenance off.</li> : null}
          {!draft.signupsOpen && initial.signupsOpen ? <li>New people can't create an account.</li> : null}
        </ul>
      </Modal>
    </>
  );
}

function ModelList({ models, onChange }: { models: string[]; onChange: (models: string[]) => void }) {
  const [value, setValue] = useState("");
  const add = () => {
    const model = value.trim();
    if (model && !models.includes(model)) onChange([...models, model]);
    setValue("");
  };
  return (
    <div className="adm-stack">
      {models.length ? (
        <ul className="adm-list is-dense">
          {models.map((m) => (
            <li key={m}>
              <code>{m}</code>
              <Button size="sm" variant="ghost" onClick={() => onChange(models.filter((x) => x !== m))}>Turn back on</Button>
            </li>
          ))}
        </ul>
      ) : <p className="adm-muted">Every model is allowed.</p>}
      <div className="adm-inline-form">
        <input className="adm-input" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="e.g. minimax/hailuo-3" aria-label="Model id to turn off" />
        <Button size="sm" disabled={!value.trim()} onClick={add}>Turn off</Button>
      </div>
    </div>
  );
}
