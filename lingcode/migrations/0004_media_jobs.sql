-- Work queue bridging the hosted app to container-compute media workers.
--
-- The hosted app runs runtime:node on a read-only rootfs with no ffmpeg,
-- yt-dlp, python3 or whisper, so the 26 routes that shell out to those
-- binaries cannot run there. They enqueue here instead; a container-compute
-- job on a custom image claims the row, does the work against $SCRATCH_DIR,
-- and writes the result back.
--
-- Claiming uses SELECT ... FOR UPDATE SKIP LOCKED so several workers can run
-- concurrently without handing the same row to two of them.

CREATE TABLE IF NOT EXISTS media_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,
  kind          text NOT NULL,
  status        text NOT NULL DEFAULT 'queued',
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  result        jsonb,
  error         text,
  -- Free-text stage plus 0..1 so the UI can show the same progress the
  -- in-process voice-studio jobs show today.
  progress      double precision NOT NULL DEFAULT 0,
  message       text NOT NULL DEFAULT '',
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 3,
  -- Set on claim; a row whose lease has expired is retryable, which is how a
  -- worker killed mid-job (OOM, eviction) gets picked up again.
  leased_until  timestamptz,
  worker_id     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  CONSTRAINT media_jobs_status_check
    CHECK (status IN ('queued','running','done','failed','cancelled')),
  CONSTRAINT media_jobs_kind_check
    CHECK (kind IN ('transcribe','download','probe','tiktok-list','voice-studio','compilation'))
);

-- The claim query: oldest queued (or expired-lease) row of a given kind.
CREATE INDEX IF NOT EXISTS media_jobs_claim_idx
  ON media_jobs (kind, status, created_at)
  WHERE status IN ('queued','running');

CREATE INDEX IF NOT EXISTS media_jobs_user_idx
  ON media_jobs (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION media_jobs_touch() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS media_jobs_touch_trg ON media_jobs;
CREATE TRIGGER media_jobs_touch_trg
  BEFORE UPDATE ON media_jobs
  FOR EACH ROW EXECUTE FUNCTION media_jobs_touch();

-- Atomically hand one job to one worker. Returns zero rows when the queue is
-- empty, which the worker treats as "sleep and poll again".
CREATE OR REPLACE FUNCTION claim_media_job(job_kind text, worker text, lease_seconds integer DEFAULT 900)
RETURNS SETOF media_jobs AS $$
  UPDATE media_jobs SET
    status       = 'running',
    worker_id    = worker,
    attempts     = attempts + 1,
    started_at   = COALESCE(started_at, now()),
    leased_until = now() + make_interval(secs => lease_seconds)
  WHERE id = (
    SELECT id FROM media_jobs
    WHERE kind = job_kind
      AND (status = 'queued'
           OR (status = 'running' AND leased_until < now() AND attempts < max_attempts))
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING *;
$$ LANGUAGE sql;
