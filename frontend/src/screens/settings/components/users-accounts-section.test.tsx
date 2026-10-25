import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastContextProvider } from "@/components/ui/toast-provider";

import { UsersAccountsSection } from "./users-accounts-section";

const createUserMutate = vi.fn();
const updateUserMutate = vi.fn();
const deleteUserMutate = vi.fn();
const createAccountMutate = vi.fn();
const updateAccountMutate = vi.fn();

vi.mock("../lib/hooks", () => ({
  useUsersQuery: () => ({
    data: [
      { id: 1, name: "Alex", is_default: true },
      { id: 2, name: "Sam", is_default: false },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useAccountsQuery: () => ({
    data: [{ id: 10, user_id: 1, issuer_id: 5, account_type: "credit", currency: "USD" }],
  }),
  useIssuersQuery: () => ({ data: [{ id: 5, name: "Chase", slug: "chase", match_terms: [] }] }),
  useCreateUser: () => ({ mutate: createUserMutate, isPending: false }),
  useUpdateUser: () => ({ mutate: updateUserMutate, isPending: false }),
  useDeleteUser: () => ({ mutate: deleteUserMutate, isPending: false }),
  useCreateAccount: () => ({ mutate: createAccountMutate, isPending: false }),
  useUpdateAccount: () => ({ mutate: updateAccountMutate, isPending: false }),
}));

function renderSection() {
  return render(
    <ToastContextProvider>
      <UsersAccountsSection />
    </ToastContextProvider>,
  );
}

describe("UsersAccountsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("lists users with the default badge and their accounts' issuer", () => {
    renderSection();
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getAllByText("Chase").length).toBeGreaterThan(0);
  });

  it("creates a user with is_default defaulted to false", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(screen.getByLabelText("New user name"), "Jordan");
    await user.click(screen.getByRole("button", { name: /add user/i }));
    expect(createUserMutate).toHaveBeenCalledWith({ name: "Jordan", is_default: false }, expect.anything());
  });

  it("never shows an account's mask, and only sends one when the user types a new one", async () => {
    const user = userEvent.setup();
    renderSection();
    expect(screen.getByLabelText("Set mask for account 10")).toHaveValue("");

    await user.type(screen.getByLabelText("Set mask for account 10"), "4242");
    const saveButtons = screen.getAllByRole("button", { name: /^save$/i });
    await user.click(saveButtons[0] as HTMLElement);

    expect(updateAccountMutate).toHaveBeenCalledWith(
      { id: 10, body: { account_type: "credit", currency: "USD", mask: "4242" } },
      expect.anything(),
    );
  });

  it("confirms before deleting a user", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderSection();
    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    await user.click(deleteButtons[0] as HTMLElement);
    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteUserMutate).toHaveBeenCalledWith(1, expect.anything());
  });

  it("offers 'make default' only for the non-default user", () => {
    renderSection();
    expect(screen.getAllByRole("button", { name: /make default/i })).toHaveLength(1);
  });
});
