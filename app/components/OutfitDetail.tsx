"use client";

import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import { formatDate, plural } from "../lib/client/format";
import type { Outfit, WardrobeItem } from "../lib/wardrobe-options";
import { DialogHeader } from "./Dialog";
import { OutfitCollage } from "./OutfitsView";
import { Photo } from "./Photo";

type OutfitDetailProps = {
  outfit: Outfit;
  /** The outfit's pieces that still exist, in outfit order. */
  pieces: WardrobeItem[];
  titleId: string;
  readOnlyMessage: string | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenItem: (id: number) => void;
};

/** One outfit: its pieces (open any of them), Edit and Delete. */
export function OutfitDetail({
  outfit,
  pieces,
  titleId,
  readOnlyMessage,
  onClose,
  onEdit,
  onDelete,
  onOpenItem,
}: OutfitDetailProps) {
  const created = formatDate(outfit.createdAt);

  return (
    <>
      <DialogHeader titleId={titleId} kicker={outfit.occasion} title={outfit.name} onClose={onClose} />
      <div className="detail">
        <OutfitCollage pieces={pieces} large />

        <p className="detail-summary">
          {plural(pieces.length, "piece")} · {outfit.occasion}
          {created && (
            <>
              {" · Created "}
              <time dateTime={outfit.createdAt}>{created}</time>
            </>
          )}
        </p>

        <section className="detail-section" aria-labelledby={`${titleId}-pieces`}>
          <h3 id={`${titleId}-pieces`} className="detail-subtitle">
            Pieces
          </h3>
          {pieces.length ? (
            <ul className="link-list">
              {pieces.map((piece) => (
                <li key={piece.id}>
                  <button type="button" className="link-row" onClick={() => onOpenItem(piece.id)}>
                    <Photo src={piece.thumbUrl} alt="" className="link-row-photo" iconSize={20} />
                    <span className="link-row-text">{piece.name}</span>
                    <span className="link-row-meta">{piece.category}</span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="detail-empty">
              The pieces in this outfit were deleted. Edit it to choose new ones.
            </p>
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
            <Trash2 size={18} aria-hidden="true" />
            Delete
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={onEdit}
            aria-disabled={Boolean(readOnlyMessage) || undefined}
          >
            <Pencil size={18} aria-hidden="true" />
            Edit
          </button>
        </div>
      </div>
    </>
  );
}
