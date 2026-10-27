import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { PagePicker, type PagePickerPage } from "./page-picker";

function Harness({
  total = 4,
  initial = [1, 2, 3, 4],
  pages,
  onChange,
}: {
  total?: number;
  initial?: number[];
  pages?: PagePickerPage[];
  onChange?: (p: number[]) => void;
}) {
  const [selected, setSelected] = React.useState(initial);
  return (
    <PagePicker
      total={total}
      pages={pages}
      selected={selected}
      onChange={(p) => {
        setSelected(p);
        onChange?.(p);
      }}
      imageUrl={(n, w) => `/img/${n}?width=${w}`}
    />
  );
}

describe("PagePicker", () => {
  it("toggles pages, All / None and keeps the range input in sync", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByTestId("page-picker-count")).toHaveTextContent("Pages (4 of 4 selected)");

    await userEvent.click(screen.getByLabelText("Page 2"));
    expect(onChange).toHaveBeenLastCalledWith([1, 3, 4]);
    expect(screen.getByLabelText("Page ranges")).toHaveValue("1,3-4");

    await userEvent.click(screen.getByRole("button", { name: "None" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole("alert")).toHaveTextContent("Select at least one page.");

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onChange).toHaveBeenLastCalledWith([1, 2, 3, 4]);

    const range = screen.getByLabelText("Page ranges");
    await userEvent.clear(range);
    await userEvent.type(range, "2-3");
    expect(onChange).toHaveBeenLastCalledWith([2, 3]);
    expect(screen.getByLabelText("Page 1")).not.toBeChecked();
    expect(screen.getByLabelText("Page 3")).toBeChecked();
  });

  it("shows lazy thumbnails with the requested width", () => {
    render(<Harness />);
    const img = screen.getByAltText("Page 3 preview");
    expect(img).toHaveAttribute("src", "/img/3?width=160");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("marks selected pages clearly and unselected ones differently", async () => {
    render(<Harness initial={[1]} />);
    const card = (n: number) => screen.getByLabelText(`Page ${n}`).closest("label") as HTMLElement;
    expect(card(1)).toHaveAttribute("data-selected", "true");
    expect(card(1)).toHaveTextContent("Selected");
    expect(card(2)).toHaveAttribute("data-selected", "false");
    expect(card(2)).not.toHaveTextContent("Selected");
    await userEvent.click(screen.getByLabelText("Page 2"));
    expect(card(2)).toHaveAttribute("data-selected", "true");
  });

  it("disables pages that can never be sent and leaves them out of All", async () => {
    const onChange = vi.fn();
    render(
      <Harness
        initial={[]}
        onChange={onChange}
        pages={[
          { pageNumber: 1, charCount: 10, suggested: true },
          { pageNumber: 2, charCount: 20, disabledReason: "Form 1040 pages are never sent." },
        ]}
        total={2}
      />,
    );
    expect(screen.getByLabelText("Page 2")).toBeDisabled();
    expect(screen.getByText("Form 1040 pages are never sent.")).toBeInTheDocument();
    expect(screen.getByText(/suggested/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onChange).toHaveBeenLastCalledWith([1]);
  });
});
