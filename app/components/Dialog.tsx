"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { CloseIcon } from "./Icons";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

// Page scroll stays locked while any dialog is open (they can stack).
let openDialogs = 0;

function lockScroll() {
  openDialogs += 1;
  document.documentElement.classList.add("scroll-locked");
}

function unlockScroll() {
  openDialogs = Math.max(0, openDialogs - 1);
  if (!openDialogs) document.documentElement.classList.remove("scroll-locked");
}

function focusables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0 && !element.closest("[inert]"),
  );
}

/**
 * Returns focus to what opened the dialog. When that is gone (the piece was
 * just deleted), the current view's heading takes focus instead.
 */
function restoreFocus(opener: HTMLElement | null) {
  // After React finishes unmounting (a stacked dialog may close with it).
  // Not requestAnimationFrame: it never fires while the tab is hidden.
  window.setTimeout(() => {
    const topDialog = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].pop();
    if (opener?.isConnected && (!topDialog || topDialog.contains(opener))) {
      opener.focus();
    } else if (!topDialog) {
      document.getElementById("view-title")?.focus();
    }
  });
}

type DialogProps = {
  labelledBy: string;
  describedBy?: string;
  onClose: () => void;
  /** While true (a save is running), Escape and outside clicks do nothing. */
  busy?: boolean;
  role?: "dialog" | "alertdialog";
  /** "sheet": bottom sheet on phones, centered panel on desktop. */
  variant?: "sheet" | "alert";
  /** Changing it (e.g. details → edit form) moves focus into the new content. */
  contentKey?: string;
  /**
   * Rendered inside the dialog but outside its panel, e.g. toasts: while a
   * modal dialog is open the rest of the page is inert (hidden and silent).
   */
  overlay?: ReactNode;
  children: ReactNode;
};

/**
 * A modal dialog on the native <dialog> element: the rest of the page is
 * inert, Tab cycles inside it, Escape and outside clicks close it, and focus
 * goes back to the opener. Initial focus lands on [data-autofocus] or the
 * first control.
 */
export function Dialog({
  labelledBy,
  describedBy,
  onClose,
  busy = false,
  role = "dialog",
  variant = "sheet",
  contentKey = "",
  overlay,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressStartedOutside = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    lockScroll();
    return () => {
      unlockScroll();
      if (dialog.open) dialog.close();
      restoreFocus(opener);
    };
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const target =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ?? focusables(dialog)[0] ?? dialog;
    target.focus();
    dialog.querySelector(".dialog-scroll")?.scrollTo({ top: 0 });
  }, [contentKey]);

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    // Escape that ends a text composition (IME) is not a request to close.
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onClose();
      return;
    }
    if (event.key !== "Tab" || !ref.current) return;

    const controls = focusables(ref.current);
    if (!controls.length) {
      event.preventDefault();
      return;
    }
    const first = controls[0];
    const last = controls[controls.length - 1];
    const current = document.activeElement;
    const inside = current instanceof Node && ref.current.contains(current);
    if (event.shiftKey && (current === first || !inside || current === ref.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (current === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  }

  // Native Escape handling (close watchers) is routed through onClose too.
  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    if (!busy) onClose();
  }

  // The browser closed it anyway: keep the page state in step. (A dialog that
  // is open again by now was only closed by a development-mode remount.)
  function handleNativeClose() {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    if (busy) dialog.showModal();
    else onClose();
  }

  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    const outside = event.target === event.currentTarget;
    if (outside && pressStartedOutside.current && !busy) onClose();
    pressStartedOutside.current = false;
  }

  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${variant}`}
      role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      onKeyDown={handleKeyDown}
      onCancel={handleCancel}
      onClose={handleNativeClose}
      onPointerDown={(event) => {
        pressStartedOutside.current = event.target === event.currentTarget;
      }}
      onClick={handleClick}
    >
      {/* The rounded panel clips; the scroller inside it keeps its scrollbar
          clear of the curved corners. */}
      <div className="dialog-panel">
        <div className="dialog-scroll">{children}</div>
      </div>
      {overlay}
    </dialog>
  );
}

type DialogHeaderProps = {
  titleId: string;
  kicker: string;
  title: string;
  onClose: () => void;
  closeDisabled?: boolean;
};

/** Sheet header: kicker, the dialog's title (initial focus) and a close button. */
export function DialogHeader({ titleId, kicker, title, onClose, closeDisabled }: DialogHeaderProps) {
  return (
    <header className="dialog-header">
      <span className="dialog-handle" aria-hidden="true" />
      <div className="dialog-heading">
        <p className="kicker">{kicker}</p>
        <h2 id={titleId} className="dialog-title" tabIndex={-1} data-autofocus>
          {title}
        </h2>
      </div>
      <button
        type="button"
        className="icon-button"
        onClick={() => {
          if (!closeDisabled) onClose();
        }}
        aria-label="Close"
        aria-disabled={closeDisabled || undefined}
      >
        <CloseIcon size={22} />
      </button>
    </header>
  );
}
