import * as React from "react";

import { ToastContext, type ToastContextValue } from "@/components/ui/toast-context";

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastContextProvider>");
  }
  return ctx;
}
