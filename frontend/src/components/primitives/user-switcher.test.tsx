import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UserSwitcher } from "./user-switcher";

const USERS = [
  { id: 1, name: "Alex", is_default: true },
  { id: 2, name: "Sam", is_default: false },
];

describe("UserSwitcher", () => {
  it("renders chips with All users first and marks the active one", () => {
    render(<UserSwitcher users={USERS} value={2} onChange={vi.fn()} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["All users", "Alex", "Sam"]);
    expect(screen.getByRole("radio", { name: "Sam" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "All users" })).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange with the id, or null for All users", async () => {
    const onChange = vi.fn();
    render(<UserSwitcher users={USERS} value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Alex" }));
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(screen.getByRole("radio", { name: "All users" })).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange(null) when All users is clicked", async () => {
    const onChange = vi.fn();
    render(<UserSwitcher users={USERS} value={1} onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "All users" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("moves selection with arrow keys", () => {
    const onChange = vi.fn();
    render(<UserSwitcher users={USERS} value={null} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: "All users" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("falls back to a select for more than 6 users", async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: `U${i + 1}`, is_default: i === 0 }));
    const onChange = vi.fn();
    render(<UserSwitcher users={many} value={null} onChange={onChange} />);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: "User" });
    await userEvent.selectOptions(select, "3");
    expect(onChange).toHaveBeenCalledWith(3);
    await userEvent.selectOptions(select, "all");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("honours variant=select with few users", () => {
    render(<UserSwitcher users={USERS} value={1} onChange={vi.fn()} variant="select" />);
    expect(screen.getByRole("combobox")).toHaveValue("1");
  });

  it("renders nothing for one user or none", () => {
    const { container, rerender } = render(<UserSwitcher users={USERS.slice(0, 1)} value={1} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<UserSwitcher users={[]} value={null} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("omits All users when allowAll is false", () => {
    render(<UserSwitcher users={USERS} value={1} onChange={vi.fn()} allowAll={false} />);
    expect(screen.queryByRole("radio", { name: "All users" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });
});
