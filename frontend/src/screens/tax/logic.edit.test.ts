import { describe, expect, it } from "vitest";

import { ApiError } from "@/api/client";

import {
  amountError,
  blankToNull,
  categoryLabel,
  dollarsToMinor,
  errorMessage,
  isSignedIncomeCategory,
  last4Error,
  minorToDollars,
  provenanceLabel,
  skippedFromMessages,
  taxYearError,
} from "./logic";

describe("dollarsToMinor", () => {
  it("parses common dollar spellings into integer cents", () => {
    expect(dollarsToMinor("1,234.56")).toBe(123456);
    expect(dollarsToMinor("$12")).toBe(1200);
    expect(dollarsToMinor("7.5")).toBe(750);
    expect(dollarsToMinor(" 0.07 ")).toBe(7);
    expect(dollarsToMinor("1.005")).toBe(101);
    expect(dollarsToMinor("0.1")).toBe(10);
  });
  it("rejects junk", () => {
    for (const bad of [
      "",
      "abc",
      "NaN",
      "1e5",
      "1.2.3",
      "$",
      "--5",
      "12abc",
      "Infinity",
    ]) {
      expect(dollarsToMinor(bad, true)).toBeNull();
    }
  });
  it("only allows negatives when asked", () => {
    expect(dollarsToMinor("-50")).toBeNull();
    expect(dollarsToMinor("-50.25", true)).toBe(-5025);
    expect(dollarsToMinor("(50.00)", true)).toBe(-5000);
    expect(dollarsToMinor("(50.00)")).toBeNull();
  });
});

describe("minorToDollars", () => {
  it("formats without grouping and round-trips", () => {
    expect(minorToDollars(123456)).toBe("1234.56");
    expect(minorToDollars(5)).toBe("0.05");
    expect(minorToDollars(-5025)).toBe("-50.25");
    expect(dollarsToMinor(minorToDollars(-5025), true)).toBe(-5025);
  });
});

describe("validation", () => {
  it("amountError", () => {
    expect(amountError("", false)).toBe("Enter an amount");
    expect(amountError("abc", false)).toBe("Enter a valid dollar amount");
    expect(amountError("-5", false)).toBe("Amount cannot be negative");
    expect(amountError("-5", true)).toBeNull();
    expect(amountError("5", false)).toBeNull();
  });
  it("last4Error", () => {
    expect(last4Error("")).toBeNull();
    expect(last4Error("1234")).toBeNull();
    expect(last4Error("123")).not.toBeNull();
    expect(last4Error("12345")).not.toBeNull();
    expect(last4Error("12a4")).not.toBeNull();
  });
  it("taxYearError", () => {
    expect(taxYearError("2024")).toBeNull();
    expect(taxYearError("1999")).not.toBeNull();
    expect(taxYearError("")).not.toBeNull();
    expect(taxYearError("20.5")).not.toBeNull();
  });
  it("signed categories are only the capital gains", () => {
    expect(isSignedIncomeCategory("long_term_capital_gain")).toBe(true);
    expect(isSignedIncomeCategory("interest")).toBe(false);
  });
});

describe("labels", () => {
  it("provenanceLabel precedence", () => {
    const base = {
      extraction_method: "parser",
      is_user_edited: false,
      needs_review: false,
    } as const;
    expect(provenanceLabel(base)).toBe("Parsed");
    expect(provenanceLabel({ ...base, is_user_edited: true })).toBe("Edited");
    expect(provenanceLabel({ ...base, extraction_method: "manual" })).toBe(
      "Entered manually",
    );
    expect(
      provenanceLabel({
        ...base,
        extraction_method: "llm",
        needs_review: true,
      }),
    ).toBe("Read by LLM — needs review");
  });
  it("categoryLabel falls back to the raw value", () => {
    expect(categoryLabel("income", "interest")).toBe("Interest");
    expect(categoryLabel("tax", "mystery")).toBe("mystery");
  });
  it("blankToNull trims", () => {
    expect(blankToNull("  ")).toBeNull();
    expect(blankToNull(" a ")).toBe("a");
  });
});

describe("skippedFromMessages", () => {
  it("groups by source file", () => {
    expect(
      skippedFromMessages([
        { document_id: 1, original_name: "x.pdf", form_type: "w2" },
        { document_id: 2, original_name: "y.pdf", form_type: "w2" },
        { document_id: 2, original_name: "y.pdf", form_type: "1099-int" },
      ]),
    ).toEqual([
      '1 form was already imported from "x.pdf" and was skipped.',
      '2 forms were already imported from "y.pdf" and were skipped.',
    ]);
    expect(skippedFromMessages([])).toEqual([]);
  });
});

describe("errorMessage", () => {
  it("joins FastAPI validation messages", () => {
    const e = new ApiError("x", [{ msg: "bad a" }, { msg: "bad b" }]);
    expect(errorMessage(e)).toBe("bad a; bad b");
  });
  it("falls back", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("weird", "fallback")).toBe("fallback");
  });
});
