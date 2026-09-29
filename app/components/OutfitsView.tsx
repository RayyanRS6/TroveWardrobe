"use client";

import { PackageOpen, Shirt, Sparkles } from "lucide-react";
import { plural } from "../lib/client/format";
import type { Outfit, WardrobeItem } from "../lib/wardrobe-options";
import { Photo } from "./Photo";
import { EmptyState, LoadingGrid } from "./Placeholders";
import type { ListState } from "./WardrobeView";

type OutfitsViewProps = {
  outfits: Outfit[];
  /** Existing pieces of an outfit, in outfit order. */
  piecesOf: (outfit: Outfit) => WardrobeItem[];
  hasItems: boolean;
  state: ListState;
  onOpenOutfit: (id: number) => void;
  onAdd: () => void;
};

export function OutfitsView({
  outfits,
  piecesOf,
  hasItems,
  state,
  onOpenOutfit,
  onAdd,
}: OutfitsViewProps) {
  return (
    <section className="view" aria-labelledby="view-title">
      <div className="view-heading">
        <div>
          <p className="kicker">Looks you love</p>
          <h2 id="view-title" tabIndex={-1}>
            Outfits
          </h2>
        </div>
        <p className="result-count" aria-live="polite" aria-atomic="true">
          {state === "ready" ? plural(outfits.length, "outfit") : ""}
        </p>
      </div>

      {state === "loading" ? (
        <LoadingGrid label="Loading your outfits" />
      ) : state === "unavailable" ? null : outfits.length ? (
        <ul className="outfit-grid" aria-label="Outfits">
          {outfits.map((outfit) => {
            const pieces = piecesOf(outfit);
            return (
              <li className="outfit-card" key={outfit.id}>
                <OutfitCollage pieces={pieces} />
                <div className="card-copy outfit-copy">
                  <p className="card-kicker">{outfit.occasion}</p>
                  <h3 className="card-title">
                    <button
                      type="button"
                      className="card-hit"
                      onClick={() => onOpenOutfit(outfit.id)}
                      title={outfit.name}
                    >
                      {outfit.name}
                    </button>
                  </h3>
                  <p className="card-meta">{plural(pieces.length, "piece")}</p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          kicker="Your lookbook"
          title={hasItems ? "Turn pieces into outfits." : "Your looks begin here."}
          text={
            hasItems
              ? "Combine what you own into ready-to-wear looks."
              : "Add a few clothes first, then combine them into outfits."
          }
          icon={<Sparkles size={42} strokeWidth={1.5} />}
          tone="lavender"
          action={
            <button type="button" className="button button-primary button-inline" onClick={onAdd}>
              {hasItems ? (
                <Sparkles size={18} aria-hidden="true" />
              ) : (
                <PackageOpen size={18} aria-hidden="true" />
              )}
              {hasItems ? "Create an outfit" : "Add clothing"}
            </button>
          }
        />
      )}
    </section>
  );
}

/** Up to four piece thumbnails; decorative (names are listed alongside). */
export function OutfitCollage({ pieces, large = false }: { pieces: WardrobeItem[]; large?: boolean }) {
  const shown = pieces.slice(0, 4);
  return (
    <div
      className={`collage collage-${Math.max(1, shown.length)}${large ? " collage-large" : ""}`}
      aria-hidden="true"
    >
      {shown.length ? (
        shown.map((piece) => <Photo key={piece.id} src={piece.thumbUrl} alt="" iconSize={24} />)
      ) : (
        <span className="collage-empty">
          <Shirt size={40} strokeWidth={1.5} />
        </span>
      )}
    </div>
  );
}
