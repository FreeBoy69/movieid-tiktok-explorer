-- Creator workspace schema. server/creatorWorkspace.js creates this at startup, but
-- the app role does not own the imported tables, so its ALTER TABLE fails in
-- production and the creator API returned 503/400. The migration role owns them.
-- Matches initializeCreatorWorkspace() exactly; every statement is idempotent.

ALTER TABLE creator_projects ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE creator_projects ADD COLUMN IF NOT EXISTS input_versions jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS creator_stage_jobs (
  id text PRIMARY KEY,
  project_id text REFERENCES creator_projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  stage text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  fingerprint text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  progress integer NOT NULL DEFAULT 0,
  message text NOT NULL DEFAULT '',
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  style_id text REFERENCES channel_styles(id) ON DELETE CASCADE,
  account_id text REFERENCES youtube_accounts(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS creator_stage_active_idx
  ON creator_stage_jobs(project_id, stage) WHERE status IN ('queued','running');
CREATE UNIQUE INDEX IF NOT EXISTS creator_style_active_idx
  ON creator_stage_jobs(style_id, stage) WHERE status IN ('queued','running') AND style_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS creator_stage_jobs_user_idx ON creator_stage_jobs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS creator_research_collections (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  youtube_account_id text NOT NULL REFERENCES youtube_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_research_collections_owner_idx
  ON creator_research_collections(user_id, youtube_account_id, updated_at DESC);

ALTER TABLE creator_stage_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON creator_stage_jobs;
CREATE POLICY app_all ON creator_stage_jobs FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE creator_research_collections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON creator_research_collections;
CREATE POLICY app_all ON creator_research_collections FOR ALL USING (true) WITH CHECK (true);
