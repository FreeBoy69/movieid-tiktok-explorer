import { describe, expect, it } from "vitest";
import { splitIntoBatches, transformDump } from "./import-db.mjs";

const dump = [
  "\\restrict abc",
  "SET transaction_timeout = 0;",
  "SET client_encoding = 'UTF8';",
  "SELECT pg_catalog.set_config('search_path', '', false);",
  "CREATE SCHEMA public;",
  "DROP TABLE IF EXISTS public.auth_users;",
  "CREATE INDEX auth_sessions_user_idx ON public.auth_sessions USING btree (user_id);",
  "INSERT INTO public.auth_users (id, note) VALUES ('u1', 'made public. auth_users; end'), ('u2', 'it''s multi",
  "line; text');",
  "INSERT INTO public.saved_tiktok_playlists (id, playlist) VALUES ('p1', '{\"public.x\": \"auth_users_ref\"}');",
].join("\n");

describe("transformDump", () => {
  it("rewrites identifiers outside string literals and drops unsupported statements", () => {
    const { lines } = transformDump(dump);
    expect(lines).toEqual([
      "SET client_encoding = 'UTF8';",
      "DROP TABLE IF EXISTS app_users;",
      "CREATE INDEX app_sessions_user_idx ON app_sessions USING btree (user_id);",
      "INSERT INTO app_users (id, note) VALUES ('u1', 'made public. auth_users; end'), ('u2', 'it''s multi",
      "line; text');",
      "INSERT INTO saved_tiktok_playlists (id, playlist) VALUES ('p1', '{\"public.x\": \"auth_users_ref\"}');",
    ]);
  });

  it("never splits a batch inside a multi-line literal", () => {
    const batches = splitIntoBatches(transformDump(dump), 1);
    expect(batches.join("\n")).toBe(transformDump(dump).lines.join("\n"));
    expect(batches.some((batch) => batch.endsWith("multi"))).toBe(false);
    expect(batches.at(-2)).toContain("line; text');");
  });
});
