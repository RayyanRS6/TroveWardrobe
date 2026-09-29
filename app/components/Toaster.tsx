"use client";

import { Check, Info, RefreshCw, TriangleAlert } from "lucide-react";

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
 * readers hear every change), plus the "new version" prompt.
 */
export function Toaster({ toast, onUpdate }: ToasterProps) {
  const Icon = toast?.tone === "error" ? TriangleAlert : toast?.tone === "info" ? Info : Check;
  return (
    <div className="toast-stack">
      <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
        {toast && (
          <p className={`toast toast-${toast.tone}`} key={toast.id}>
            <Icon size={17} aria-hidden="true" />
            <span>{toast.message}</span>
          </p>
        )}
      </div>
      {onUpdate && (
        <div className="update-banner" role="status">
          <span>A new version of Trove is ready.</span>
          <button type="button" className="button button-accent button-small" onClick={onUpdate}>
            <RefreshCw size={16} aria-hidden="true" />
            Update
          </button>
        </div>
      )}
    </div>
  );
}
