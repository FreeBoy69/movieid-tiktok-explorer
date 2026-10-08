// Switching and disconnecting connected channels: one implementation shared by
// the header's channel picker and Account > Channels.
import { useState } from "react";
import type { ConnectedYouTubeAccount } from "../types";
import { toast } from "../utils/toast";
import { confirm } from "./ui/Dialog";

async function send(url: string, method: "POST" | "DELETE", fallback: string) {
  const response = await fetch(url, { method, credentials: "same-origin" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || fallback);
  }
}

export function useChannels(onRefresh: () => Promise<void>) {
  // "select:<id>" or "remove:<id>" while that row is working.
  const [busy, setBusy] = useState("");

  const select = async (account: ConnectedYouTubeAccount) => {
    setBusy(`select:${account.id}`);
    try {
      await send(`/api/youtube/accounts/${encodeURIComponent(account.id)}/select`, "POST", "Could not switch channel");
      await onRefresh();
      toast.success(`${account.channelTitle} is now your active channel.`);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not switch channel");
      return false;
    } finally {
      setBusy("");
    }
  };

  const disconnect = async (account: ConnectedYouTubeAccount) => {
    const ok = await confirm({
      title: `Disconnect ${account.channelTitle}?`,
      body: "Agents posting to it stop until you connect it again.",
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (!ok) return false;
    setBusy(`remove:${account.id}`);
    try {
      await send(`/api/youtube/accounts/${encodeURIComponent(account.id)}`, "DELETE", "Could not disconnect channel");
      await onRefresh();
      toast.success(`${account.channelTitle} was disconnected.`);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect channel");
      return false;
    } finally {
      setBusy("");
    }
  };

  /** The account id currently working, for list spinners. */
  const busyId = busy.split(":")[1] || "";
  return { busy, busyId, select, disconnect };
}
