import { ScanText, Subtitles, Download } from "lucide-react";
import { DEFAULT_SUBTITLES, normalizeSubtitleSettings } from "../utils/voiceoverSubtitles.js";

export type SubtitleSettings = typeof DEFAULT_SUBTITLES;
export function SubtitleSettingsPanel({ value, onChange, running, onEstimate, canEstimate, estimated, srtUrl }: {
  value: SubtitleSettings; onChange: (value: SubtitleSettings) => void; running: boolean;
  onEstimate: () => void; canEstimate: boolean; estimated: string; srtUrl?: string;
}) {
  const update = (patch: Partial<SubtitleSettings>) => onChange(normalizeSubtitleSettings({ ...value, ...patch }));
  return (
    <div className="vs-tool voice-subtitle-settings">
      <header className="vs-tool-head"><h2><Subtitles size={16} />Captions</h2></header>
      <label><input type="checkbox" checked={value.enabled} disabled={running} onChange={(e) => { update({ enabled: e.target.checked }); if (e.target.checked && value.autoPlacement && canEstimate) onEstimate(); }} />Include in render</label>
      <div className="voice-segmented" aria-label="Cover original captions">
        <button type="button" aria-pressed={value.treatment === "strip"} disabled={running} onClick={() => { update({ treatment: "strip", enabled: true, autoPlacement: true }); if (canEstimate) onEstimate(); }}>Strip</button>
        <button type="button" aria-pressed={value.treatment === "blur"} disabled={running} onClick={() => { update({ treatment: "blur", enabled: true, autoPlacement: true }); if (canEstimate) onEstimate(); }}>Blur</button>
      </div>
      <label><input type="checkbox" checked={value.autoPlacement} disabled={running} onChange={(e) => { update({ autoPlacement: e.target.checked }); if (e.target.checked && canEstimate) onEstimate(); }} />Auto place</label>
      <button type="button" className="voice-button" disabled={running || !canEstimate} onClick={onEstimate}><ScanText size={16} />Detect</button>
      {estimated ? <p className="voice-notice" role="status">{estimated}</p> : null}
      <fieldset disabled={running}>
        <legend>Style</legend>
        {!value.autoPlacement && <>
          <label className="voice-subtitle-range"><span>Top</span><input aria-label="Caption band top" type="range" min="0" max="94" step="0.5" value={value.y} onChange={(e) => update({ y: Number(e.target.value) })} /><output>{value.y}%</output></label>
          <label className="voice-subtitle-range"><span>Height</span><input aria-label="Caption band height" type="range" min="6" max={100 - value.y} step="0.5" value={value.height} onChange={(e) => update({ height: Number(e.target.value) })} /><output>{value.height}%</output></label>
        </>}
        <label className="voice-subtitle-range"><span>Size</span><input aria-label="Subtitle text size" type="range" min="2" max="8" step="0.1" value={value.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} /><output>{value.fontSize}%</output></label>
        <div className="voice-subtitle-type">
          <label><span>Font</span><select aria-label="Subtitle typeface" value={value.font} onChange={(e) => update({ font: e.target.value })}><option>Arial</option><option>DejaVu Sans</option><option>Liberation Serif</option></select></label>
          <label><span>Color</span><input aria-label="Subtitle color" type="color" value={value.color} onChange={(e) => update({ color: e.target.value })} /></label>
          <label><input type="checkbox" checked={value.bold} onChange={(e) => update({ bold: e.target.checked })} />Bold</label>
          <label><input type="checkbox" checked={value.italic} onChange={(e) => update({ italic: e.target.checked })} />Italic</label>
        </div>
        <label className="voice-subtitle-range"><span>Outline</span><input aria-label="Subtitle outline" type="range" min="0" max="6" step="0.5" value={value.outline} onChange={(e) => update({ outline: Number(e.target.value) })} /><output>{value.outline}px</output></label>
      </fieldset>
      {srtUrl ? <a className="voice-button" href={srtUrl} download><Download size={15} />SRT</a> : null}
    </div>
  );
}
