import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./error-boundary";

function Boom(): never {
  throw new Error("kaboom");
}

describe("ErrorBoundary", () => {
  it("renders an ErrorState instead of crashing the tree", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("kaboom");
  });

  it("resets and re-renders children when Try again is clicked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let shouldThrow = true;
    function MaybeBoom() {
      if (shouldThrow) throw new Error("kaboom");
      return <div>recovered</div>;
    }

    render(
      <ErrorBoundary>
        <MaybeBoom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    shouldThrow = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("recovered")).toBeInTheDocument();
  });
});
