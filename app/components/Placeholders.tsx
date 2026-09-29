import type { ReactNode } from "react";

/** Skeleton cards while the wardrobe loads for the first time. */
export function LoadingGrid({ label }: { label: string }) {
  return (
    <div className="card-grid loading-grid" role="status" aria-label={label}>
      {[0, 1, 2, 3, 4, 5].map((key) => (
        <div className="loading-card" key={key} aria-hidden="true">
          <span />
          <i />
          <b />
        </div>
      ))}
    </div>
  );
}

type EmptyStateProps = {
  kicker: string;
  title: string;
  text: string;
  action?: ReactNode;
};

/** A calm, words-only message for an empty list. */
export function EmptyState({ kicker, title, text, action }: EmptyStateProps) {
  return (
    <section className="empty-state">
      <span className="empty-rule" aria-hidden="true" />
      <p className="kicker">{kicker}</p>
      <h3 className="empty-title">{title}</h3>
      <p className="empty-text">{text}</p>
      {action}
    </section>
  );
}
