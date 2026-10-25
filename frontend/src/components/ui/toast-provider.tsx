import * as React from "react";

import { ToastContext, type ToastInput, type ToastRecord } from "@/components/ui/toast-context";

const TOAST_LIMIT = 5;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `toast-${idCounter}`;
}

/**
 * Toast provider. Wrap the app once (see `App.tsx`); every screen calls `useToast()`
 * (`components/ui/use-toast.ts`) to push a notification, and `<Toaster />`
 * (`components/ui/toaster.tsx`) renders the queue.
 */
export function ToastContextProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback((input: ToastInput) => {
    const id = nextId();
    setToasts((current) => [...current, { id, ...input }].slice(-TOAST_LIMIT));
    return id;
  }, []);

  const value = React.useMemo(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}
