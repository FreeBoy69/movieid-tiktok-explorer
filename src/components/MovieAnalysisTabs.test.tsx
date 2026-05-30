import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MovieAnalysisTabs } from "./MovieAnalysisTabs";
import type { MovieResult } from "../types";

describe("MovieAnalysisTabs", () => {
  it("renders a corrected Movie ID result when evidence is not present", () => {
    const correctedResult = {
      title: "Hero Without a Class: Who Even Needs Skills?!",
      confidence: 1,
      summary: "A corrected anime result backed by title metadata.",
      mal: {
        id: 59161,
        title: "Hero Without a Class: Who Even Needs Skills?!",
        synopsis: "A hero keeps training after being assigned no class.",
      },
    } as MovieResult;

    render(<MovieAnalysisTabs result={correctedResult} hideTabs activeTab="evidence" />);

    expect(screen.getAllByText("Audio clues")).not.toHaveLength(0);
    expect(screen.getByText("No evidence returned.")).toBeInTheDocument();
  });
});
