// Site-wide toasts. Any component can call toast.error("…") or use
// useErrorToast(error, clear) to show a failure without an inline banner.
// <Toaster /> (mounted once in main.tsx) renders the stack.
import { useEffect, useSyncExternalStore } from "react";

export type ToastTone = "error" | "success" | "info";
export type ToastAction = { label: string; onClick: () => void };
export type Toast = { id: number; tone: ToastTone; title?: string; message: string; action?: ToastAction; duration: number; count: number };
type ToastOptions = { title?: string; action?: ToastAction; duration?: number };

const DEFAULT_MS: Record<ToastTone, number> = { error: 8000, success: 4000, info: 5000 };
const MAX_VISIBLE = 4;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function push(tone: ToastTone, message: unknown, options: ToastOptions = {}) {
  const text = messageOf(message);
  if (!text) return 0;
  // The same message again (a poll failing every few seconds) bumps a counter instead of stacking.
  const same = toasts.find((item) => item.tone === tone && item.message === text && item.title === options.title);
  if (same) {
    toasts = toasts.map((item) => (item === same ? { ...item, count: item.count + 1, id: nextId++ } : item));
  } else {
    const item: Toast = { id: nextId++, tone, message: text, title: options.title, action: options.action, duration: options.duration ?? DEFAULT_MS[tone], count: 1 };
    toasts = [...toasts, item].slice(-MAX_VISIBLE);
  }
  emit();
  return toasts[toasts.length - 1]?.id || 0;
}

export function messageOf(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (value instanceof Error) return value.message.trim();
  return String(value).trim();
}

export const toast = {
  error: (message: unknown, options?: ToastOptions) => push("error", message, options),
  success: (message: unknown, options?: ToastOptions) => push("success", message, options),
  info: (message: unknown, options?: ToastOptions) => push("info", message, options),
  dismiss(id: number) {
    toasts = toasts.filter((item) => item.id !== id);
    emit();
  },
  clear() {
    toasts = [];
    emit();
  },
};

export function useToasts() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => toasts,
    () => toasts,
  );
}

// Shows `error` as a toast whenever it becomes non-empty, then calls `clear`
// so the same message can fire again and nothing renders inline.
export function useErrorToast(error: unknown, clear?: () => void, options?: ToastOptions) {
  const text = messageOf(error);
  useEffect(() => {
    if (!text) return;
    toast.error(text, options);
    clear?.();
    // options/clear are intentionally not dependencies: only a new message fires a toast.
  }, [text]);
}
