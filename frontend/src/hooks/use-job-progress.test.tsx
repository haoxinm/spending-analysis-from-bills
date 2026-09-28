import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useJobProgress } from "./use-job-progress";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

describe("useJobProgress", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when jobId is not provided", () => {
    const { result } = renderHook(() => useJobProgress(null));
    expect(result.current.connectionState).toBe("idle");
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("opens an EventSource for the job and reports progress", async () => {
    const { result } = renderHook(() => useJobProgress("job-123"));

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const source = MockEventSource.instances.at(0);
    if (!source) throw new Error("expected an EventSource instance");
    expect(source.url).toContain("/api/jobs/job-123/events");

    act(() => {
      source.onopen?.();
    });
    expect(result.current.connectionState).toBe("open");

    act(() => {
      source.onmessage?.({ data: JSON.stringify({ status: "running", progress: 0.5 }) });
    });
    expect(result.current.event).toEqual({ status: "running", progress: 0.5 });

    act(() => {
      source.onmessage?.({ data: JSON.stringify({ status: "done", progress: 1 }) });
    });
    expect(result.current.event?.status).toBe("done");
    expect(source.closed).toBe(true);
  });

  it("closes the stream on unmount", async () => {
    const { unmount } = renderHook(() => useJobProgress("job-456"));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const source = MockEventSource.instances.at(0);
    if (!source) throw new Error("expected an EventSource instance");

    unmount();

    expect(source.closed).toBe(true);
  });
});
