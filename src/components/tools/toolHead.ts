// The tool shell's title, tagline, and back link. ToolLayout draws them in the
// studio layout; tools that lay out their own page use the ready-made header node.
import { createContext, useContext, type ReactNode } from "react";

export type ToolHeadInfo = { node: ReactNode; title: string; tagline: string; back: ReactNode };
export const ToolHead = createContext<ToolHeadInfo | null>(null);
export const useToolHead = () => useContext(ToolHead);
