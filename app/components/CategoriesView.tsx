"use client";

import { ChevronRight, Shirt, Tags } from "lucide-react";
import { plural } from "../lib/client/format";
import type { CategoryCount, WardrobeItem } from "../lib/wardrobe-options";
import { Photo } from "./Photo";
import { EmptyState } from "./Placeholders";
import type { ListState } from "./WardrobeView";

type CategoriesViewProps = {
  categories: CategoryCount[];
  /** The newest piece in a category, shown as its swatch. */
  coverOf: (category: string) => WardrobeItem | undefined;
  state: ListState;
  onOpenCategory: (category: string) => void;
  onAdd: () => void;
};

export function CategoriesView({
  categories,
  coverOf,
  state,
  onOpenCategory,
  onAdd,
}: CategoriesViewProps) {
  return (
    <section className="view" aria-labelledby="view-title">
      <div className="view-heading">
        <div>
          <p className="kicker">Browse by type</p>
          <h2 id="view-title" tabIndex={-1}>
            Categories
          </h2>
        </div>
        <p className="result-count" aria-live="polite" aria-atomic="true">
          {state === "ready" ? plural(categories.length, "category", "categories") : ""}
        </p>
      </div>

      {state === "loading" ? (
        <div className="category-list loading-list" role="status" aria-label="Loading categories">
          {[0, 1, 2, 3].map((key) => (
            <span className="loading-row" key={key} aria-hidden="true" />
          ))}
        </div>
      ) : state === "unavailable" ? null : categories.length ? (
        <ul className="category-list" aria-label="Categories">
          {categories.map((category, index) => {
            const cover = coverOf(category.name);
            return (
              <li key={category.name}>
                <button
                  type="button"
                  className="category-row"
                  onClick={() => onOpenCategory(category.name)}
                >
                  <span className={`swatch swatch-${(index % 5) + 1}`} aria-hidden="true">
                    {cover ? (
                      <Photo src={cover.thumbUrl} alt="" iconSize={20} />
                    ) : (
                      <Shirt size={20} />
                    )}
                  </span>
                  <span className="category-name">{category.name}</span>
                  <span className="category-count">{plural(category.count, "piece")}</span>
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          kicker="Nothing to sort yet"
          title="Categories appear as you add pieces."
          text="Give each piece a category, like Shirts or Shoes, and browse them here."
          icon={<Tags size={40} strokeWidth={1.5} />}
          tone="blue"
          action={
            <button type="button" className="button button-primary button-inline" onClick={onAdd}>
              <Shirt size={18} aria-hidden="true" />
              Add a piece
            </button>
          }
        />
      )}
    </section>
  );
}
