-- Jev scores for every unused video in an agent's source pool (playlist, the creators' channels
-- in it, and pool sources), refreshed about twice a week so runs pick from a ranked pool instead
-- of re-scoring only the top ten each time.
CREATE TABLE IF NOT EXISTS automation_pool_rankings (
  agent_id text NOT NULL,
  video_key text NOT NULL,
  score integer NOT NULL,
  confidence integer NOT NULL DEFAULT 0,
  title text NOT NULL DEFAULT '',
  ranked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, video_key)
);

CREATE INDEX IF NOT EXISTS automation_pool_rankings_agent_score_idx
  ON automation_pool_rankings(agent_id, score DESC);

-- One row per agent: when its pool was last ranked and how much of it was scored.
CREATE TABLE IF NOT EXISTS automation_pool_rank_runs (
  agent_id text PRIMARY KEY,
  ranked_at timestamptz NOT NULL DEFAULT now(),
  pool integer NOT NULL DEFAULT 0,
  ranked integer NOT NULL DEFAULT 0,
  error text NOT NULL DEFAULT ''
);

ALTER TABLE automation_pool_rankings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON automation_pool_rankings;
CREATE POLICY app_all ON automation_pool_rankings FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE automation_pool_rank_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_all ON automation_pool_rank_runs;
CREATE POLICY app_all ON automation_pool_rank_runs FOR ALL USING (true) WITH CHECK (true);
