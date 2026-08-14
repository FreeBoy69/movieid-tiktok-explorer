export const BACKGROUND_PROCESS_EVENT = "autoyt:background-process";

export function announceBackgroundProcess(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BACKGROUND_PROCESS_EVENT));
}
