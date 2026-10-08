// One "choose an image" button: a styled trigger plus a hidden file input with a
// type and size check. Large drop areas use FileDrop; this is the compact form.
import { type ReactNode, useRef } from "react";
import { acceptsFile, formatBytes } from "./FileDrop";

export const IMAGE_TYPES = "image/png,image/jpeg,image/webp";

export function UploadButton({
  onFile,
  onError,
  accept = IMAGE_TYPES,
  maxBytes,
  disabled,
  className,
  title,
  label,
  children,
}: {
  onFile: (file: File) => void;
  onError?: (message: string) => void;
  accept?: string;
  maxBytes?: number;
  disabled?: boolean;
  className?: string;
  title?: string;
  /** Accessible name when the button shows only an icon. */
  label?: string;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} title={title} aria-label={label} onClick={() => input.current?.click()}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (!acceptsFile(file, accept)) return onError?.("That file type isn't supported here.");
          if (maxBytes && file.size > maxBytes) return onError?.(`Choose a file smaller than ${formatBytes(maxBytes)}.`);
          onFile(file);
        }}
      />
    </>
  );
}
