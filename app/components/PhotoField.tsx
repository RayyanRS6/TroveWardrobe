"use client";

import { useRef, useState, type DragEvent } from "react";
import { PHOTO_ACCEPT } from "../lib/client/photo";
import { Photo } from "./Photo";

/** The photo chosen in a form, as it moves from pick → ready to upload. */
export type PhotoChoice =
  | { status: "none" }
  | { status: "preparing"; name: string }
  | { status: "ready"; file: File; previewUrl: string | null; name: string }
  | { status: "error"; message: string };

type PhotoFieldProps = {
  id: string;
  choice: PhotoChoice;
  /** The saved photo when editing; the field then offers "Change photo". */
  currentUrl?: string;
  required?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  onPick: (file: File) => void;
  /** Editing only: forget the new pick and keep the saved photo. */
  onReset?: () => void;
};

function hasFiles(event: DragEvent) {
  return [...event.dataTransfer.types].includes("Files");
}

/**
 * Photo picker: a button that opens the camera roll / file browser (no
 * forced camera), plus drag and drop on desktop.
 */
export function PhotoField({
  id,
  choice,
  currentUrl,
  required = false,
  invalid = false,
  disabled = false,
  onPick,
  onReset,
}: PhotoFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const statusId = `${id}-status`;

  const preview = choice.status === "ready" ? choice.previewUrl : (currentUrl ?? null);
  const hasImage = Boolean(preview);
  // e.g. HEIC outside Safari: ready to upload, but nothing to show.
  const unpreviewable = choice.status === "ready" && !choice.previewUrl ? choice.name : null;
  const editing = Boolean(currentUrl);

  let status: string;
  switch (choice.status) {
    case "preparing":
      status = "Preparing photo…";
      break;
    case "ready":
      status = choice.previewUrl
        ? "New photo ready."
        : `${choice.name} is ready. This browser can't preview it, but Trove will convert it when you save.`;
      break;
    case "error":
      status = choice.message;
      break;
    default:
      status = editing
        ? "Current photo."
        : "JPG, PNG, WebP or HEIC, up to 10 MB. Large photos are shrunk before upload.";
  }

  function choose() {
    if (!disabled) input.current?.click();
  }

  return (
    <div className="field photo-field">
      <span className="field-label" id={`${id}-label`}>
        Photo
        {required && (
          <span className="required-mark" aria-hidden="true">
            *
          </span>
        )}
      </span>
      <button
        id={id}
        type="button"
        className={`photo-drop${hasImage ? " has-image" : ""}${dragging ? " is-dragging" : ""}${
          invalid ? " is-invalid" : ""
        }`}
        onClick={choose}
        aria-labelledby={`${id}-label ${id}-action`}
        aria-describedby={statusId}
        aria-disabled={disabled || undefined}
        onDragEnter={(event) => {
          if (!hasFiles(event) || disabled) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (!hasFiles(event) || disabled) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file && !disabled) onPick(file);
        }}
      >
        {preview && <Photo src={preview} alt="" className="photo-drop-image" eager />}
        <span className={hasImage ? "photo-drop-badge" : "photo-drop-copy"} id={`${id}-action`}>
          {choice.status === "preparing" ? (
            <span className="photo-drop-busy">Preparing photo…</span>
          ) : hasImage ? (
            "Change photo"
          ) : unpreviewable ? (
            <>
              <strong className="photo-drop-name">{unpreviewable}</strong>
              <span className="photo-drop-hint">Ready to upload · choose a different photo</span>
            </>
          ) : (
            <>
              <strong className="photo-drop-title">Add a clear photo</strong>
              <span className="photo-drop-hint">
                From your gallery or camera<span className="pointer-fine">, or drop it here</span>
              </span>
              <span className="photo-drop-cta" aria-hidden="true">
                Choose photo
              </span>
            </>
          )}
        </span>
      </button>
      <p
        id={statusId}
        className={choice.status === "error" ? "field-error" : "field-hint"}
        role={choice.status === "error" ? "alert" : undefined}
        aria-live={choice.status === "error" ? undefined : "polite"}
      >
        {status}
      </p>
      {editing && (choice.status === "ready" || choice.status === "error") && onReset && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            onReset();
            // This button goes away: keep focus on the photo it concerns.
            document.getElementById(id)?.focus();
          }}
        >
          Keep the current photo
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so choosing the same file again still fires a change.
          event.target.value = "";
          if (file) onPick(file);
        }}
      />
    </div>
  );
}
