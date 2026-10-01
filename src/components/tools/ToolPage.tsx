// One page per tool in the Tools suite. The shell carries the title row and the
// control-column + stage layout; each tool fills both sides.
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type { ToolId } from "../../utils/tiktokRoute";
import type { NavTarget } from "../../utils/appNavigation";
import { TOOLS, toolEntry } from "./toolApps";
import { StudioTool } from "./StudioTool";
import { Transcriber } from "./Transcriber";
import { PosterFinder } from "./PosterFinder";
import { ThumbnailDownloader } from "./ThumbnailDownloader";
import { TextTool } from "./TextTool";
import { VideoDownloader } from "../VideoDownloader";
import "../CreatorStudio.css";
import "./MiniTools.css";

type Theme = "light" | "dark";

export function ToolPage({ toolId, theme, onNavigate }: { toolId: ToolId; theme: Theme; onNavigate: (target: NavTarget) => void }) {
  const tool = TOOLS[toolId];
  if (tool.kind === "audio-extract") {
    return (
      <div className="cstudio" data-theme={theme}>
        <VideoDownloader theme={theme} fixedMode="audio" heading="Audio extractor" lead={tool.tagline} />
      </div>
    );
  }
  return (
    <div className="cstudio" data-theme={theme}>
      <ToolShell toolId={toolId} onNavigate={onNavigate}>
        {tool.kind === "transcribe" ? <Transcriber tool={tool} /> : null}
        {tool.kind === "poster" ? <PosterFinder tool={tool} /> : null}
        {tool.kind === "thumbnail-download" ? <ThumbnailDownloader tool={tool} /> : null}
        {tool.kind === "text" ? <TextTool key={tool.id} tool={tool} /> : null}
        {tool.kind === "image" || tool.kind === "thumbnail" || tool.kind === "video-upscale" ? <StudioTool key={tool.id} tool={tool} /> : null}
      </ToolShell>
    </div>
  );
}

export function ToolShell({ toolId, onNavigate, children }: { toolId: ToolId; onNavigate: (target: NavTarget) => void; children: ReactNode }) {
  const tool = TOOLS[toolId];
  const entry = toolEntry(toolId);
  return (
    <section className="mt" aria-labelledby="mt-title">
      <div className="mt-inner">
        <header className="mt-head">
          <div className="mt-head-main">
            {entry ? <span className="mt-mark" aria-hidden="true">{entry.icon}</span> : null}
            <div>
              <h1 id="mt-title">{entry?.label || tool.id}</h1>
              <p className="mt-tagline">{tool.tagline}</p>
            </div>
          </div>
          <button type="button" className="mt-back" onClick={() => onNavigate({ view: "tools" })}>
            <ArrowLeft size={15} aria-hidden="true" /> All tools
          </button>
        </header>
        {children}
      </div>
    </section>
  );
}

/** Control column beside the results stage; stacks on phones. */
export function ToolLayout({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-grid">
      <div className="mt-panel">{panel}</div>
      <div className="mt-stage">{children}</div>
    </div>
  );
}
