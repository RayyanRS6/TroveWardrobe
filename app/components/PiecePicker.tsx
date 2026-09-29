"use client";

import { useId, useMemo, useRef, useState } from "react";
import { plural } from "../lib/client/format";
import { OUTFIT_ITEMS_MAX, type WardrobeItem } from "../lib/wardrobe-options";
import { CheckIcon, CloseIcon } from "./Icons";
import { Photo } from "./Photo";

type PiecePickerProps = {
  items: WardrobeItem[];
  /** Chosen piece ids, in the order they were picked. */
  selected: number[];
  /** Adds or removes one piece (applied to the latest selection). */
  onToggle: (id: number) => void;
  onClear: () => void;
  error?: string;
  errorId: string;
};

/** The next selection after toggling `id`, never over OUTFIT_ITEMS_MAX. */
export function toggledSelection(current: number[], id: number) {
  if (current.includes(id)) return current.filter((selectedId) => selectedId !== id);
  return current.length >= OUTFIT_ITEMS_MAX ? current : [...current, id];
}

function matches(item: WardrobeItem, needle: string) {
  return [item.name, item.category, item.color].join(" ").toLowerCase().includes(needle);
}

/** Chooses up to OUTFIT_ITEMS_MAX pieces, with search and a strip of the chosen ones. */
export function PiecePicker({ items, selected, onToggle, onClear, error, errorId }: PiecePickerProps) {
  const id = useId();
  const picker = useRef<HTMLFieldSetElement>(null);
  const [query, setQuery] = useState("");
  const [limitHit, setLimitHit] = useState(false);
  const atLimit = selected.length >= OUTFIT_ITEMS_MAX;

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const chosen = selected
    .map((itemId) => byId.get(itemId))
    .filter((item): item is WardrobeItem => Boolean(item));
  const needle = query.trim().toLowerCase();
  const visible = needle ? items.filter((item) => matches(item, needle)) : items;

  function toggle(itemId: number) {
    const adding = !selected.includes(itemId);
    setLimitHit(adding && atLimit);
    onToggle(itemId);
  }

  // The picker itself takes focus when the control used goes away with the
  // selection (not the search box: that would open a phone's keyboard).
  function focusPicker() {
    picker.current?.focus({ preventScroll: true });
  }

  function removeChosen(index: number) {
    // Focus moves to the next chip (or the previous one) before this one goes.
    const neighbour = chosen[index + 1] ?? chosen[index - 1];
    if (neighbour) document.getElementById(`${id}-remove-${neighbour.id}`)?.focus();
    else focusPicker();
    toggle(chosen[index].id);
  }

  const countText = selected.length
    ? `${plural(selected.length, "piece")} selected`
    : "No pieces selected yet";

  return (
    <fieldset
      ref={picker}
      className="picker"
      aria-describedby={error ? errorId : `${id}-count`}
      tabIndex={-1}
    >
      <legend className="field-label">
        Pieces
        <span className="required-mark" aria-hidden="true">
          *
        </span>
      </legend>

      <div className="picker-heading">
        <p id={`${id}-count`} aria-live="polite">
          {countText}
          <span className="picker-max"> · up to {OUTFIT_ITEMS_MAX}</span>
        </p>
        {selected.length > 0 && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setLimitHit(false);
              focusPicker();
              onClear();
            }}
          >
            Clear all
          </button>
        )}
      </div>

      {chosen.length > 0 && (
        <ul className="chosen-strip" aria-label="Chosen pieces">
          {chosen.map((item, index) => (
            <li key={item.id}>
              <Photo src={item.thumbUrl} alt="" className="chosen-photo" quiet />
              <button
                id={`${id}-remove-${item.id}`}
                type="button"
                className="chosen-remove"
                onClick={() => removeChosen(index)}
                aria-label={`Remove ${item.name}`}
                title={`Remove ${item.name}`}
              >
                <CloseIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        // Focused when a save is refused, so it is read out.
        <p id={errorId} className="field-error" tabIndex={-1}>
          {error}
        </p>
      )}

      <div className="search-box search-box-compact">
        <label htmlFor={`${id}-search`} className="visually-hidden">
          Search your pieces
        </label>
        <input
          id={`${id}-search`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search your pieces"
          autoComplete="off"
          enterKeyHint="search"
          onKeyDown={(event) => {
            // Enter in the search box must not submit the outfit.
            if (event.key === "Enter") event.preventDefault();
            // Escape clears the search first; only then does it close the dialog.
            if (event.key === "Escape" && query && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="icon-button icon-button-small"
            onClick={() => {
              setQuery("");
              document.getElementById(`${id}-search`)?.focus();
            }}
            aria-label="Clear piece search"
          >
            <CloseIcon size={18} />
          </button>
        )}
      </div>

      <p className="picker-status" role="status">
        {limitHit
          ? `An outfit can have up to ${OUTFIT_ITEMS_MAX} pieces. Remove one to add another.`
          : needle
            ? `${plural(visible.length, "piece")} found`
            : ""}
      </p>

      {visible.length ? (
        // A card of its own that scrolls inside its rounded frame, so a long
        // wardrobe never pushes the rest of the form far away.
        <div className="picker-well">
          <ul className="picker-grid picker-scroll" aria-label="Your pieces">
            {visible.map((item) => {
              const isSelected = selected.includes(item.id);
              const blocked = atLimit && !isSelected;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`picker-option${isSelected ? " is-selected" : ""}`}
                    onClick={() => toggle(item.id)}
                    aria-pressed={isSelected}
                    aria-disabled={blocked || undefined}
                    title={item.name}
                  >
                    <Photo src={item.thumbUrl} alt="" className="picker-photo" quiet />
                    <span className="picker-name">{item.name}</span>
                    <span className="visually-hidden">, {item.category}</span>
                    <span className="picker-check" aria-hidden="true">
                      {isSelected && <CheckIcon size={16} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="picker-empty">
          {needle ? "No pieces match that search." : "Add some pieces to your wardrobe first."}
        </p>
      )}
    </fieldset>
  );
}
