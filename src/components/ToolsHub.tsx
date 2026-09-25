// The Explore home page (view "tools", served at "/").
import type { MainView } from "../utils/tiktokRoute";
import type { NavTarget } from "../utils/appNavigation";
import { ExploreHome } from "./ExploreHome";

export function ToolsHub({ theme, onOpen, onNavigate }: { theme: "light" | "dark"; onOpen: (view: MainView) => void; onNavigate?: (target: NavTarget) => void }) {
  return <ExploreHome theme={theme} onNavigate={onNavigate || ((target) => onOpen(target.view))} />;
}
