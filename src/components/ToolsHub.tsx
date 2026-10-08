// The home page (view "tools", served at "/"): the Create page, one chat box and every template.
import type { MainView } from "../utils/tiktokRoute";
import type { NavTarget } from "../utils/appNavigation";
import { CreateHub } from "./CreateHub";

export function ToolsHub({ theme, signedIn, onSignIn, onOpen, onNavigate }: { theme: "light" | "dark"; signedIn: boolean; onSignIn: () => void; onOpen: (view: MainView) => void; onNavigate?: (target: NavTarget) => void }) {
  return <CreateHub theme={theme} signedIn={signedIn} onSignIn={onSignIn} onNavigate={onNavigate || ((target) => onOpen(target.view))} />;
}
