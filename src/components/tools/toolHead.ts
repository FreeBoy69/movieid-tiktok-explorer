// The tool shell renders the title row at the top of each tool's control column.
// Tools that lay out their own column read it from here.
import { createContext, useContext, type ReactNode } from "react";

export const ToolHead = createContext<ReactNode>(null);
export const useToolHead = () => useContext(ToolHead);
