// Formatting of sizes, times and digests for display.

const units = ["B", "KiB", "MiB", "GiB", "TiB"];

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n < 1024) return `${n} B`;
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[u]}`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const steps: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago", "yesterday"; the absolute time goes to a tooltip (formatDateTime). */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "just now";
  for (const [unit, secs] of steps) {
    if (abs >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return rtf.format(Math.round(diff / 60), "minute");
}

const dtf = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dtf.format(new Date(iso));
}

const df = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "short", day: "2-digit" });

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return df.format(new Date(iso));
}

/** sha256:9f3a…c01b — enough to recognise a digest; the full value is copied. */
export function shortDigest(digest: string, keep = 12): string {
  const [algo, hex] = digest.includes(":") ? digest.split(":", 2) : ["", digest];
  if (!hex || hex.length <= keep) return digest;
  return `${algo ? algo + ":" : ""}${hex.slice(0, keep)}`;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}
