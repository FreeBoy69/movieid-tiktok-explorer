import { describe, expect, it } from "vitest";
import { psqlCellText, psqlTextFromResults } from "./pgTextRows.js";

describe("psqlTextFromResults", () => {
  it("prints rows like psql -tA: pipe-separated columns, newline-separated rows", () => {
    const text = psqlTextFromResults({
      fields: [{ name: "id" }, { name: "name" }],
      rows: [["1", "alpha"], ["2", "beta"]],
    });
    expect(text).toBe("1|alpha\n2|beta");
  });

  it("renders NULL as an empty string and keeps raw text values verbatim", () => {
    expect(psqlTextFromResults({ fields: [{ name: "a" }, { name: "b" }], rows: [[null, "x|y"]] })).toBe("|x|y");
  });

  it("returns an empty string for statements without a result set", () => {
    expect(psqlTextFromResults({ fields: [], rows: [] })).toBe("");
    expect(psqlTextFromResults([{ command: "CREATE" }, { command: "UPDATE", rows: [], fields: [] }])).toBe("");
  });

  it("concatenates result sets from multi-statement queries in order", () => {
    const text = psqlTextFromResults([
      { command: "CREATE", rows: [], fields: [] },
      { fields: [{ name: "n" }], rows: [["1"]] },
      { fields: [{ name: "n" }], rows: [["2"], ["3"]] },
    ]);
    expect(text).toBe("1\n2\n3");
  });

  it("keeps json_agg output parseable exactly as before", () => {
    const payload = JSON.stringify([{ key: "k", playlist: { title: "T" } }]);
    const text = psqlTextFromResults({ fields: [{ name: "coalesce" }], rows: [[payload]] });
    expect(JSON.parse(text)).toEqual([{ key: "k", playlist: { title: "T" } }]);
  });

  it("supports object rows when rowMode is not array", () => {
    const text = psqlTextFromResults({ fields: [{ name: "a" }, { name: "b" }], rows: [{ a: "1", b: null }] });
    expect(text).toBe("1|");
  });

  it("formats parsed values the way Postgres text output would", () => {
    expect(psqlCellText(true)).toBe("t");
    expect(psqlCellText(false)).toBe("f");
    expect(psqlCellText(42)).toBe("42");
    expect(psqlCellText({ a: 1 })).toBe('{"a":1}');
    expect(psqlCellText(Buffer.from([0xde, 0xad]))).toBe("\\xdead");
  });
});
