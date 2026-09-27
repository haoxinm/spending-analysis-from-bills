import { describe, expect, it } from "vitest";

import { computeRange } from "./use-virtual-rows";

describe("computeRange", () => {
  it("returns an empty range for zero rows", () => {
    expect(computeRange(0, 500, 0, 44, 8)).toEqual({
      startIndex: 0,
      endIndex: 0,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });

  it("windows around the top of a long list with no overscan underflow", () => {
    const range = computeRange(0, 440, 10_000, 44, 8);
    expect(range.startIndex).toBe(0);
    expect(range.paddingTop).toBe(0);
    // visible rows (440/44=10) + 1 + overscan(8) below.
    expect(range.endIndex).toBe(19);
    expect(range.paddingBottom).toBe((10_000 - 19) * 44);
  });

  it("windows around a scroll position in the middle of a long list", () => {
    const scrollTop = 44 * 500; // scrolled past 500 rows
    const range = computeRange(scrollTop, 440, 10_000, 44, 8);
    expect(range.startIndex).toBe(500 - 8);
    expect(range.paddingTop).toBe(range.startIndex * 44);
    expect(range.endIndex).toBeGreaterThan(500);
    expect(range.paddingBottom).toBe((10_000 - range.endIndex) * 44);
  });

  it("clamps the end of the range at the bottom of the list", () => {
    const range = computeRange(44 * 9_990, 440, 10_000, 44, 8);
    expect(range.endIndex).toBe(10_000);
    expect(range.paddingBottom).toBe(0);
  });

  it("never lets startIndex exceed endIndex when the viewport is larger than the data", () => {
    const range = computeRange(0, 10_000, 5, 44, 8);
    expect(range.startIndex).toBeLessThanOrEqual(range.endIndex);
    expect(range.endIndex).toBe(5);
  });
});
