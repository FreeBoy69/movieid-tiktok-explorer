/**
 * Renders node-postgres results the way `psql -tA` prints them: one row per line,
 * columns joined by "|", NULL as an empty string, no header or footer.
 *
 * server.js historically shelled out to psql and parsed that text. Keeping the exact
 * text contract lets every call site stay untouched while the transport moves to `pg`.
 */
export function psqlCellText(value) {
    if (value === null || value === undefined)
        return "";
    if (typeof value === "string")
        return value;
    if (typeof value === "boolean")
        return value ? "t" : "f";
    if (value instanceof Date)
        return value.toISOString();
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value))
        return `\\x${value.toString("hex")}`;
    if (typeof value === "object")
        return JSON.stringify(value);
    return String(value);
}
export function psqlTextFromResults(results) {
    const list = Array.isArray(results) ? results : results ? [results] : [];
    const lines = [];
    for (const result of list) {
        if (!result || !Array.isArray(result.rows) || !Array.isArray(result.fields) || !result.fields.length)
            continue;
        for (const row of result.rows) {
            const cells = Array.isArray(row) ? row : result.fields.map((field) => row[field.name]);
            lines.push(cells.map(psqlCellText).join("|"));
        }
    }
    return lines.join("\n").trim();
}
