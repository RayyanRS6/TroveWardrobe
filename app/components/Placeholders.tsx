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
  icon: ReactNode;
  tone?: "lime" | "lavender" | "blue";
  action?: ReactNode;
};

/** Friendly illustration + message for an empty list. */
export function EmptyState({ kicker, title, text, icon, tone = "lime", action }: EmptyStateProps) {
  return (
    <section className="empty-state">
      <div className={`empty-art empty-art-${tone}`} aria-hidden="true">
        <span className="art-card art-card-left" />
        <span className="art-card art-card-right" />
        <span className="art-icon">{icon}</span>
      </div>
      <p className="kicker">{kicker}</p>
      <h3 className="empty-title">{title}</h3>
      <p className="empty-text">{text}</p>
      {action}
    </section>
  );
}
