import * as React from "react";

import { UserSwitcher } from "@/components/primitives/user-switcher";
import { useSelectedUser } from "@/hooks/use-selected-user";

/**
 * Test stand-in for the app shell's user bar: renders the switcher above a screen so per-screen
 * tests can change the (URL-backed) selection the way a user would.
 */
export function WithUserSwitcher({ children }: { children: React.ReactNode }) {
  const sel = useSelectedUser();
  return (
    <>
      <UserSwitcher users={sel.users} value={sel.selectedUserId} onChange={sel.setSelectedUserId} />
      {children}
    </>
  );
}
