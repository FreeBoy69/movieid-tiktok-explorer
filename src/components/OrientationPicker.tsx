// Vertical vs landscape for compilations: the shared Segmented with a frame glyph.
import { Segmented } from "./ui/controls";

const Frame = ({ w, h }: { w: number; h: number }) => (
  <span aria-hidden="true" style={{ display: "inline-block", width: w, height: h, border: "1.5px solid currentColor", borderRadius: 3, opacity: 0.8 }} />
);

export function OrientationPicker({ value, onChange, label = "Layout" }: { value: string; onChange: (value: "vertical" | "landscape") => void; label?: string }) {
  return (
    <Segmented
      block
      label={label}
      value={value === "landscape" ? "landscape" : "vertical"}
      onChange={onChange}
      options={[
        { value: "vertical", label: "Vertical", hint: "9:16", icon: <Frame w={9} h={15} /> },
        { value: "landscape", label: "Landscape", hint: "16:9", icon: <Frame w={16} h={9} /> },
      ]}
    />
  );
}
