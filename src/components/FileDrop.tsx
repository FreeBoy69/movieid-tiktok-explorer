// The one drag-and-drop file zone. Hosts keep their own upload logic; this
// handles dragging, type/size checks, the chosen-file state and progress.
import { type DragEvent, type ReactNode, useRef, useState } from "react";
import { Upload } from "lucide-react";
import "./FileDrop.css";

type Props = {
  /** Called with the accepted files (one unless `multiple`). */
  onFiles: (files: File[]) => void;
  /** `accept` attribute for the file dialog; also used to reject dropped files. */
  accept?: string;
  multiple?: boolean;
  /** Largest file in bytes; bigger files are rejected through `onError`. */
  maxBytes?: number;
  onError?: (message: string) => void;
  title: string;
  hint?: ReactNode;
  icon?: ReactNode;
  buttonLabel?: string;
  /** The chosen file, shown in place of the prompt. */
  file?: { name: string; size?: number } | null;
  /** 0–1 while uploading; replaces the Change button. */
  progress?: number | null;
  onClear?: () => void;
  disabled?: boolean;
  /** Extra controls under the button, e.g. a paste-a-link form. */
  children?: ReactNode;
  footnote?: ReactNode;
  size?: "compact" | "roomy";
  className?: string;
};

export function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Matches a file against an accept string ("video/*,.mkv,audio/mpeg").
export function acceptsFile(file: File, accept?: string) {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return accept.split(",").some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith(".")) return name.endsWith(rule);
    if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

export function FileDrop({
  onFiles,
  accept,
  multiple,
  maxBytes,
  onError,
  title,
  hint,
  icon,
  buttonLabel = multiple ? "Choose files" : "Choose file",
  file,
  progress = null,
  onClear,
  disabled,
  children,
  footnote,
  size = "compact",
  className,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);

  const take = (list: FileList | File[] | null | undefined) => {
    const files = [...(list || [])];
    if (!files.length || disabled) return;
    const typed = files.filter((f) => acceptsFile(f, accept));
    if (!typed.length) return onError?.(`That file type isn't supported here.`);
    const sized = maxBytes ? typed.filter((f) => f.size <= maxBytes) : typed;
    if (!sized.length) return onError?.(`Files up to ${formatBytes(maxBytes!)} can be uploaded.`);
    onFiles(multiple ? sized : sized.slice(0, 1));
  };

  const onDragEnter = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    depth.current += 1;
    setOver(true);
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setOver(false);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    depth.current = 0;
    setOver(false);
    take(event.dataTransfer.files);
  };

  const uploading = progress !== null && progress !== undefined;
  return (
    <div
      className={["file-drop", `file-drop-${size}`, className].filter(Boolean).join(" ")}
      data-over={over || undefined}
      data-filled={file ? true : undefined}
      data-disabled={disabled || undefined}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.dataTransfer.types.includes("Files") && event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(event) => {
          take(event.target.files);
          event.target.value = "";
        }}
      />
      <span className="file-drop-icon" aria-hidden="true">{icon || <Upload size={size === "roomy" ? 22 : 18} />}</span>
      {file ? (
        <>
          <strong className="file-drop-title file-drop-name" title={file.name}>{file.name}</strong>
          {file.size ? <span className="file-drop-hint file-drop-num">{formatBytes(file.size)}</span> : null}
          {uploading ? (
            <span className="file-drop-bar" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress || 0) * 100)}>
              <span style={{ width: `${Math.max(3, (progress || 0) * 100)}%` }} />
            </span>
          ) : onClear ? (
            <button type="button" className="file-drop-link" onClick={onClear} disabled={disabled}>Change</button>
          ) : null}
        </>
      ) : (
        <>
          <strong className="file-drop-title">{over ? "Drop to add" : title}</strong>
          {hint ? <span className="file-drop-hint">{hint}</span> : null}
          <button type="button" className={`ui-btn ${size === "roomy" ? "is-primary" : "is-sm"} file-drop-button`} onClick={() => input.current?.click()} disabled={disabled}>
            {buttonLabel}
          </button>
          {children}
        </>
      )}
      {footnote ? <small className="file-drop-foot">{footnote}</small> : null}
    </div>
  );
}
