import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToastContextProvider } from "@/components/ui/toast-provider";

import { ComponentGallery } from "./gallery";

describe("ComponentGallery", () => {
  it("renders every shared primitive without crashing", () => {
    render(
      <ToastContextProvider>
        <ComponentGallery />
      </ToastContextProvider>,
    );

    expect(screen.getByText("Component gallery")).toBeInTheDocument();
    expect(screen.getByText("Money")).toBeInTheDocument();
    expect(screen.getByText("CategoryBadge")).toBeInTheDocument();
    expect(screen.getByText("DateRangePicker")).toBeInTheDocument();
    expect(screen.getByText("Buttons")).toBeInTheDocument();
    expect(screen.getByText("Badges")).toBeInTheDocument();
    expect(screen.getByText("Toast")).toBeInTheDocument();
    expect(screen.getByText("Loading / Empty / Error states")).toBeInTheDocument();
    expect(screen.getByText("Skeleton")).toBeInTheDocument();
  });
});
