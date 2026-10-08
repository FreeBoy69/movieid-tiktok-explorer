// Editable Design inside the Tools suite: this wrapper owns the studio catalog
// and generation history (polling while a design runs) and hands them to the page.
import { useCallback, useEffect, useState } from "react";
import type { Catalog, Generation } from "../studio/studioShared";
import { readJson } from "../studio/studioShared";
import { EditableDesignStudio } from "../studio/EditableDesignStudio";
import { useToolHead } from "./toolHead";

export function EditableDesignTool({ theme }: { theme: "light" | "dark" }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [now, setNow] = useState(Date.now());
  const head = useToolHead()?.node;
  useEffect(() => {
    let cancelled = false;
    fetch("/api/studio/catalog")
      .then((response) => readJson(response, "Models are unavailable right now"))
      .then((data) => !cancelled && setCatalog(data))
      .catch(() => !cancelled && setCatalog({ configured: false, image: [], video: [], avatar: [], edit: [], upscale: [], motion: [], music: { available: false, name: "", reason: "" }, voices: [], agents: [], workflows: [] }));
    return () => {
      cancelled = true;
    };
  }, []);
  const refresh = useCallback(async () => {
    try {
      const data = await readJson(await fetch("/api/studio/generations", { cache: "no-store" }), "History unavailable");
      setGenerations(Array.isArray(data.generations) ? data.generations : []);
    } catch {}
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const active = generations.some((item) => item.tab === "editable-design" && (item.status === "queued" || item.status === "running"));
  useEffect(() => {
    if (!active) return;
    const poll = window.setInterval(() => void refresh(), 4000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [active, refresh]);
  return (
    <EditableDesignStudio
      embedded
      head={head}
      theme={theme}
      catalog={catalog}
      generations={generations}
      now={now}
      onCreated={(item) => {
        setGenerations((current) => [item, ...current.filter((g) => g.id !== item.id)]);
        setNow(Date.now());
      }}
      onRefresh={() => void refresh()}
      onRemoved={(id) => setGenerations((current) => current.filter((g) => g.id !== id))}
    />
  );
}
