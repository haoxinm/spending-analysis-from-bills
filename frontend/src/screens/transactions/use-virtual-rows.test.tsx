import { render } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it } from "vitest";

import { useVirtualRows } from "./use-virtual-rows";

const ROW_HEIGHT = 44;
const VIEWPORT_HEIGHT = 440; // 10 rows visible

/** Mounts `useVirtualRows` on a real container element sized like the transactions grid's
 * fixed-height viewport (jsdom does no layout, so `clientHeight` is stubbed directly) and
 * reports the latest range after every render. */
function Harness({
  rowCount,
  onRange,
}: {
  rowCount: number;
  onRange: (range: ReturnType<typeof useVirtualRows>["range"]) => void;
}) {
  const { containerRef, range } = useVirtualRows({ rowCount, rowHeight: ROW_HEIGHT, overscan: 2 });
  React.useLayoutEffect(() => {
    onRange(range);
  });
  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        // `@tanstack/virtual-core`'s default rect observer reads `offsetWidth`/`offsetHeight`
        // (jsdom always reports 0 for both, since it does no real layout).
        if (el) {
          Object.defineProperty(el, "offsetHeight", { value: VIEWPORT_HEIGHT, configurable: true });
          Object.defineProperty(el, "offsetWidth", { value: 800, configurable: true });
        }
      }}
    />
  );
}

describe("useVirtualRows", () => {
  it("returns an empty range for zero rows", () => {
    let range: ReturnType<typeof useVirtualRows>["range"] | undefined;
    render(<Harness rowCount={0} onRange={(r) => (range = r)} />);
    expect(range).toEqual({ startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 });
  });

  it("windows a long list to roughly the visible viewport plus overscan, not the full row count", () => {
    let range: ReturnType<typeof useVirtualRows>["range"] | undefined;
    render(<Harness rowCount={10_000} onRange={(r) => (range = r)} />);

    expect(range).toBeDefined();
    expect(range!.startIndex).toBe(0);
    // ~10 visible rows + overscan(2), well short of mounting all 10,000.
    expect(range!.endIndex).toBeLessThan(20);
    expect(range!.endIndex).toBeGreaterThan(0);
    expect(range!.paddingBottom).toBeGreaterThan(0);
    expect(range!.paddingBottom).toBe((10_000 - range!.endIndex) * ROW_HEIGHT);
  });

  it("never windows past the actual row count for a short list", () => {
    let range: ReturnType<typeof useVirtualRows>["range"] | undefined;
    render(<Harness rowCount={3} onRange={(r) => (range = r)} />);

    expect(range!.endIndex).toBe(3);
    expect(range!.paddingBottom).toBe(0);
  });
});
