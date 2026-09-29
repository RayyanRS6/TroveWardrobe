"use client";

import { useState, useSyncExternalStore } from "react";

type PhotoProps = {
  src: string;
  /** Empty when the photo is decorative (the name is shown next to it). */
  alt: string;
  className?: string;
  /** Eager for the photo a dialog opens with; lazy for grids. */
  eager?: boolean;
  /** Small thumbnails: a missing photo is a plain tile, with no words. */
  quiet?: boolean;
};

// Bumped after every sync, so photos that failed to load (offline, or a
// passing server error) get another try once Trove can reach the API again.
let retryRound = 0;
const retryListeners = new Set<() => void>();

export function retryFailedPhotos() {
  retryRound += 1;
  for (const listener of retryListeners) listener();
}

function subscribeToRetries(onChange: () => void) {
  retryListeners.add(onChange);
  return () => {
    retryListeners.delete(onChange);
  };
}

/**
 * A wardrobe photo from /api/images (the session cookie authorizes it). If it
 * cannot load (offline and not cached yet), a quiet placeholder shows instead.
 */
export function Photo({ src, alt, className = "", eager = false, quiet = false }: PhotoProps) {
  const round = useSyncExternalStore(subscribeToRetries, () => retryRound, () => 0);
  const [failed, setFailed] = useState<{ src: string; round: number } | null>(null);

  if (failed && failed.src === src && failed.round === round) {
    return (
      <span className={`photo-fallback ${className}`} role={alt ? "img" : undefined} aria-label={alt || undefined}>
        {!quiet && <span aria-hidden="true">Photo unavailable</span>}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={className}
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      onError={() => setFailed({ src, round })}
    />
  );
}
