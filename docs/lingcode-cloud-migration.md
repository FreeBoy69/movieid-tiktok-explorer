# Moving the AutoYT backend to LingCode Cloud

The Express server (`server.js`) moves as one long-running Node container on the
LingCode Cloud **hosted apps** tier, backed by the project's managed Postgres.
The React frontend is served by that same container from `dist/`, exactly as on the VPS.

## What changed in the code

- Database access uses the `pg` driver instead of shelling out to `psql`. Every query
  still returns psql-style text (`src/utils/pgTextRows.js`), so the 140 call sites are unchanged.
- The app's own `auth_users` / `auth_sessions` tables are now `app_users` / `app_sessions`.
  LingCode Cloud owns a table called `auth_users` in the same schema.
- `vite` is loaded lazily and only in dev mode.
- `GET /health` is the container healthcheck. `GET /health?deps=1` also reports whether
  `python3`, `yt-dlp`, `ffmpeg`, `ffprobe` and `demucs` exist in the runtime.
- `POST /api/admin/db-import` accepts SQL for the one-time data import. It is disabled
  unless the `DB_IMPORT_TOKEN` secret is set.
- New env knobs: `DATABASE_SSL` (`no-verify` | `disable`), `PG_POOL_MAX` (default 4),
  `DB_SEARCH_PATH` (normally unnecessary: the tenant role already defaults to its schema).

## Prerequisites

| Need | Why |
| --- | --- |
| LingCode **Pro** plan or above | Free tier has no hosted apps (`hosted_app_quota_exceeded`) and caps tables at 10. The app needs 27 tables plus LingCode's 3 auth tables. Pro allows 50. |
| VPS SSH access | To run `pg_dump` on `212.95.34.95` and to copy secret values from `/opt/autoyt/app/.env`. |

## Step 1. Secrets

Add these to the backend's Secrets vault (LingCode app → Cloud → Secrets). They are
injected into the container on the **next deploy**, not live.

Required:

```
GEMINI_API_KEY
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
SESSION_SECRET
APP_URL=https://autoyt.apps.lingcode.app   # switch to https://autoyt.cc after the domain is attached
```

Per feature, copy whichever the VPS `.env` has: `GEMINI_API_KEY_BACKUP`, `GEMINI_MODEL`,
`TMDB_API_KEY` / `TMDB_READ_ACCESS_TOKEN`, `YOUTUBE_API_KEY`, `DEEPSEEK_API_KEY`,
`QWEN_API_KEY` / `DASHSCOPE_API_KEY`, `RUNWAY_API_KEY`, `MAL_CLIENT_ID`,
`TIKTOK_MS_TOKEN`, `TIKTOK_COOKIES`, `TIKTOK_COMMENT_PUSH_TOKEN`, `VOICEBOX_URL`,
and any Zernio publishing keys. Do **not** set `DATABASE_URL`, `PORT` or `NODE_ENV`;
the runner provides them.

## Step 2. Deploy the container

```
scripts/lingcode-cloud/deploy-hosted-app.sh
```

This builds `dist/`, packs a ~50-file source tarball (`scripts/lingcode-cloud/build-app-bundle.sh`),
creates the hosted app `autoyt` (Node 22, healthcheck `/health`) on first run, and uploads the source.
The buildpack runs `npm ci --omit=dev` then `npm start`.

If `npm run build` cannot run on this machine, build `dist/` wherever you normally do and run
`SKIP_BUILD=1 scripts/lingcode-cloud/deploy-hosted-app.sh` to bundle the existing `dist/`.

Verify:

```
curl https://autoyt.apps.lingcode.app/health?deps=1
```

The container log should show `PostgreSQL connected as trole_… (schema be_…)`. The app
creates its 27 tables on first boot.

## Step 3. Import the VPS database

1. Export on the VPS: `scripts/lingcode-cloud/export-vps-db.sh tmp/autoyt-vps.sql`
2. Add secret `DB_IMPORT_TOKEN=<long random string>` and redeploy (step 2).
3. Dry run to inspect the rewritten SQL: `node scripts/lingcode-cloud/import-db.mjs --file tmp/autoyt-vps.sql --dry-run`
4. Import: `node scripts/lingcode-cloud/import-db.mjs --file tmp/autoyt-vps.sql --url https://autoyt.apps.lingcode.app --token "$DB_IMPORT_TOKEN"`
5. Remove `DB_IMPORT_TOKEN` from Secrets and redeploy.

The import drops and recreates the app tables, so it is safe to re-run from scratch.
Stop the VPS service first if you want a consistent final snapshot.

## Step 4. OAuth redirect URIs

Add to the Google Cloud OAuth client (and TikTok developer app if used):

```
https://autoyt.apps.lingcode.app/api/auth/google/callback
https://autoyt.apps.lingcode.app/api/auth/youtube/callback
https://autoyt.apps.lingcode.app/api/auth/tiktok/callback
```

Repeat with `https://autoyt.cc/...` once the custom domain is live.

## Step 5. Custom domain

Attach `autoyt.cc` to the hosted app (LingCode app → Cloud → Domains, or the `attach_domain`
tool). DNS: `A autoyt.cc → 138.197.107.228`, DNS-only in Cloudflare. TLS is issued on the
first HTTPS request. Then set `APP_URL=https://autoyt.cc` and redeploy.

## Step 6. Cut over

Once `/health`, login, saved playlists and an automation run work on the new URL,
stop and disable `autoyt.service` on the VPS.

## Known limits of the hosted-app tier

- **Native tools.** LingCode documents Node 20/22 in `node-app-runtime`; it does not
  document `ffmpeg`, `python3`, `yt-dlp`, `demucs` or OpenCV, and custom Dockerfiles or apt
  packages are not supported. `/health?deps=1` tells you what is there. Features that need
  them: TikTok listing/download, transcription, compilations, Shorts trimming, voice studio,
  caption cleanup, the downloader. If they are missing, ask LingCode support for an image
  with them, or keep the VPS as a media worker.
- **Ephemeral disk.** Everything under `tmp/` and `data/tiktok-covers` disappears on
  redeploy: cover cache, compiled downloads, voice files, job logs.
- **Memory.** Default 256 MB. Raise it per app before running ffmpeg compilations.
- **Single container.** Compilation and voice workers run as child processes of the
  server (systemd-run is absent, the code falls back to `spawn`). A redeploy kills
  in-flight jobs.
- **Secrets rotate on redeploy only.**
