"use client";

import { LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { useId } from "react";
import { Dialog } from "./Dialog";

type ConfirmDeleteProps = {
  /** Shown in the title: Delete “name”? */
  name: string;
  message: string;
  /** An extra warning, e.g. "Used in 2 outfits". */
  warning?: string | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Delete confirmation (alertdialog). "Keep it" has initial focus. */
export function ConfirmDelete({
  name,
  message,
  warning,
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmDeleteProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Dialog
      labelledBy={titleId}
      describedBy={descriptionId}
      role="alertdialog"
      variant="alert"
      busy={busy}
      onClose={onCancel}
    >
      <div className="confirm">
        <span className="danger-icon" aria-hidden="true">
          <Trash2 size={22} />
        </span>
        <h2 id={titleId} className="confirm-title">
          Delete “{name}”?
        </h2>
        <div id={descriptionId} className="confirm-copy">
          {warning && (
            <p className="confirm-warning">
              <TriangleAlert size={16} aria-hidden="true" />
              {warning}
            </p>
          )}
          <p>{message}</p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              if (!busy) onCancel();
            }}
            aria-disabled={busy || undefined}
            data-autofocus
          >
            Keep it
          </button>
          <button
            type="button"
            className="button button-danger"
            onClick={() => {
              if (!busy) onConfirm();
            }}
            aria-disabled={busy || undefined}
          >
            {busy && <LoaderCircle className="spin" size={18} aria-hidden="true" />}
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
