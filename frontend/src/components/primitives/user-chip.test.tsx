import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserChip } from "./user-chip";
import { userAvatarClass } from "./user-colors";
import { UserSwitcher } from "./user-switcher";

describe("UserChip", () => {
  it("shows the initial avatar and name for a user", () => {
    render(<UserChip userId={3} name="Sam" />);
    expect(screen.getByTestId("user-chip")).toHaveTextContent("Sam");
    expect(screen.getByTestId("user-avatar")).toHaveTextContent("S");
  });

  it("renders All users distinctly from any person", () => {
    render(<UserChip userId={null} />);
    expect(screen.getByTestId("user-chip")).toHaveTextContent("All users");
    expect(screen.getByTestId("user-avatar").className).toContain("rounded-md");
  });

  it("gives a user the same colour every time, with light and dark variants", () => {
    expect(userAvatarClass(2)).toBe(userAvatarClass(2));
    expect(userAvatarClass(2)).not.toBe(userAvatarClass(3));
    expect(userAvatarClass(2)).toMatch(/dark:/);
  });
});

describe("UserSwitcher avatars", () => {
  it("adds decorative avatars without changing the accessible names", () => {
    render(
      <UserSwitcher
        avatars
        users={[
          { id: 1, name: "Alex", is_default: true },
          { id: 2, name: "Sam", is_default: false },
        ]}
        value={null}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: "Sam" })).toBeInTheDocument();
    expect(screen.getAllByTestId("user-avatar")).toHaveLength(3);
  });
});
