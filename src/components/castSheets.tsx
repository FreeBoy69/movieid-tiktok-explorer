// Character sheets, shared by Create Video's Characters step and Create Drama's
// cast: the take-count choice, the photo upload, the full-screen take viewer
// (lock from the viewer), and the remove-character confirm.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Download, Lock, Upload, X } from "lucide-react";
import { Segmented } from "./ui/controls";
import { confirm } from "./ui/Dialog";
import { UploadButton } from "./UploadButton";
import "./CharactersStep.css";

export const SHEET_COUNTS = [1, 2, 4];
export { IMAGE_TYPES as PHOTO_TYPES } from "./UploadButton";
import { IMAGE_TYPES as PHOTO_TYPES } from "./UploadButton";
export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;

export function confirmRemoveCharacter(name: string, body = "Their locked sheet is removed from this project.") {
  return confirm({ title: `Remove ${name || "this character"}?`, body, confirmLabel: "Remove", danger: true });
}

/** How many takes the next "Generate" draws. */
export function TakeCount({ value, onChange, counts = SHEET_COUNTS }: { value: number; onChange: (count: number) => void; counts?: number[] }) {
  return (
    <Segmented
      label="Takes to generate"
      size="sm"
      value={String(value)}
      onChange={(next) => onChange(Number(next))}
      options={counts.map((n) => ({ value: String(n), label: `${n} ${n === 1 ? "take" : "takes"}` }))}
    />
  );
}

/** "Use a photo of them": one upload control for both cast screens. */
export function SheetPhotoButton({ name, onFile, onError, disabled, hasPhoto, variant = "button", className }: { name: string; onFile: (file: File) => void; onError?: (message: string) => void; disabled?: boolean; hasPhoto?: boolean; variant?: "button" | "icon"; className?: string }) {
  return (
    <UploadButton
      className={className || (variant === "icon" ? "ui-icon-btn is-bordered is-lg chs-iconbtn" : "ui-btn")}
      accept={PHOTO_TYPES}
      maxBytes={PHOTO_MAX_BYTES}
      onFile={onFile}
      onError={onError}
      disabled={disabled}
      title="Use a photo of them (with their permission). New sheets match this face."
      label={variant === "icon" ? `Use a photo of ${name}` : undefined}
    >
      <Upload size={variant === "icon" ? 16 : 15} />
      {variant === "icon" ? null : hasPhoto ? "Replace photo" : "From a photo"}
    </UploadButton>
  );
}

// Full-screen sheet viewer: arrows or ←/→ step through takes, Esc closes.
export function SheetViewer({
  name,
  images,
  locked,
  index,
  busy,
  onIndex,
  onClose,
  onLock,
  noun = "character",
}: {
  noun?: string;
  name: string;
  images: string[];
  locked: string;
  index: number;
  busy: boolean;
  onIndex: (index: number) => void;
  onClose: () => void;
  onLock: (asset: string) => void;
}) {
  const asset = images[index];
  const step = (delta: number) => onIndex((index + delta + images.length) % images.length);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  });
  return createPortal(
    <div className="chs-lightbox" role="dialog" aria-modal="true" aria-label={`${name} ${noun} sheets`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <header className="chs-lb-bar">
        <div>
          <strong>{name}</strong>
          <span>
            {asset === locked ? "Locked sheet" : `Take ${images.length - index} of ${images.length}`}
          </span>
        </div>
        <div className="chs-lb-actions">
          {asset === locked ? (
            <span className="chs-status is-locked">
              <Lock size={12} />
              Locked
            </span>
          ) : (
            <button type="button" className="chs-lb-lock" disabled={busy} onClick={() => onLock(asset)}>
              <Check size={15} />
              Lock this take
            </button>
          )}
          <a className="chs-lb-icon" href={asset} download title="Download" aria-label="Download this sheet">
            <Download size={17} />
          </a>
          <button type="button" className="chs-lb-icon" aria-label="Close" autoFocus onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="chs-lb-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {images.length > 1 ? (
          <button type="button" className="chs-lb-nav is-prev" aria-label="Previous take" onClick={() => step(-1)}>
            <ChevronLeft size={22} />
          </button>
        ) : null}
        <img key={asset} src={asset} alt={`${name} ${noun} sheet`} />
        {images.length > 1 ? (
          <button type="button" className="chs-lb-nav is-next" aria-label="Next take" onClick={() => step(1)}>
            <ChevronRight size={22} />
          </button>
        ) : null}
      </div>
      {images.length > 1 ? (
        <div className="chs-lb-strip">
          {images.map((item, i) => (
            <button key={item} type="button" aria-current={i === index || undefined} aria-label={item === locked ? "Locked sheet" : `Take ${images.length - i}`} onClick={() => onIndex(i)}>
              <img src={item} alt="" />
              {item === locked ? (
                <span className="chs-take-lock">
                  <Lock size={10} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
