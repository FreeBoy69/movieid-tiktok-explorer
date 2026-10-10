// The agent's Remake tab: the full re-voice pipeline (narration style,
// rewrite, voiceover, avatar swap, soundtrack, subtitles) for this channel's
// videos. It replaced the standalone Voiceover Studio; the single-purpose
// pieces live in the Tools suite and the studios (Vocal Remover, Lip Sync,
// Body Swap, Audio Studio).
import { useEffect, useState } from "react";
import { VoiceoverStudio } from "./VoiceoverStudio";
import { REMAKE_HANDOFF_KEY } from "../utils/agentRemake.js";
function takeHandoff(agentId: string): string {
  try {
    const raw = window.sessionStorage.getItem(REMAKE_HANDOFF_KEY);
    if (!raw) return "";
    const value = JSON.parse(raw) as { agentId?: string; uploadId?: string; at?: number };
    if (value.agentId !== agentId || Date.now() - Number(value.at || 0) > 10 * 60 * 1000) return "";
    window.sessionStorage.removeItem(REMAKE_HANDOFF_KEY);
    return String(value.uploadId || "");
  } catch {
    return "";
  }
}

export function AgentRemake({ agentId, theme, accountId }: { agentId: string; theme: "light" | "dark"; accountId?: string }) {
  const [uploadId, setUploadId] = useState(() => takeHandoff(agentId));
  useEffect(() => {
    setUploadId(takeHandoff(agentId));
  }, [agentId]);
  return (
    <div className="agent-remake">
      <VoiceoverStudio
        embedded
        lockAgent
        title="Remake"
        theme={theme}
        accountId={accountId}
        agentId={agentId}
        uploadId={uploadId || undefined}
        onSourceChange={(source) => setUploadId(source.uploadId || "")}
      />
    </div>
  );
}
