"use client";

import { formatDate, plural } from "../lib/client/format";
import type { Outfit, WardrobeItem } from "../lib/wardrobe-options";
import { DialogHeader } from "./Dialog";
import { Photo } from "./Photo";

type ItemDetailProps = {
  item: WardrobeItem;
  /** Outfits that include this piece. */
  outfits: Outfit[];
  titleId: string;
  readOnlyMessage: string | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenOutfit: (id: number) => void;
};

/** One piece: the full photo, its details, the outfits it is in, Edit and Delete. */
export function ItemDetail({
  item,
  outfits,
  titleId,
  readOnlyMessage,
  onClose,
  onEdit,
  onDelete,
  onOpenOutfit,
}: ItemDetailProps) {
  const added = formatDate(item.createdAt);

  return (
    <>
      <DialogHeader titleId={titleId} kicker={item.category} title={item.name} onClose={onClose} />
      <div className="detail detail-item">
        <div className="detail-photo">
          <Photo key={item.imageUrl} src={item.imageUrl} alt={item.name} eager />
        </div>

        <div className="detail-info">
          <dl className="detail-facts">
            <div>
              <dt>Category</dt>
              <dd>{item.category}</dd>
            </div>
            <div>
              <dt>Colour</dt>
              <dd>{item.color || "Not set"}</dd>
            </div>
            {added && (
              <div>
                <dt>Added</dt>
                <dd>
                  <time dateTime={item.createdAt}>{added}</time>
                </dd>
              </div>
            )}
          </dl>

          <section className="detail-section" aria-labelledby={`${titleId}-outfits`}>
            <h3 id={`${titleId}-outfits`} className="detail-subtitle">
              {outfits.length ? `In ${plural(outfits.length, "outfit")}` : "Not in any outfit yet"}
            </h3>
            {outfits.length > 0 && (
              <ul className="link-list">
                {outfits.map((outfit) => (
                  <li key={outfit.id}>
                    <button
                      type="button"
                      className="link-row"
                      onClick={() => onOpenOutfit(outfit.id)}
                    >
                      <span className="link-row-text">{outfit.name}</span>
                      <span className="link-row-meta">{outfit.occasion}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {readOnlyMessage && <p className="form-note">{readOnlyMessage}</p>}
          <div className="form-actions">
            <button
              type="button"
              className="button button-danger-outline"
              onClick={onDelete}
              aria-disabled={Boolean(readOnlyMessage) || undefined}
            >
              Delete
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={onEdit}
              aria-disabled={Boolean(readOnlyMessage) || undefined}
            >
              Edit
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
