-- 0004 created media_jobs but omitted the row-level security policy every other
-- AutoYT table carries. RLS is on by default for tenant tables, so without a
-- policy the app role could not INSERT (confirmed in production:
-- "new row violates row-level security policy for table media_jobs") and the
-- container-compute worker could not claim.
--
-- Matches the app_all pattern from 0001: the tenant role is already scoped to
-- this backend, so per-row filtering happens in application queries rather than
-- in the policy.

ALTER TABLE media_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_all ON media_jobs;
CREATE POLICY app_all ON media_jobs FOR ALL USING (true) WITH CHECK (true);
