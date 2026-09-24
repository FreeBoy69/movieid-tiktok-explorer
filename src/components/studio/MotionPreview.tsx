import { useEffect, useState } from "react";
import { Download, Loader2, RotateCcw } from "lucide-react";
import { readJson } from "./studioShared";
import { toast } from "../../utils/toast";
import { VideoPlayer } from "../VideoPlayer";

export function MotionPreview({ url, generationId, aspect = "16:9", title }: { url: string; generationId: string; aspect?: string; title: string }) {
  const [document, setDocument] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [exporting, setExporting] = useState("");
  const [rendered, setRendered] = useState<{ url: string; type: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch(url, { signal: controller.signal, credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load the motion preview");
        const html = await response.text();
        if (!/<html[\s>]/i.test(html)) throw new Error("The motion preview is not a valid document");
        const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'">`;
        setDocument(html.replace(/<head[^>]*>/i, (head) => head + policy));
      })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [url, revision]);
  async function exportMotion(format: "mp4" | "gif") {
    setExporting(format);
    try {
      const { output } = await readJson(await fetch(`/api/studio/generations/${generationId}/export`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format }),
      }), "Motion export failed");
      setRendered(output);
      const link = window.document.createElement("a");
      link.href = `${output.url}?download=1`;
      link.download = output.file;
      link.click();
    } catch (err) { toast.error((err as Error).message, { title: "Export failed" }); }
    finally { setExporting(""); }
  }
  return <div>
    {rendered?.type === "video/mp4" ? <VideoPlayer className="cs-motion" src={rendered.url} autoPlay loop label={title} />
      : rendered?.type === "image/gif" ? <img className="cs-motion" src={rendered.url} alt={title} />
      : document ? <iframe key={revision} className="cs-motion" srcDoc={document} sandbox="allow-scripts" title={title} style={{ aspectRatio: aspect.replace(":", " / "), height: "auto", minHeight: 180 }} />
      : <div className="cs-pending-row"><Loader2 size={16} className="animate-spin" />Loading preview</div>}
    <div className="cs-motion-tools">
      <button className="cs-ghost" title="Replay motion" onClick={() => { setRendered(null); setRevision((value) => value + 1); }}><RotateCcw size={14} />Replay</button>
      {(["mp4", "gif"] as const).map((format) => <button key={format} className="cs-ghost" disabled={Boolean(exporting)} onClick={() => void exportMotion(format)}>
        {exporting === format ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}{exporting === format ? "Rendering" : format.toUpperCase()}
      </button>)}
    </div>
    {error && <p role="alert" className="cs-failed">{error}</p>}
  </div>;
}
