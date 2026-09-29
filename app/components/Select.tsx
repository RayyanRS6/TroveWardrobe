"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { CheckIcon, ChevronDownIcon } from "./Icons";

export type SelectOption = { value: string; label: string };

type SelectProps = {
  /** The button's id: validation focuses it. */
  id: string;
  /** The visible label's id (names the button and the list). */
  labelId: string;
  value: string;
  options: SelectOption[];
  /** Shown while the value matches no option. */
  placeholder?: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
};

// Letters typed within this long of each other search as one word.
const TYPEAHEAD_MS = 700;
const GAP = 6;
// Kept clear between the list and the edge of the screen.
const EDGE = 8;
const MAX_LIST_HEIGHT = 320;
// With less room than this below the button, the list opens above it (when
// there is more room there).
const MIN_ROOM = 180;

const isTypedCharacter = (event: KeyboardEvent) =>
  event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

/** Chromium's CloseWatcher (not in TypeScript's DOM types yet). */
type CloseWatcherLike = { onclose: (() => void) | null; destroy: () => void };
type CloseWatcherWindow = Window & { CloseWatcher?: new () => CloseWatcherLike };

/**
 * A themed replacement for <select>: a button that opens a listbox. The list
 * is shown in the top layer (Popover API), so no dialog or scroll container
 * clips it, and it opens above the button when there is no room below.
 * Keyboard: arrows, Home/End, Page Up/Down, Enter or Space to choose, typing
 * to jump, Escape to close the list only (never the dialog around it). A
 * press outside and Android's back gesture also close only the list.
 */
export function Select({
  id,
  labelId,
  value,
  options,
  placeholder = "Choose…",
  onChange,
  invalid = false,
  describedBy,
}: SelectProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const centreOnOpen = useRef(false);
  // A press on the button while the list is open: the button's click closes
  // the list, so the list's blur must not close it first.
  const pressingTrigger = useRef(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  const optionId = (index: number) => `${id}-option-${index}`;

  const hide = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  /** Puts the list under the button (or above it), inside the visible screen. */
  const place = useCallback(() => {
    const button = trigger.current;
    const panel = popup.current;
    const scroller = list.current;
    if (!button || !panel || !scroller) return;
    const rect = button.getBoundingClientRect();
    // The visual viewport leaves out a phone's on-screen keyboard.
    const view = window.visualViewport;
    const top = view ? view.offsetTop : 0;
    const left = view ? view.offsetLeft : 0;
    const bottom = view ? top + view.height : window.innerHeight;
    const right = view ? left + view.width : window.innerWidth;

    const width = Math.min(Math.max(rect.width, 200), right - left - EDGE * 2);
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.min(Math.max(rect.left, left + EDGE), right - EDGE - width)}px`;

    scroller.style.maxHeight = `${MAX_LIST_HEIGHT}px`;
    const natural = panel.offsetHeight;
    const frame = natural - scroller.offsetHeight;
    const below = bottom - rect.bottom - GAP - EDGE;
    const above = rect.top - top - GAP - EDGE;
    const flip = below < Math.min(natural, MIN_ROOM) && above > below;
    const room = Math.max(flip ? above : below, 96);
    const height = Math.min(natural, room);
    scroller.style.maxHeight = `${Math.min(MAX_LIST_HEIGHT, room - frame)}px`;
    panel.style.top = `${flip ? rect.top - GAP - height : rect.bottom + GAP}px`;
    panel.dataset.side = flip ? "top" : "bottom";
  }, []);

  function show(start: number) {
    if (!options.length) return;
    setActive(Math.max(0, Math.min(start, options.length - 1)));
    centreOnOpen.current = true;
    pressingTrigger.current = false;
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    // Focus goes back to the button first, so a caller may move it on.
    hide(true);
    if (option && option.value !== value) onChange(option.value);
  }

  /** The option a typed letter (or word) leads to, or -1. */
  function typedMatch(key: string, from: number) {
    const now = Date.now();
    const state = typed.current;
    state.text = now - state.at > TYPEAHEAD_MS ? key : state.text + key;
    state.at = now;
    const needle = state.text.toLowerCase();
    // Pressing one letter again moves on to the next option starting with it.
    const cycling = [...needle].every((char) => char === needle[0]);
    const start = cycling ? from + 1 : Math.max(from, 0);
    for (let step = 0; step < options.length; step += 1) {
      const index = (start + step) % options.length;
      if (options[index].label.toLowerCase().startsWith(cycling ? needle[0] : needle)) return index;
    }
    return -1;
  }

  const typingWord = () => Date.now() - typed.current.at <= TYPEAHEAD_MS && typed.current.text !== "";

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show(selectedIndex >= 0 ? selectedIndex : event.key === "ArrowUp" ? options.length - 1 : 0);
    } else if (isTypedCharacter(event) && event.key !== " ") {
      const match = typedMatch(event.key, selectedIndex);
      if (match >= 0) {
        event.preventDefault();
        show(match);
      }
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const last = options.length - 1;
    const move = (index: number) => {
      event.preventDefault();
      setActive(Math.max(0, Math.min(index, last)));
    };
    switch (event.key) {
      case "ArrowDown":
        return move(active + 1);
      case "ArrowUp":
        if (event.altKey) {
          event.preventDefault();
          choose(active);
          return;
        }
        return move(active - 1);
      case "Home":
        return move(0);
      case "End":
        return move(last);
      case "PageDown":
        return move(active + 5);
      case "PageUp":
        return move(active - 5);
      case "Enter":
        event.preventDefault();
        choose(active);
        return;
      case "Escape":
        // Escape that ends a text composition (IME) is not for the list.
        if (event.nativeEvent.isComposing) return;
        // Cancelled here, so it closes the list without closing the dialog.
        event.preventDefault();
        event.stopPropagation();
        hide(true);
        return;
      case "Tab":
        // Back on the button, so Tab carries on from there.
        hide(true);
        return;
    }
    if (event.key === " " && !typingWord()) {
      event.preventDefault();
      choose(active);
    } else if (isTypedCharacter(event)) {
      event.preventDefault();
      const match = typedMatch(event.key, active);
      if (match >= 0) setActive(match);
    }
  }

  // Opening: into the top layer, placed, then focus moves into the list.
  useLayoutEffect(() => {
    const panel = popup.current;
    if (!open || !panel) return;
    if (typeof panel.showPopover === "function") {
      try {
        panel.showPopover();
      } catch {
        // Already showing.
      }
    }
    place();
    list.current?.focus({ preventScroll: true });
  }, [open, place]);

  // Keeps the active option in view (centred when the list opens).
  useLayoutEffect(() => {
    const scroller = list.current;
    const option = scroller?.children[active];
    if (!open || !scroller || !(option instanceof HTMLElement)) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (centreOnOpen.current) {
      centreOnOpen.current = false;
      scroller.scrollTop = top - (scroller.clientHeight - option.offsetHeight) / 2;
    } else if (top < scroller.scrollTop) {
      scroller.scrollTop = top - 6;
    } else if (bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = bottom - scroller.clientHeight + 6;
    }
  }, [open, active]);

  // While open: follow the button, and close on a press outside or once the
  // button scrolls out of sight.
  useEffect(() => {
    if (!open) return;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && popup.current?.contains(target)) return;
      const button = trigger.current?.getBoundingClientRect();
      const box =
        target instanceof Element
          ? target.getBoundingClientRect()
          : { top: 0, bottom: window.innerHeight };
      if (!button || button.bottom < box.top || button.top > box.bottom) hide(false);
      else place();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      pressingTrigger.current = Boolean(trigger.current?.contains(target));
      if (pressingTrigger.current || popup.current?.contains(target)) return;
      // As with a native <select>, this press only closes the list: stopped
      // here (capture, on the document), it never starts an outside click
      // that would close the dialog around the list too.
      event.stopPropagation();
      hide(false);
    };
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, hide, place]);

  // A close watcher of the list's own, above the dialog's: Android's back
  // gesture closes the list, not the dialog around it. (Chromium only; a
  // manual popover gets none, and back is no close request elsewhere.)
  useEffect(() => {
    if (!open) return;
    const Watcher = (window as CloseWatcherWindow).CloseWatcher;
    if (!Watcher) return;
    let watcher: CloseWatcherLike;
    try {
      watcher = new Watcher();
    } catch {
      return;
    }
    watcher.onclose = () => hide(true);
    return () => watcher.destroy();
  }, [open, hide]);

  return (
    <div className="select">
      <button
        ref={trigger}
        id={id}
        type="button"
        className={`select-button${invalid ? " is-invalid" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-labelledby={`${labelId} ${id}-value`}
        // Buttons take no aria-invalid: the error is in the description.
        aria-describedby={describedBy}
        onClick={() => {
          pressingTrigger.current = false;
          if (open) hide(true);
          else show(selectedIndex >= 0 ? selectedIndex : 0);
        }}
        onKeyDown={onButtonKeyDown}
      >
        <span id={`${id}-value`} className={selected ? "select-value" : "select-value is-placeholder"}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDownIcon size={20} className="select-chevron" />
      </button>

      {open && (
        <div ref={popup} className="select-popup" popover="manual">
          <ul
            ref={list}
            id={`${id}-list`}
            className="select-list"
            role="listbox"
            tabIndex={-1}
            aria-labelledby={labelId}
            aria-activedescendant={optionId(active)}
            onKeyDown={onListKeyDown}
            onBlur={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && (popup.current?.contains(next) || next === trigger.current)) return;
              // Safari (and Firefox on macOS) never focus a pressed button, so
              // a press on it blurs the list with no next target. Its click
              // closes the list; closing here would make that click reopen it.
              if (pressingTrigger.current) return;
              hide(false);
            }}
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={index === selectedIndex}
                className={`select-option${index === active ? " is-active" : ""}`}
                onPointerMove={(event) => {
                  if (event.pointerType === "mouse" && index !== active) setActive(index);
                }}
                onClick={() => choose(index)}
              >
                <span className="select-option-label">{option.label}</span>
                {index === selectedIndex && <CheckIcon size={18} className="select-check" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
