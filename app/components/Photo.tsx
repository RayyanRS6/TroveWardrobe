"use client";

import { Shirt } from "lucide-react";
import { useState } from "react";

type PhotoProps = {
  src: string;
  /** Empty when the photo is decorative (the name is shown next to it). */
  alt: string;
  className?: string;
  /** Eager for the photo a dialog opens with; lazy for grids. */
  eager?: boolean;
  iconSize?: number;
};

/**
 * A wardrobe photo from /api/images (the session cookie authorizes it). If it
 * cannot load (offline and not cached yet), a placeholder shows instead.
 */
export function Photo({ src, alt, className = "", eager = false, iconSize = 32 }: PhotoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (failedSrc === src) {
    return (
      <span className={`photo-fallback ${className}`} role={alt ? "img" : undefined} aria-label={alt || undefined}>
        <Shirt size={iconSize} strokeWidth={1.5} aria-hidden="true" />
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
      onError={() => setFailedSrc(src)}
    />
  );
}
