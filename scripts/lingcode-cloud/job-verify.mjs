// Post-migration verification, run as a LingCode container-compute job.
// Reports per-table row counts plus constraint/index totals so the migrated
// backend can be diffed against the VPS source of truth.
import pg from "pg";

const c = new pg.Client({ connectionString: process.env.LINGCODE_DB_URL });
await c.connect();

const { rows: tables } = await c.query(`
  SELECT tablename FROM pg_tables
  WHERE schemaname = current_schema() ORDER BY tablename`);

// The tenant schema also holds LingCode-internal tables the app role cannot read;
// skip those rather than aborting the whole report.
for (const { tablename } of tables) {
  try {
    const { rows } = await c.query(`SELECT count(*)::text AS n FROM "${tablename}"`);
    console.log(`${tablename}|${rows[0].n}`);
  } catch (err) {
    if (err.code !== "42501") throw err;
    console.log(`${tablename}|SKIP(no select)`);
  }
}

const { rows: cons } = await c.query(`
  SELECT contype, count(*)::text AS n
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace ns ON t.relnamespace = ns.oid
  WHERE ns.nspname = current_schema()
  GROUP BY contype ORDER BY contype`);
console.log("CONSTRAINTS " + cons.map((r) => `${r.contype}=${r.n}`).join(" "));

const { rows: idx } = await c.query(`
  SELECT count(*)::text AS n FROM pg_indexes WHERE schemaname = current_schema()`);
console.log("INDEXES " + idx[0].n);

await c.end();
