import type { ReactNode } from "react";

// Trove's own small icon set: a 24px grid, 1.5px strokes with round caps and
// joins, drawn in currentColor. Icons are used sparingly: the navigation
// (sidebar and phone bar), plus a few functional glyphs (close, chevron,
// check). Every icon is decorative; the control it sits in carries the
// accessible name.

type IconProps = {
  size?: number;
  className?: string;
};

function Icon({ size = 24, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Wardrobe: a clothes hanger. */
export function HangerIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.75 6.75a2.25 2.25 0 1 1 3.4 1.93c-.68.4-1.15.9-1.15 1.57V11" />
      <path d="M12 11 3.62 16.63a.75.75 0 0 0 .42 1.37h15.92a.75.75 0 0 0 .42-1.37L12 11Z" />
    </Icon>
  );
}

/** Outfits: two overlapping cards. */
export function OutfitsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.75" y="7.5" width="10.5" height="12.75" rx="2.25" />
      <path d="M9.75 7.5V6a2.25 2.25 0 0 1 2.25-2.25h6A2.25 2.25 0 0 1 20.25 6v8.25a2.25 2.25 0 0 1-2.25 2.25h-3.75" />
    </Icon>
  );
}

/** Categories: a label tag. */
export function TagIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.75 5.25v5.63c0 .4.16.78.44 1.06l7.87 7.87a1.5 1.5 0 0 0 2.12 0l5.63-5.63a1.5 1.5 0 0 0 0-2.12L11.94 4.2a1.5 1.5 0 0 0-1.06-.44H5.25a1.5 1.5 0 0 0-1.5 1.5Z" />
      <circle cx="8.25" cy="8.25" r="1.25" />
    </Icon>
  );
}

/** Account: head and shoulders. */
export function AccountIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8.25" r="3.75" />
      <path d="M4.75 20.25a7.25 7.25 0 0 1 14.5 0" />
    </Icon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5.25v13.5M5.25 12h13.5" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6.75 9.75 5.25 5.25 5.25-5.25" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5.25 12.75 4.5 4.5 9-10.5" />
    </Icon>
  );
}
