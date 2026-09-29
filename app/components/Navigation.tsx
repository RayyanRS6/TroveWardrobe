"use client";

import Link from "next/link";
import type { ComponentType, MouseEvent, ReactNode } from "react";
import { SyncBadge, type SyncStatus } from "./AccountPanel";
import { AccountIcon, HangerIcon, OutfitsIcon, PlusIcon, TagIcon } from "./Icons";

export type View = "wardrobe" | "outfits" | "categories";

// The sidebar pairs each icon with its label; the phone's bottom bar shows
// icons only, keeping the label as hidden text for its accessible name.
const NAV_ITEMS: { view: View; label: string; icon: ComponentType<{ size?: number }> }[] = [
  { view: "wardrobe", label: "Wardrobe", icon: HangerIcon },
  { view: "outfits", label: "Outfits", icon: OutfitsIcon },
  { view: "categories", label: "Categories", icon: TagIcon },
];

type AddAction = {
  label: string;
  onAdd: () => void;
  /** Offline: the button explains why instead of opening a form. */
  paused: boolean;
};

/** Links home; a plain click just returns to the full wardrobe in place. */
function Brand({ onHome }: { onHome: () => void }) {
  return (
    <Link
      className="brand"
      href="/"
      // The app is already this page: no prefetch request (free-tier budget).
      prefetch={false}
      aria-label="Trove, back to your wardrobe"
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
          return;
        }
        event.preventDefault();
        onHome();
      }}
    >
      trove<span aria-hidden="true">.</span>
    </Link>
  );
}

type SidebarProps = {
  view: View;
  counts: Record<View, number | null>;
  onNavigate: (view: View) => void;
  onHome: () => void;
  add: AddAction;
  account: ReactNode;
};

/** Desktop (≥ 900 px): brand, the one Add action, navigation and the account area. */
export function Sidebar({ view, counts, onNavigate, onHome, add, account }: SidebarProps) {
  return (
    <aside className="sidebar on-plum" aria-label="Trove">
      <Brand onHome={onHome} />
      <button
        type="button"
        className="button button-accent sidebar-add"
        onClick={add.onAdd}
        aria-disabled={add.paused || undefined}
      >
        {add.label}
      </button>
      <nav className="sidebar-nav" aria-label="Main">
        <ul>
          {NAV_ITEMS.map(({ view: target, label, icon: Icon }) => (
            <li key={target}>
              <button
                type="button"
                className="sidebar-link"
                aria-current={view === target ? "page" : undefined}
                onClick={() => onNavigate(target)}
              >
                <Icon size={20} />
                <span>{label}</span>
                {counts[target] !== null && <span className="sidebar-count">{counts[target]}</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="sidebar-footer">{account}</div>
    </aside>
  );
}

/** Phones and tablets (< 900 px): brand and sync state. */
export function TopBar({ onHome, status }: { onHome: () => void; status: SyncStatus }) {
  return (
    <header className="topbar">
      <Brand onHome={onHome} />
      <SyncBadge status={status} />
    </header>
  );
}

type BottomNavProps = {
  view: View;
  onNavigate: (view: View) => void;
  add: AddAction;
  onAccount: () => void;
};

/** Phones and tablets: two views, the Add button, the third view, account. */
export function BottomNav({ view, onNavigate, add, onAccount }: BottomNavProps) {
  const link = ({ view: target, label, icon: Icon }: (typeof NAV_ITEMS)[number]) => (
    <button
      key={target}
      type="button"
      className="bottom-link"
      title={label}
      aria-current={view === target ? "page" : undefined}
      onClick={() => onNavigate(target)}
    >
      <Icon size={24} />
      <span className="visually-hidden">{label}</span>
    </button>
  );

  return (
    <nav className="bottom-nav on-plum" aria-label="Main">
      {link(NAV_ITEMS[0])}
      {link(NAV_ITEMS[1])}
      <button
        type="button"
        className="bottom-add"
        onClick={add.onAdd}
        aria-label={add.label}
        aria-disabled={add.paused || undefined}
      >
        <PlusIcon size={26} />
      </button>
      {link(NAV_ITEMS[2])}
      <button type="button" className="bottom-link" title="Account" onClick={onAccount}>
        <AccountIcon size={24} />
        <span className="visually-hidden">Account</span>
      </button>
    </nav>
  );
}
