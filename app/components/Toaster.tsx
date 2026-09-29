"use client";

export type Toast = {
  id: number;
  message: string;
  tone: "success" | "info" | "error";
};

type ToasterProps = {
  toast: Toast | null;
  /** Set when a new version of the app is installed and waiting. */
  onUpdate: (() => void) | null;
};

/**
 * Short confirmations in a polite live region (always mounted, so screen
 * readers hear every change), plus the "new version" prompt. Words only: a
 * small dot marks the tone.
 */
export function Toaster({ toast, onUpdate }: ToasterProps) {
  return (
    <div className="toast-stack">
      <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
        {toast && (
          <p className={`toast on-plum toast-${toast.tone}`} key={toast.id}>
            <span className="toast-dot" aria-hidden="true" />
            <span>{toast.message}</span>
          </p>
        )}
      </div>
      {onUpdate && (
        <div className="update-banner on-plum" role="status">
          <span>A new version of Trove is ready.</span>
          <button type="button" className="button button-accent button-small" onClick={onUpdate}>
            Update
          </button>
        </div>
      )}
    </div>
  );
}
