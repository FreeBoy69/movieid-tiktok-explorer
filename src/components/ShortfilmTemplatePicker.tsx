import { useState } from "react";
import { Check, Film, X } from "lucide-react";
import { SHORTFILM_SOURCE, SHORTFILM_TEMPLATES, shortfilmTemplateThumb } from "../utils/shortfilmTemplates.js";
import "./ShortfilmTemplatePicker.css";

export type ShortfilmTemplate = (typeof SHORTFILM_TEMPLATES)[number];

/* "Start from a template": pick a genre shot template, then optionally fill its slots.
   onPick fires on every change; a null template means start blank. */
export default function ShortfilmTemplatePicker({
  value = "",
  onPick,
}: {
  value?: string;
  onPick: (template: ShortfilmTemplate | null, values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const selected = SHORTFILM_TEMPLATES.find((template) => template.id === value) || null;

  const choose = (template: ShortfilmTemplate) => {
    const next = template.id === value ? null : template;
    setValues({});
    onPick(next, {});
  };
  const edit = (name: string, text: string) => {
    const next = { ...values, [name]: text };
    setValues(next);
    if (selected) onPick(selected, next);
  };

  return (
    <section className="shortfilm-picker" aria-label="Start from a template">
      <div className="maker-art-grid" role="radiogroup" aria-label="Video template">
        {SHORTFILM_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            role="radio"
            aria-checked={value === template.id}
            className="maker-art-tile"
            onClick={() => choose(template)}
            title={template.tagline}
          >
            <span className="maker-art-swatch">
              {broken[template.id] ? (
                <Film size={20} />
              ) : (
                <img
                  src={shortfilmTemplateThumb(template.id)}
                  alt=""
                  loading="lazy"
                  onError={() => setBroken((current) => ({ ...current, [template.id]: true }))}
                />
              )}
            </span>
            <strong>{template.name}</strong>
            <small>
              {template.genre} · {template.aspect}
            </small>
            {value === template.id && <Check size={14} className="maker-art-check" />}
          </button>
        ))}
      </div>

      {selected && (
        <div className="shortfilm-picker-detail">
          <header>
            <div>
              <strong>{selected.name}</strong>
              <p>{selected.tagline}</p>
            </div>
            <button type="button" className="maker-icon" aria-label="Clear template" onClick={() => choose(selected)}>
              <X size={14} />
            </button>
          </header>
          <ol className="shortfilm-picker-beats" aria-label="Beats">
            {selected.beats.map((beat) => (
              <li key={beat.role}>
                <span>{beat.label}</span>
                <small>{beat.camera}</small>
              </li>
            ))}
          </ol>
          <div className="shortfilm-picker-fields">
            {selected.variables.map((item) => (
              <label key={item.name}>
                <span>{item.label}</span>
                <input
                  value={values[item.name] || ""}
                  placeholder={item.example}
                  maxLength={300}
                  onChange={(event) => edit(item.name, event.target.value)}
                />
              </label>
            ))}
          </div>
          <p className="shortfilm-picker-note">
            Leave a field empty to use the example. Template adapted from{" "}
            <a href={SHORTFILM_SOURCE.url} target="_blank" rel="noreferrer">
              {SHORTFILM_SOURCE.name}
            </a>{" "}
            by {SHORTFILM_SOURCE.author} ({SHORTFILM_SOURCE.license}).
          </p>
        </div>
      )}
    </section>
  );
}
