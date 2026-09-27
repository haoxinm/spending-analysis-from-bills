import * as React from "react";

import { useToast } from "@/components/ui/use-toast";

import { fetchNeedsReviewQueue, patchTransaction } from "./api";
import type { Transaction, UndoEntry } from "./types";

export interface StagedPick {
  categoryKey: string;
  subcategoryKey: string;
}

export interface UseReviewQueueResult {
  status: "loading" | "error" | "ready";
  error: unknown;
  queue: Transaction[];
  index: number;
  current: Transaction | null;
  isMutating: boolean;
  canUndo: boolean;
  /** Moves the cursor to the next transaction in the queue (the `j` key). Clamped at the end. */
  next: () => void;
  /** Moves the cursor to the previous transaction (the `k` key). Clamped at the start. */
  previous: () => void;
  /** Stages a category/subcategory pick for the current transaction, without saving it yet. */
  stage: (categoryKey: string, subcategoryKey: string) => void;
  stagedForCurrent: StagedPick | undefined;
  /**
   * Accepts the current transaction: the staged pick if one was made, otherwise whatever
   * category the cascade already proposed. Optimistically removes it from the queue; on a
   * failed `PATCH` it is reinserted at its original position and the user is told why (rollback).
   * `createRule` mirrors the `r` key — "promote the accept into a rule" (§P3-B) — via
   * `TransactionPatch.create_rule`.
   */
  accept: (options?: { createRule?: boolean }) => Promise<void>;
  /**
   * Reverts the single most recent `accept`: `PATCH`es the transaction back to the category,
   * subcategory and kind it had before, and reinserts it into the visible queue at its old
   * position. This restores the classification but cannot restore the server's `needs_review`
   * flag — `TransactionPatch` (§3.12) has no field for it, so on reload the transaction will not
   * reappear in the queue on its own. See the module doc in `index.tsx` for the contract change
   * this asks for.
   */
  undo: () => Promise<void>;
  refetch: () => void;
}

/**
 * Drives the review queue: loads every `needs_review` transaction (`fetchNeedsReviewQueue`,
 * `api.ts`) and manages the session's local cursor, staged category picks, optimistic
 * accept/undo, and the one-entry-deep undo stack that `index.tsx` wires to the `u` key.
 *
 * The queue lives in local component state rather than the TanStack Query cache: once loaded,
 * accept/undo mutate this array directly (removing or reinserting rows) so the visible order and
 * cursor position survive a rollback exactly, which a query-cache `setQueryData` dance over a
 * paginated, client-filtered list would not do cleanly.
 */
export function useReviewQueue(): UseReviewQueueResult {
  const { toast } = useToast();
  const [queue, setQueue] = React.useState<Transaction[]>([]);
  const [status, setStatus] = React.useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = React.useState<unknown>(null);
  const [index, setIndex] = React.useState(0);
  const [staged, setStaged] = React.useState<Record<number, StagedPick>>({});
  const [isMutating, setIsMutating] = React.useState(false);
  const [canUndo, setCanUndo] = React.useState(false);
  const undoStack = React.useRef<UndoEntry[]>([]);

  const load = React.useCallback(() => {
    setStatus("loading");
    setError(null);
    fetchNeedsReviewQueue()
      .then((items) => {
        setQueue(items);
        setIndex(0);
        setStaged({});
        undoStack.current = [];
        setCanUndo(false);
        setStatus("ready");
      })
      .catch((caught: unknown) => {
        setError(caught);
        setStatus("error");
      });
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // Keep the cursor in range as the queue shrinks (an accept removes its row).
  React.useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(queue.length - 1, 0)));
  }, [queue.length]);

  const current = queue[index] ?? null;

  const next = React.useCallback(() => {
    setIndex((i) => Math.min(i + 1, Math.max(queue.length - 1, 0)));
  }, [queue.length]);

  const previous = React.useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  const stage = React.useCallback(
    (categoryKey: string, subcategoryKey: string) => {
      if (!current) return;
      setStaged((prev) => ({ ...prev, [current.id]: { categoryKey, subcategoryKey } }));
    },
    [current],
  );

  const accept = React.useCallback(
    async ({ createRule = false }: { createRule?: boolean } = {}) => {
      const txn = current;
      if (!txn) return;
      const pick = staged[txn.id];
      const categoryKey = pick?.categoryKey ?? txn.category_key;
      const subcategoryKey = pick?.subcategoryKey ?? txn.subcategory_key;
      if (!categoryKey || !subcategoryKey) {
        toast({
          title: "Pick a category first",
          description: "Press a number key to choose one, then Enter or r.",
          variant: "destructive",
        });
        return;
      }

      const snapshot = txn;
      const queueIndexAtAccept = index;

      // Optimistic: the row leaves the queue immediately.
      setQueue((prevQueue) => prevQueue.filter((t) => t.id !== txn.id));
      setIsMutating(true);
      try {
        await patchTransaction(txn.id, {
          category_key: categoryKey,
          subcategory_key: subcategoryKey,
          create_rule: createRule,
        });
        undoStack.current = [
          ...undoStack.current,
          {
            transactionId: txn.id,
            previousCategoryKey: txn.category_key,
            previousSubcategoryKey: txn.subcategory_key,
            previousKind: txn.kind,
            queueIndex: queueIndexAtAccept,
            transactionSnapshot: snapshot,
          },
        ];
        setCanUndo(true);
        setStaged((prev) => {
          if (!(txn.id in prev)) return prev;
          const rest = { ...prev };
          delete rest[txn.id];
          return rest;
        });
        toast({
          title: createRule ? "Accepted — rule created" : "Accepted",
          variant: "success",
        });
      } catch (caught) {
        // Rollback: put the row back exactly where it was.
        setQueue((prevQueue) => {
          const restored = [...prevQueue];
          restored.splice(Math.min(queueIndexAtAccept, restored.length), 0, snapshot);
          return restored;
        });
        setIndex(queueIndexAtAccept);
        toast({
          title: "Could not save — restored to the queue",
          description: caught instanceof Error ? caught.message : undefined,
          variant: "destructive",
        });
      } finally {
        setIsMutating(false);
      }
    },
    [current, index, staged, toast],
  );

  const undo = React.useCallback(async () => {
    const entry = undoStack.current.at(-1);
    if (!entry) return;
    setIsMutating(true);
    try {
      await patchTransaction(entry.transactionId, {
        category_key: entry.previousCategoryKey,
        subcategory_key: entry.previousSubcategoryKey,
        kind: entry.previousKind,
        create_rule: false,
      });
      undoStack.current = undoStack.current.slice(0, -1);
      setCanUndo(undoStack.current.length > 0);
      setQueue((prevQueue) => {
        const restored = [...prevQueue];
        restored.splice(Math.min(entry.queueIndex, restored.length), 0, entry.transactionSnapshot);
        return restored;
      });
      setIndex(entry.queueIndex);
      toast({
        title: "Undone",
        description: "Restored for this session — see index.tsx if it should survive reload.",
      });
    } catch (caught) {
      toast({
        title: "Undo failed",
        description: caught instanceof Error ? caught.message : undefined,
        variant: "destructive",
      });
    } finally {
      setIsMutating(false);
    }
  }, [toast]);

  return {
    status,
    error,
    queue,
    index,
    current,
    isMutating,
    canUndo,
    next,
    previous,
    stage,
    stagedForCurrent: current ? staged[current.id] : undefined,
    accept,
    undo,
    refetch: load,
  };
}
