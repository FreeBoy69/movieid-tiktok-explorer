# Saved Collection Genre Subcollections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organize saved recap collections into internal official-genre subcollections that reuse Movie ID metadata and fit the current TikTok Explorer workflow.

**Architecture:** Persist one scan record per saved playlist with per-video memberships derived from verified TMDB or MAL metadata. The scan endpoint processes saved clips incrementally through the existing Movie ID cache and identify-link download path, while the TikTok Explorer `Genres` view renders grouped 9:16 cards, progress, and a review bucket.

**Tech Stack:** Express, PostgreSQL JSONB, React, TypeScript, Vitest, existing Movie ID TMDB/MAL enrichment.

---

### Task 1: Genre Scan Domain Helpers

**Files:**
- Create: `src/utils/savedPlaylistGenres.js`
- Create: `src/utils/savedPlaylistGenres.test.ts`

- [ ] **Step 1: Write failing tests**
  Cover official genre extraction from TMDB/MAL results, verified membership status, and grouping one clip into multiple genre subcollections.
- [ ] **Step 2: Run tests and watch them fail**
  Run `node ./node_modules/vitest/vitest.mjs run src/utils/savedPlaylistGenres.test.ts`.
- [ ] **Step 3: Implement the helpers**
  Add membership normalization and grouped summary functions that keep `Needs Review` separate from official genres.
- [ ] **Step 4: Re-run tests**
  The helper suite must pass before wiring server behavior.

### Task 2: Persist And Serve Saved Playlist Genre Scans

**Files:**
- Modify: `server.js`
- Modify: `src/utils/savedTikTokPlaylists.ts`

- [ ] **Step 1: Add the schema**
  Create a `saved_tiktok_playlist_genre_scans` table tied to saved playlist id and user id, storing scan results and progress in JSONB.
- [ ] **Step 2: Add read and write helpers**
  Load a scan by saved playlist key or slug, merge updated memberships by video key, and return summaries with counts.
- [ ] **Step 3: Add scan endpoints**
  Add `GET` and `POST` endpoints under `/api/saved/tiktok-playlists/genre-scan` that enforce signed-in ownership.
- [ ] **Step 4: Reuse Movie ID safely**
  Prefer cached Movie ID. For missing items, analyze only the next small batch through the existing link Movie ID downloader, then persist official TMDB/MAL genre memberships or `Needs Review`.

### Task 3: Integrate Genres Into Saved Collections

**Files:**
- Modify: `src/components/TikTokExplorer.tsx`
- Modify: `src/utils/savedTikTokPlaylists.ts`

- [ ] **Step 1: Add API client types**
  Fetch existing scan state and trigger the next scan batch.
- [ ] **Step 2: Add the saved collection mode**
  Keep the current top bar and add a `Genres` tab only when a saved collection is open.
- [ ] **Step 3: Render scan state**
  Show official genre chips with counts, verified and review counts, and a scan button that continues pending clips.
- [ ] **Step 4: Render grouped cards**
  Reuse 9:16 TikTok cards for the active genre bucket and show title and official genre chips without nesting the grid in extra cards.

### Task 4: Verify And Deploy

**Files:**
- Test: focused Vitest suites
- Verify: `server.js`, TypeScript, production build

- [ ] **Step 1: Run focused tests**
  Run genre helper tests and existing affected tests.
- [ ] **Step 2: Run static checks**
  Run `node --check server.js`, `node ./node_modules/typescript/bin/tsc --noEmit`, and the production Vite build.
- [ ] **Step 3: Deploy changed files**
  Copy the changed server and frontend files to `/opt/autoyt/app`, rebuild, restart `autoyt`, and verify service health.
