-- Adds the 'exec' kind: the hosted app hands a single ffmpeg / ffprobe /
-- python3 / yt-dlp / zip invocation to a container-compute worker, because the
-- hosted-app image has none of those binaries. Input and output files travel
-- over authenticated HTTPS between the worker and the hosted app, not through
-- this row, which only carries the exec id.
ALTER TABLE media_jobs DROP CONSTRAINT IF EXISTS media_jobs_kind_check;
ALTER TABLE media_jobs ADD CONSTRAINT media_jobs_kind_check
  CHECK (kind IN ('transcribe','download','probe','tiktok-list','voice-studio','compilation','exec'));
