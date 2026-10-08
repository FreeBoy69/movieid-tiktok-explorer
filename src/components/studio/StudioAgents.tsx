// Agents and Design Agent: Juel, working as the Creative Studio persona picked here. It starts generations
// straight away (each one's credits shown) and previews them in the conversation as they finish.
import { useEffect, useState } from "react";
import { STUDIO_APPS } from "./studioApps";
import { type Catalog, type Generation, Tabs } from "./studioShared";
import { JuelPanel, provideJuelContext } from "../JuelPanel";

const DESIGN_STARTERS = ["A bold poster for my channel's Friday premiere", "Three logo directions for a movie recap channel", "An Instagram carousel cover about 5 hidden film details"];
const AGENT_STARTERS = ["Plan and make a 3-shot teaser for a sci-fi recap", "Design a thumbnail for 'The ending nobody expected'", "Create a moody music cue and a matching cover image"];

export function StudioAgents({ mode, catalog }: { mode: "agents" | "design-agent"; catalog: Catalog | null; generations?: Generation[]; now?: number; onGenerations?: () => void }) {
  const [agent, onAgent] = useState("creative");
  const agents = (catalog?.agents || []).filter((a) => (mode === "design-agent" ? a.id === "design" : a.id !== "design"));
  const persona = mode === "design-agent" ? "design" : agents.some((a) => a.id === agent) ? agent : "creative";
  const info = catalog?.agents.find((a) => a.id === persona);
  const meta = STUDIO_APPS[mode];
  const name = info?.name || meta.label;
  const intro = info?.intro || meta.body;

  // Juel takes on the persona; its conversations are kept per persona.
  useEffect(() => {
    const starters = (mode === "design-agent" ? DESIGN_STARTERS : AGENT_STARTERS).map((s) => ({ label: s, prompt: s }));
    return provideJuelContext(() => ({ surface: "studio", entityId: `agent:${persona}`, label: name, details: { persona, app: mode }, starters, intro: { title: name, body: intro } }));
  }, [persona, name, intro, mode]);

  return (
    <>
      <div className="cs-agent-bar">
        {mode === "agents" && agents.length > 1 ? (
          <Tabs label="Agent" value={persona} options={agents.map((a) => ({ value: a.id, label: a.name }))} onChange={onAgent} />
        ) : (
          <p className="cs-agent-name">{name}</p>
        )}
      </div>
      <div className="cs-canvas cs-chat cs-juel">
        <JuelPanel embedded />
      </div>
    </>
  );
}
