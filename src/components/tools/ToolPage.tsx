// One page per tool in the Tools suite, in the studio layout every studio uses:
// the title, the tool's controls inside the chat box frame, then the results.
import { type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type { ToolId } from "../../utils/tiktokRoute";
import type { NavTarget } from "../../utils/appNavigation";
import { TOOLS, toolEntry } from "./toolApps";
import { StudioTool } from "./StudioTool";
import { Transcriber } from "./Transcriber";
import { PosterFinder } from "./PosterFinder";
import { ThumbnailDownloader } from "./ThumbnailDownloader";
import { TextTool } from "./TextTool";
import { EditableDesignTool } from "./EditableDesignTool";
import { MovieRecap } from "./MovieRecap";
import { ToolHead, useToolHead } from "./toolHead";
import { StudioLayout } from "../StudioLayout";
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
        {tool.kind === "design" ? <EditableDesignTool theme={theme} /> : null}
        {tool.kind === "recap" ? <MovieRecap /> : null}
        {tool.kind === "image" || tool.kind === "thumbnail" || tool.kind === "video-upscale" || tool.kind === "stems" || tool.kind === "watch" ? <StudioTool key={tool.id} tool={tool} /> : null}
      </ToolShell>
    </div>
  );
}

export function ToolShell({ toolId, onNavigate, children }: { toolId: ToolId; onNavigate: (target: NavTarget) => void; children: ReactNode }) {
  const tool = TOOLS[toolId];
  const entry = toolEntry(toolId);
  const back = (
    <button type="button" className="mt-back" onClick={() => onNavigate({ view: "tools" })}>
      <ArrowLeft size={15} aria-hidden="true" /> All tools
    </button>
  );
  const head = (
    <header className="mt-head">
      {back}
      <div className="mt-head-main">
        {entry ? <span className="mt-mark" aria-hidden="true">{entry.icon}</span> : null}
        <div>
          <h1 id="mt-title">{entry?.label || tool.id}</h1>
          <p className="mt-tagline">{tool.tagline}</p>
        </div>
      </div>
    </header>
  );
  return (
    <section className="mt" aria-labelledby="mt-title">
      <div className="mt-inner">
        <ToolHead.Provider value={{ node: head, title: entry?.label || tool.id, tagline: tool.tagline, back }}>{children}</ToolHead.Provider>
      </div>
    </section>
  );
}

/** The tool's controls in the chat box frame on top, its results below. */
export function ToolLayout({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  const head = useToolHead();
  return (
    <StudioLayout
      title={<span id="mt-title">{head?.title}</span>}
      intro={head?.tagline}
      back={head?.back}
      composer={<div className="sl-box no-stack mt-box mt-panel"><div className="mt-panel-scroll">{panel}</div></div>}
    >
      <div className="mt-stage mt-results">{children}</div>
    </StudioLayout>
  );
}
