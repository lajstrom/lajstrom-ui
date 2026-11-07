// Times of the mock data.
//
// Content times (ingest time of manifests, audit events) are counted back from the start of the
// current UTC day: they end up inside the manifests, whose digests are real sha256 of the
// manifest JSON, so the digests stay the same on every reload during a day.
// Live state (sessions, health checks, "last used") is counted from the moment the page loaded,
// so "expires in 41 minutes" stays true.

const NOW = Date.now();
const DAY = NOW - (NOW % 86_400_000);
const MIN = 60_000;

/** RFC 3339 UTC without fractional seconds, like the spec's examples (2026-11-06T10:00:00Z). */
function rfc3339(ms: number): string {
  return new Date(ms - (ms % 1000)).toISOString().replace(".000Z", "Z");
}

/** A content time `days`, `hours` and `minutes` before the start of today (UTC). */
export function ago(days: number, hours = 0, minutes = 0): string {
  return rfc3339(DAY - ((days * 24 + hours) * 60 + minutes) * MIN);
}

/** A live time before now. */
export function before(days: number, hours = 0, minutes = 0): string {
  return rfc3339(NOW - ((days * 24 + hours) * 60 + minutes) * MIN);
}

/** A live time after now. */
export function ahead(days: number, hours = 0, minutes = 0): string {
  return rfc3339(NOW + ((days * 24 + hours) * 60 + minutes) * MIN);
}

export const HOST = "art.example.com";
export const EXTERNAL_URL = `https://${HOST}`;
