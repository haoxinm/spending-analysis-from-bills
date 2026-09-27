import * as React from "react";

export interface ToastRecord {
  id: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: "default" | "destructive" | "success";
  duration?: number;
}

export type ToastInput = Omit<ToastRecord, "id">;

export interface ToastContextValue {
  toasts: ToastRecord[];
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

export const ToastContext = React.createContext<ToastContextValue | null>(null);
