// Display helpers local to the community UI. Kept out of src/lib/format.ts so the
// forum presentation layer stays self-contained and doesn't touch shared files
// the data/ingestion side imports.

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 1000 * 60 * 60 * 24 * 365],
  ["month", 1000 * 60 * 60 * 24 * 30],
  ["week", 1000 * 60 * 60 * 24 * 7],
  ["day", 1000 * 60 * 60 * 24],
  ["hour", 1000 * 60 * 60],
  ["minute", 1000 * 60],
];

const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

/** "2 hours ago" / "just now" from an ISO timestamp. `now` is injectable for tests. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = then - now;
  const abs = Math.abs(diff);
  if (abs < 45 * 1000) return "just now";
  for (const [unit, ms] of UNITS) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(Math.round(diff / (1000 * 60)), "minute");
}

/** Compact vote/reply counts: 1200 -> "1.2k". */
export function compactCount(value: number): string {
  if (Math.abs(value) < 1000) return String(value);
  const k = value / 1000;
  return `${k.toFixed(k >= 10 || Number.isInteger(k) ? 0 : 1)}k`;
}
