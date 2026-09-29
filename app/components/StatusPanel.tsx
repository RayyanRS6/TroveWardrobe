"use client";

import { CloudOff, LoaderCircle, RefreshCw, WifiOff } from "lucide-react";
import type { DataSource } from "../lib/client/wardrobe-state";
import type { SyncStatus } from "./AccountPanel";

type StatusPanelProps = {
  status: SyncStatus;
  source: DataSource;
  retrying: boolean;
  onRetry: () => void;
};

/**
 * Explains why the wardrobe is not synced: offline (showing this device's
 * copy, read-only) or a server problem (with Retry). Nothing when synced.
 */
export function StatusPanel({ status, source, retrying, onRetry }: StatusPanelProps) {
  if (status.state !== "offline" && status.state !== "error") return null;

  const offline = status.state === "offline";
  const hasCopy = source !== "none";
  const title = offline
    ? hasCopy
      ? "You're offline"
      : "You're offline, and there's no saved copy yet"
    : "Your wardrobe couldn't be synced";
  const text = offline
    ? hasCopy
      ? "You're seeing the copy saved on this device. Adding, editing and deleting are paused until you reconnect."
      : "Connect to the internet once to load your wardrobe onto this device."
    : `${status.message}${
        hasCopy
          ? source === "cache"
            ? " You're seeing the copy saved on this device, which may be out of date."
            : " What you see may be out of date."
          : ""
      }`;

  return (
    <div className={`status-panel ${offline ? "status-offline" : "status-error"}`} role="alert">
      <span className="status-icon" aria-hidden="true">
        {offline ? <WifiOff size={20} /> : <CloudOff size={20} />}
      </span>
      <div className="status-copy">
        <p className="status-title">{title}</p>
        <p>{text}</p>
      </div>
      <button
        type="button"
        className="button button-secondary status-retry"
        onClick={() => {
          if (!retrying) onRetry();
        }}
        aria-disabled={retrying || undefined}
      >
        {retrying ? (
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
        ) : (
          <RefreshCw size={18} aria-hidden="true" />
        )}
        {retrying ? "Trying…" : "Try again"}
      </button>
    </div>
  );
}
