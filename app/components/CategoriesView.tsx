"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { cleanText, plural } from "../lib/client/format";
import { categoryKey } from "../lib/client/wardrobe-state";
import {
  CATEGORY_MAX,
  RESERVED_CATEGORY,
  type CategoryCount,
  type WardrobeItem,
} from "../lib/wardrobe-options";
import { Photo } from "./Photo";
import { EmptyState } from "./Placeholders";
import type { ListState } from "./WardrobeView";

type CategoriesViewProps = {
  /** Every category, including those with no pieces. */
  categories: CategoryCount[];
  /** The newest piece in a category, shown as its swatch. */
  coverOf: (category: string) => WardrobeItem | undefined;
  state: ListState;
  /** Shows the wardrobe filtered to one category. */
  onOpenCategory: (category: string) => void;
  /** Resolves to a message for the user, or null once the category is added. */
  onAddCategory: (name: string) => Promise<string | null>;
  /** Asks to delete a category (its pieces move to Uncategorized). */
  onDeleteCategory: (name: string) => void;
};

/** The category list: add one, open one (its pieces), or delete one. */
export function CategoriesView({
  categories,
  coverOf,
  state,
  onOpenCategory,
  onAddCategory,
  onDeleteCategory,
}: CategoriesViewProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding) return;
    const name = cleanText(draft);
    const existing = categories.find((category) => categoryKey(category.name) === categoryKey(name));
    const problem = !name
      ? "Please type a name for the category."
      : categoryKey(name) === categoryKey(RESERVED_CATEGORY)
        ? `“${RESERVED_CATEGORY}” is reserved. Please choose another name.`
        : existing
          ? `You already have “${existing.name}”.`
          : null;
    if (problem) {
      setError(problem);
      input.current?.focus();
      return;
    }

    setAdding(true);
    const failure = await onAddCategory(name);
    setAdding(false);
    if (failure) {
      setError(failure);
      input.current?.focus();
    } else {
      // Ready for the next one.
      setDraft("");
      setError(null);
    }
  }

  const errorId = `${id}-error`;

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

      {state === "ready" && (
        <form className="category-add" onSubmit={submit} noValidate>
          <label htmlFor={`${id}-name`} className="field-label">
            New category
          </label>
          <div className="category-add-row">
            <input
              ref={input}
              id={`${id}-name`}
              className="input"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. Scarves"
              maxLength={CATEGORY_MAX}
              autoComplete="off"
              enterKeyHint="done"
              aria-invalid={Boolean(error) || undefined}
              aria-describedby={error ? errorId : undefined}
            />
            <button
              type="submit"
              className="button button-primary"
              aria-disabled={adding || undefined}
            >
              {adding ? "Adding…" : "Add category"}
            </button>
          </div>
          {error && (
            <p id={errorId} className="field-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}

      {state === "loading" ? (
        <div className="category-list loading-list" role="status" aria-label="Loading categories">
          {[0, 1, 2, 3].map((key) => (
            <span className="loading-row" key={key} aria-hidden="true" />
          ))}
        </div>
      ) : state === "unavailable" ? null : categories.length ? (
        <ul className="category-list" aria-label="Categories">
          {categories.map((category) => {
            const cover = coverOf(category.name);
            const summary = (
              <>
                <span className="swatch" aria-hidden="true">
                  {cover ? (
                    <Photo src={cover.thumbUrl} alt="" quiet />
                  ) : (
                    <span className="swatch-letter">{[...category.name][0]?.toUpperCase()}</span>
                  )}
                </span>
                {/* The count sits under the name, so the name keeps the row's width. */}
                <span className="category-text">
                  <span className="category-name">{category.name}</span>
                  <span className="category-count">
                    {category.count ? plural(category.count, "piece") : "No pieces yet"}
                  </span>
                </span>
              </>
            );
            return (
              <li key={category.name} className="category-item">
                {/* An empty category has nothing to show yet. */}
                {category.count ? (
                  <button
                    type="button"
                    className="category-open"
                    onClick={() => onOpenCategory(category.name)}
                  >
                    {summary}
                  </button>
                ) : (
                  <div className="category-open">{summary}</div>
                )}
                <button
                  type="button"
                  className="category-delete"
                  onClick={() => onDeleteCategory(category.name)}
                  aria-label={`Delete ${category.name}`}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          kicker="Nothing to sort yet"
          title="No categories yet."
          text="Add one above, like Shirts or Shoes, then give each piece a category."
        />
      )}
    </section>
  );
}
