"use client";

import { CloudCheck, CloudOff, LoaderCircle, LogOut, WifiOff } from "lucide-react";
import { formatBytes } from "../lib/client/format";
import type { StorageUsage } from "../lib/wardrobe-options";

export type SyncStatus =
  | { state: "loading" }
  | { state: "synced" }
  | { state: "offline" }
  | { state: "error"; message: string };

const SYNC_LABELS: Record<SyncStatus["state"], string> = {
  loading: "Syncing…",
  synced: "Synced",
  offline: "Offline",
  error: "Not synced",
};

/** Sync state pill. Says "Synced" only after the API answered this session. */
export function SyncBadge({ status }: { status: SyncStatus }) {
  const Icon =
    status.state === "loading"
      ? LoaderCircle
      : status.state === "synced"
        ? CloudCheck
        : status.state === "offline"
          ? WifiOff
          : CloudOff;
  return (
    <p className={`sync-badge sync-${status.state}`} role="status">
      <Icon size={15} className={status.state === "loading" ? "spin" : undefined} aria-hidden="true" />
      <span>{SYNC_LABELS[status.state]}</span>
    </p>
  );
}

function StorageMeter({ usage }: { usage: StorageUsage | null }) {
  if (!usage || usage.limitBytes <= 0) return null;
  const share = Math.min(1, usage.bytesUsed / usage.limitBytes);
  // Always show a sliver once anything is stored.
  const width = usage.bytesUsed > 0 ? Math.max(share * 100, 2) : 0;
  return (
    <div className="storage">
      <p className="storage-label">
        <span>Photo storage</span>
        <span>
          {formatBytes(usage.bytesUsed)} of {formatBytes(usage.limitBytes)}
        </span>
      </p>
      <span className={`storage-bar${share > 0.9 ? " is-full" : ""}`} aria-hidden="true">
        <span style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}

type AccountPanelProps = {
  status: SyncStatus;
  usage: StorageUsage | null;
  loggingOut: boolean;
  onLogOut: () => void;
};

/** Sync state, the storage meter and Log out (sidebar and mobile account sheet). */
export function AccountPanel({ status, usage, loggingOut, onLogOut }: AccountPanelProps) {
  return (
    <div className="account">
      <SyncBadge status={status} />
      <StorageMeter usage={usage} />
      <button
        type="button"
        className="button button-secondary logout-button"
        onClick={() => {
          if (!loggingOut) onLogOut();
        }}
        aria-disabled={loggingOut || undefined}
      >
        {loggingOut ? (
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
        ) : (
          <LogOut size={18} aria-hidden="true" />
        )}
        {loggingOut ? "Logging out…" : "Log out"}
      </button>
    </div>
  );
}
