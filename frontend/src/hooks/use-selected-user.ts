import * as React from "react";
import { useSearchParams } from "react-router-dom";

import { useUsers } from "@/api/hooks";
import type { components } from "@/api/client";

export type User = components["schemas"]["User"];

/** URL search param holding the explicit selection: `?user=<id>` or `?user=all`. */
export const SELECTED_USER_PARAM = "user";
/** localStorage key restoring the selection when navigating between screens (nav links carry no query). */
export const SELECTED_USER_STORAGE_KEY = "spend-analyzer:selected-user";
const ALL = "all";

function parseRaw(raw: string | null, users: readonly User[]): number | null | undefined {
  if (raw === null) return undefined;
  if (raw === ALL) return null;
  const id = Number(raw);
  if (!Number.isInteger(id)) return undefined;
  return users.some((u) => u.id === id) ? id : undefined;
}

/**
 * Pure resolution of the selected user. Precedence: explicit URL value, then the stored value,
 * then the default (the only user when there is exactly one, else "All users").
 * Returns a user id, or `null` for "All users". Ids not present in `users` (e.g. deleted) are
 * ignored and fall through to the next rule.
 */
export function resolveSelectedUser(
  urlParam: string | null,
  storedValue: string | null,
  users: readonly User[],
): number | null {
  const fromUrl = parseRaw(urlParam, users);
  if (fromUrl !== undefined) return fromUrl;
  const fromStore = parseRaw(storedValue, users);
  if (fromStore !== undefined) return fromStore;
  return users.length === 1 ? users[0]!.id : null;
}

export function readStoredUser(): string | null {
  try {
    return window.localStorage.getItem(SELECTED_USER_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeStoredUser(value: string): void {
  try {
    window.localStorage.setItem(SELECTED_USER_STORAGE_KEY, value);
  } catch {
    // Ignore: a convenience, not a requirement.
  }
}

export interface UseSelectedUser {
  users: User[];
  isLoading: boolean;
  error: unknown;
  /** `null` means "All users". */
  selectedUserId: number | null;
  selectedUser: User | null;
  /** `[id]` when one user is selected, else `undefined` — drops straight into `user_ids` queries. */
  userIds: number[] | undefined;
  setSelectedUserId: (id: number | null) => void;
}

const NO_USERS: User[] = [];

/** Shared per-user view selection for Dashboard, Review and Transactions (URL + localStorage). */
export function useSelectedUser(): UseSelectedUser {
  const usersQuery = useUsers();
  const [searchParams, setSearchParams] = useSearchParams();
  const users = usersQuery.data ?? NO_USERS;
  const isLoading = usersQuery.isLoading;
  const urlParam = searchParams.get(SELECTED_USER_PARAM);

  const selectedUserId = React.useMemo(
    () => (isLoading ? null : resolveSelectedUser(urlParam, readStoredUser(), users)),
    [isLoading, urlParam, users],
  );

  const setSelectedUserId = React.useCallback(
    (id: number | null) => {
      const value = id === null ? ALL : String(id);
      writeStoredUser(value);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(SELECTED_USER_PARAM, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const selectedUser = React.useMemo(
    () => users.find((u) => u.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );
  const userIds = React.useMemo(
    () => (selectedUserId === null ? undefined : [selectedUserId]),
    [selectedUserId],
  );

  return {
    users,
    isLoading,
    error: usersQuery.error,
    selectedUserId,
    selectedUser,
    userIds,
    setSelectedUserId,
  };
}
