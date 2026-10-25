import { describe, expect, it } from "vitest";

import { MAX_PATTERN_LENGTH, ruleMatchesText, validatePattern } from "./rule-matching";

describe("validatePattern", () => {
  it("rejects an empty pattern", () => {
    expect(validatePattern("  ", "contains").valid).toBe(false);
  });

  it("rejects a pattern longer than the cap", () => {
    const result = validatePattern("a".repeat(MAX_PATTERN_LENGTH + 1), "contains");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/characters or fewer/);
  });

  it("accepts a valid contains/exact pattern", () => {
    expect(validatePattern("STARBUCKS", "contains").valid).toBe(true);
    expect(validatePattern("STARBUCKS", "exact").valid).toBe(true);
  });

  it("accepts a valid regex", () => {
    expect(validatePattern("^STAR.*$", "regex").valid).toBe(true);
  });

  it("rejects an invalid regex without throwing", () => {
    const result = validatePattern("(unterminated", "regex");
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("ruleMatchesText", () => {
  it("exact matches the whole, case-insensitive, trimmed string", () => {
    expect(ruleMatchesText("exact", " Starbucks ", "starbucks")).toBe(true);
    expect(ruleMatchesText("exact", "starbucks", "starbucks 123")).toBe(false);
  });

  it("contains matches a case-insensitive substring", () => {
    expect(ruleMatchesText("contains", "star", "starbucks 123")).toBe(true);
    expect(ruleMatchesText("contains", "STAR", "starbucks 123")).toBe(true);
    expect(ruleMatchesText("contains", "nope", "starbucks 123")).toBe(false);
  });

  it("regex uses case-insensitive search()-style matching", () => {
    expect(ruleMatchesText("regex", "^star", "STARBUCKS 123")).toBe(true);
    expect(ruleMatchesText("regex", "bucks$", "starbucks")).toBe(true);
    expect(ruleMatchesText("regex", "^bucks", "starbucks")).toBe(false);
  });

  it("an invalid regex never throws and reports no match", () => {
    expect(ruleMatchesText("regex", "(unterminated", "anything")).toBe(false);
  });
});
