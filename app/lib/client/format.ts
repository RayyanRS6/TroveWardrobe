// Small display helpers shared by the wardrobe UI.

/** "1 piece", "3 pieces". */
export function plural(count: number, singular: string, multiple = `${singular}s`) {
  return `${count} ${count === 1 ? singular : multiple}`;
}

/** Decimal units, matching how storage limits are quoted ("9 GB"). */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits).replace(/\.0$/, "")} ${units[unit]}`;
}

/** "29 Sep 2026" in the viewer's locale; empty for an unreadable date. */
export function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function greetingFor(hour: number) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Trims and collapses whitespace the way the API does before validating. */
export function cleanText(value: FormDataEntryValue | string | null | undefined) {
  return typeof value === "string"
    ? value.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim()
    : "";
}
