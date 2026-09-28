import { describe, expect, it } from "vitest";

import { buildPreviewCsv, summarizeRedactionSignals } from "./redaction";

describe("buildPreviewCsv", () => {
  it("builds the id,description header and 1..N ids, never a database id", () => {
    const csv = buildPreviewCsv(["TRADER JOES #123 SEATTLE WA", "DELTA AIR LINES"]);
    expect(csv).toBe("id,description\n1,TRADER JOES #123 SEATTLE WA\n2,DELTA AIR LINES");
  });

  it("quotes a field containing a comma", () => {
    const csv = buildPreviewCsv(["ACME, INC"]);
    expect(csv).toBe('id,description\n1,"ACME, INC"');
  });

  it("doubles an embedded quote and wraps the field", () => {
    const csv = buildPreviewCsv(['SAY "HI" STORE']);
    expect(csv).toBe('id,description\n1,"SAY ""HI"" STORE"');
  });

  it("returns just the header for an empty list", () => {
    expect(buildPreviewCsv([])).toBe("id,description");
  });
});

describe("summarizeRedactionSignals", () => {
  it("reports zero for clean, already-normalized descriptions", () => {
    const summary = summarizeRedactionSignals(["TRADER JOES #123 SEATTLE WA", "DELTA AIR LINES"]);
    expect(summary.totalRows).toBe(2);
    expect(summary.totalFlagged).toBe(0);
    expect(summary.signals.every((s) => s.count === 0)).toBe(true);
  });

  it("flags a long digit run", () => {
    const summary = summarizeRedactionSignals(["ACCT 123456789"]);
    expect(summary.signals.find((s) => s.key === "longDigitRuns")?.count).toBe(1);
    expect(summary.totalFlagged).toBe(1);
  });

  it("flags an email address", () => {
    const summary = summarizeRedactionSignals(["contact a@b.com for help"]);
    expect(summary.signals.find((s) => s.key === "emails")?.count).toBe(1);
  });

  it("flags a currency amount", () => {
    const summary = summarizeRedactionSignals(["charged $12 today"]);
    expect(summary.signals.find((s) => s.key === "currencyAmounts")?.count).toBe(1);
  });

  it("flags an ISO date", () => {
    const summary = summarizeRedactionSignals(["posted 2024-01-15"]);
    expect(summary.signals.find((s) => s.key === "isoDates")?.count).toBe(1);
  });

  it("counts every matching row across the batch", () => {
    const summary = summarizeRedactionSignals(["1234567", "clean", "9876543"]);
    expect(summary.signals.find((s) => s.key === "longDigitRuns")?.count).toBe(2);
    expect(summary.totalRows).toBe(3);
  });
});
