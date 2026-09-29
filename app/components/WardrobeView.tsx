"use client";

import { Plus, Search, Shirt, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { plural } from "../lib/client/format";
import { categoryKey } from "../lib/client/wardrobe-state";
import type { CategoryCount, WardrobeItem } from "../lib/wardrobe-options";
import { Photo } from "./Photo";
import { EmptyState, LoadingGrid } from "./Placeholders";

export type ListState = "loading" | "ready" | "unavailable";

type WardrobeViewProps = {
  items: WardrobeItem[];
  /** Items after the search and category filter. */
  visibleItems: WardrobeItem[];
  categories: CategoryCount[];
  /** null = every category ("All"). */
  activeCategory: string | null;
  onCategoryChange: (category: string | null) => void;
  search: string;
  onSearchChange: (value: string) => void;
  state: ListState;
  onOpenItem: (id: number) => void;
  onAdd: () => void;
};

export function WardrobeView({
  items,
  visibleItems,
  categories,
  activeCategory,
  onCategoryChange,
  search,
  onSearchChange,
  state,
  onOpenItem,
  onAdd,
}: WardrobeViewProps) {
  const id = useId();
  const chipRow = useRef<HTMLDivElement>(null);
  const filtered = Boolean(search.trim() || activeCategory);
  const activeKey = activeCategory ? categoryKey(activeCategory) : null;

  // On a swipeable row, bring the chosen chip into view (sideways only).
  useEffect(() => {
    const row = chipRow.current;
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !chip || row.scrollWidth <= row.clientWidth) return;
    const left = chip.offsetLeft; // the row is the chips' offset parent
    if (left < row.scrollLeft || left + chip.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: Math.max(0, left - 16) });
    }
  }, [activeKey]);
  const countText =
    state !== "ready"
      ? ""
      : filtered
        ? `${visibleItems.length} of ${plural(items.length, "piece")}`
        : plural(items.length, "piece");

  return (
    <section className="view" aria-labelledby="view-title">
      <div className="view-heading">
        <div>
          <p className="kicker">Your collection</p>
          <h2 id="view-title" tabIndex={-1}>
            Wardrobe
          </h2>
        </div>
        <p className="result-count" aria-live="polite" aria-atomic="true">
          {countText}
        </p>
      </div>

      {items.length > 0 && (
        <div className="toolbar">
          <div className="search-box" role="search">
            <Search size={19} aria-hidden="true" />
            <label htmlFor={`${id}-search`} className="visually-hidden">
              Search your wardrobe
            </label>
            <input
              id={`${id}-search`}
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search names, colours, seasons…"
              autoComplete="off"
              enterKeyHint="search"
            />
            {search && (
              <button
                type="button"
                className="icon-button icon-button-small"
                onClick={() => {
                  onSearchChange("");
                  document.getElementById(`${id}-search`)?.focus();
                }}
                aria-label="Clear search"
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="chip-row" role="group" aria-label="Filter by category" ref={chipRow}>
            <button
              type="button"
              className="chip"
              aria-pressed={activeKey === null}
              onClick={() => onCategoryChange(null)}
            >
              All <span className="chip-count">{items.length}</span>
            </button>
            {categories.map((category) => (
              <button
                type="button"
                key={category.name}
                className="chip"
                aria-pressed={activeKey === categoryKey(category.name)}
                onClick={() => onCategoryChange(category.name)}
              >
                {category.name} <span className="chip-count">{category.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {state === "loading" ? (
        <LoadingGrid label="Loading your wardrobe" />
      ) : state === "unavailable" ? null : visibleItems.length ? (
        <ul className="card-grid" aria-label="Pieces">
          {visibleItems.map((item) => (
            <ItemCard key={item.id} item={item} onOpen={() => onOpenItem(item.id)} />
          ))}
        </ul>
      ) : filtered ? (
        <EmptyState
          kicker="Nothing here"
          title="No pieces match that."
          text="Try another search or category, or see your whole collection."
          icon={<Search size={40} strokeWidth={1.5} />}
          tone="blue"
          action={
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                onSearchChange("");
                onCategoryChange(null);
              }}
            >
              <X size={18} aria-hidden="true" />
              Clear filters
            </button>
          }
        />
      ) : (
        <EmptyState
          kicker="A fresh start"
          title="Meet your digital wardrobe."
          text="Photograph your first piece and never forget what you own again."
          icon={<Shirt size={44} strokeWidth={1.5} />}
          action={
            <button type="button" className="button button-primary button-inline" onClick={onAdd}>
              <Plus size={18} aria-hidden="true" />
              Add your first piece
            </button>
          }
        />
      )}
    </section>
  );
}

function ItemCard({ item, onOpen }: { item: WardrobeItem; onOpen: () => void }) {
  const meta = [item.color, item.season].filter(Boolean).join(" · ");
  return (
    <li className="item-card">
      <div className="card-photo">
        <Photo src={item.thumbUrl} alt="" />
      </div>
      <div className="card-copy">
        <p className="card-kicker">{item.category}</p>
        <h3 className="card-title">
          <button type="button" className="card-hit" onClick={onOpen} title={item.name}>
            {item.name}
          </button>
        </h3>
        {meta && <p className="card-meta">{meta}</p>}
      </div>
    </li>
  );
}
