// The mock's webhooks (docs/api.md, Webhooks; docs/spec/webhooks.md): those of a repo and those
// of any mask, with the checks and the messages of the server's internal/webhook, and their
// delivery logs. The demo sends nothing: a ping's outcome follows the receiver's host (attempt),
// and the seeded logs are what a week of events would have left behind. Handlers in handlers.ts
// decide who may; what changes here is kept between visits (src/mocks/state.ts).

import type { CreatedWebhook, Delivery, DeliveryList, Webhook, WebhookEvent, WebhookSecret } from "@/api/types";
import { sha256Hex } from "@/lib/sha256";

import { ahead, ago, before } from "./data/time";
import { apiPrincipal, audited, serverInfo, type Refusal } from "./db";
import { keep, persist } from "./state";

/** The types a webhook may ask for, in the order of webhooks.md §1. */
const TYPES: WebhookEvent[] = ["version.published", "version.deleted", "repo.created", "repo.deleted"];

/** webhooks.allowedHosts of the demo's configuration: reached over http and at any address. */
const ALLOWED_HOSTS = ["ci.internal"];

/** A row of a delivery log, of the webhook it was sent to. */
type MockDelivery = Delivery & { webhookId: number };

const invalid = (message: string): Refusal => ({ status: 400, code: "INVALID", message });

const NO_MASTER_KEY: Refusal = {
  status: 501,
  code: "UNAVAILABLE",
  message: "webhooks need the master key: set keys.masterKeyEnv or keys.masterKeyFile",
};

// --- The seed ---------------------------------------------------------------------------------

const admin = apiPrincipal("user:admin");

const webhooks: Webhook[] = [
  {
    id: 1,
    mask: "raw/assets",
    url: "https://ci.example.com/hooks/lajstrom/site",
    events: ["version.published"],
    active: true,
    description: "rebuild the site",
    createdBy: admin,
    createdAt: ago(40),
    updatedAt: ago(40),
  },
  {
    id: 2,
    mask: "*/payments",
    url: "https://audit.example.com/lajstrom/events",
    events: [],
    active: true,
    description: "compliance archive of every payments repo",
    createdBy: admin,
    createdAt: ago(24),
    updatedAt: ago(24),
  },
  {
    id: 3,
    mask: "apt/ubuntu-internal",
    url: "https://mirror-sync.example.org/hooks/apt",
    events: ["version.deleted", "version.published"],
    active: true,
    description: "refresh the mirror at the branch offices",
    createdBy: apiPrincipal("user:bob"),
    createdAt: ago(21),
    updatedAt: ago(21),
  },
  {
    id: 4,
    mask: "pypi/internal",
    url: "https://chat.example.com/hooks/T0001/B0002/x9KqLw",
    events: ["version.published"],
    active: false,
    description: "post releases to #python",
    createdBy: admin,
    createdAt: ago(60),
    updatedAt: before(2, 1),
  },
];

/** How a seeded delivery ended, or where it is: delivered with the receiver's status; failed
 * after its attempts; pending, due `next` minutes from now (negative: due already). */
type Outcome =
  | { state: "delivered"; status: number; attempts?: number }
  | { state: "failed"; attempts: number; status?: number; error: string }
  | { state: "pending"; attempts: number; next: number; status?: number; error?: string };

type SeedRow = { webhook: number; minutes: number; type: string; outcome: Outcome };

/** A UUID v7 of a time, as an event's id: the time in its first 48 bits, the rest from seed. */
function uuid7(ms: number, seed: string): string {
  const t = ms.toString(16).padStart(12, "0");
  const h = sha256Hex(seed);
  const variant = (8 | (parseInt(h[3]!, 16) & 3)).toString(16);
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${h.slice(0, 3)}-${variant}${h.slice(4, 7)}-${h.slice(7, 19)}`;
}

function seedRows(): SeedRow[] {
  const rows: SeedRow[] = [];
  // raw/assets: a publish every few hours for a week, delivered but for a timeout, a retry and
  // the newest, which the receiver answered 503 a minute ago.
  for (let i = 0; i < 26; i++) {
    const outcome: Outcome =
      i === 0
        ? { state: "pending", attempts: 2, next: 1.5, status: 503, error: "answered 503" }
        : i === 7
          ? { state: "failed", attempts: 8, error: "timeout" }
          : i === 12
            ? { state: "delivered", status: 200, attempts: 2 }
            : { state: "delivered", status: i % 3 ? 202 : 200 };
    rows.push({ webhook: 1, minutes: 25 + i * 370 + ((i * 37) % 90), type: "version.published", outcome });
  }
  // */payments: every event of pypi/payments and maven/payments, delivered.
  for (let i = 0; i < 8; i++) {
    rows.push({ webhook: 2, minutes: 90 + i * 690, type: i === 5 ? "version.deleted" : "version.published", outcome: { state: "delivered", status: 200 } });
  }
  // apt/ubuntu-internal: the receiver refuses connections since this morning.
  for (let i = 0; i < 12; i++) {
    const outcome: Outcome =
      i === 0
        ? { state: "pending", attempts: 3, next: 2, error: "connection refused" }
        : i === 1
          ? { state: "pending", attempts: 5, next: 7, error: "connection refused" }
          : i === 2
            ? { state: "failed", attempts: 8, error: "connection refused" }
            : i === 3
              ? { state: "failed", attempts: 8, status: 502, error: "answered 502" }
              : { state: "delivered", status: 204 };
    rows.push({ webhook: 3, minutes: 40 + i * 600, type: i % 4 === 2 ? "version.deleted" : "version.published", outcome });
  }
  // pypi/internal: inactive for two days; its pending rows wait for it to be active again.
  for (const [minutes, outcome] of [
    [300, { state: "pending", attempts: 0, next: -300 }],
    [1500, { state: "pending", attempts: 0, next: -1500 }],
    [3300, { state: "delivered", status: 200 }],
    [5100, { state: "delivered", status: 200 }],
    [8000, { state: "delivered", status: 200 }],
  ] as [number, Outcome][]) {
    rows.push({ webhook: 4, minutes, type: "version.published", outcome });
  }
  return rows;
}

const minutesAgo = (m: number) => before(0, 0, m);

function seedDeliveries(): MockDelivery[] {
  const rows = seedRows().sort((a, b) => b.minutes - a.minutes);
  return rows.map((r, i): MockDelivery => {
    const createdAt = minutesAgo(r.minutes);
    const head = { webhookId: r.webhook, id: i + 1, eventId: uuid7(Date.parse(createdAt), `event ${r.webhook} ${r.minutes}`), eventType: r.type, createdAt };
    const o = r.outcome;
    if (o.state === "delivered") {
      const at = minutesAgo(r.minutes - ((o.attempts ?? 1) > 1 ? 0.5 : 0.02));
      return { ...head, state: "delivered", attempts: o.attempts ?? 1, lastAt: at, lastStatus: o.status, deliveredAt: at };
    }
    if (o.state === "failed") {
      return { ...head, state: "failed", attempts: o.attempts, lastAt: minutesAgo(r.minutes - 64), ...(o.status ? { lastStatus: o.status } : {}), lastError: o.error };
    }
    return {
      ...head,
      state: "pending",
      attempts: o.attempts,
      nextAt: o.next < 0 ? minutesAgo(-o.next) : ahead(0, 0, o.next),
      ...(o.attempts ? { lastAt: minutesAgo(0.5 * o.attempts) } : {}),
      ...(o.status ? { lastStatus: o.status } : {}),
      ...(o.error ? { lastError: o.error } : {}),
    };
  });
}

const deliveries: MockDelivery[] = seedDeliveries();

let nextId = Math.max(...webhooks.map((w) => w.id)) + 1;
let nextDelivery = deliveries.length + 1;

/** Whether the server has a master key: without one, a webhook is neither created, given a new
 * secret nor tested (501), and is still listed, changed and deleted. */
let masterKey = true;

keep("webhooks", {
  save: () => ({ webhooks, deliveries, nextId, nextDelivery, masterKey }),
  load: (data) => {
    const d = data as { webhooks?: unknown; deliveries?: unknown; nextId?: unknown; nextDelivery?: unknown; masterKey?: unknown };
    if (!Array.isArray(d.webhooks) || !Array.isArray(d.deliveries) || typeof d.nextId !== "number" || typeof d.nextDelivery !== "number") return;
    webhooks.splice(0, webhooks.length, ...(d.webhooks as Webhook[]));
    deliveries.splice(0, deliveries.length, ...(d.deliveries as MockDelivery[]));
    nextId = d.nextId;
    nextDelivery = d.nextDelivery;
    masterKey = d.masterKey !== false;
  },
});

/** Gives the server a master key, or takes it away: what keys.masterKeyEnv does on the server. */
export function setMasterKey(on: boolean): void {
  masterKey = on;
  persist();
}

// --- The checks of a request -----------------------------------------------------------------

type Body = { mask?: string; url?: string; events?: string[]; active?: boolean; description?: string };

/** What Go's encoding/json names a JSON value of the wrong type. */
const kind = (v: unknown) => (Array.isArray(v) ? "array" : typeof v === "boolean" ? "bool" : typeof v);

/** The body of a POST or a PATCH, as the server decodes it: unknown fields refused, null as
 * absent. */
function decodeBody(body: unknown): Body | Refusal {
  if (body === null || body === undefined) return invalid("body: must be a JSON object");
  if (typeof body !== "object" || Array.isArray(body)) return invalid(`body: must be a JSON object, not ${kind(body)}`);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!["mask", "url", "events", "active", "description"].includes(k)) return invalid(`body: unknown field "${k}"`);
    if (v === null) continue;
    if (k === "active" ? typeof v !== "boolean" : k === "events" ? !Array.isArray(v) : typeof v !== "string") return invalid(`${k}: must not be a JSON ${kind(v)}`);
    if (k === "events") {
      const bad = (v as unknown[]).find((e) => typeof e !== "string");
      if (bad !== undefined) return invalid(`events: must not be a JSON ${kind(bad)}`);
    }
    out[k] = v;
  }
  return out as Body;
}

/** A repo mask of rbac.md §3 whose format segment this server serves ("*" and oci always). */
function checkMask(mask: string): Refusal | null {
  const i = mask.indexOf("/");
  const format = mask.slice(0, i);
  const repo = mask.slice(i + 1);
  if (i < 0 || !format || !repo || repo.includes("/")) return invalid(`mask: mask ${JSON.stringify(mask)}: want <format>/<repo>, each a name or *`);
  if (format !== "*" && format !== "oci" && !serverInfo.formats.some((f) => f.name === format)) {
    return invalid(`mask: ${JSON.stringify(format)} is not a format of this build`);
  }
  return null;
}

/** Whether an address literal is public: not loopback, a private range, link-local, carrier-grade
 * NAT, unspecified, multicast or broadcast (webhooks.md §4, Egress). */
function isPublic(host: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128));
  }
  const v6 = host.toLowerCase();
  return !(v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("ff") || v6.startsWith("::ffff:"));
}

const isAddress = (host: string) => /^[\d.]+$/.test(host) || host.includes(":");

/** Why a URL is refused (Deliverer.CheckURL of the server), or null. */
function urlRefusal(raw: string): string | null {
  if (new TextEncoder().encode(raw).length > 2048) return "longer than 2048 bytes";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "does not parse as a URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "must be an http or https URL";
  if (!u.hostname) return "must name a host";
  if (u.username || u.password) return "must not hold user information: Lajstrom signs its requests instead";
  if (u.hash || raw.includes("#")) return "must not have a fragment";
  const host = hostOf(raw);
  if (ALLOWED_HOSTS.includes(host)) return null;
  if (u.protocol !== "https:") return "must be https, unless webhooks.allowedHosts lists its host";
  if (isAddress(host) && !isPublic(host)) return "names an address that is not public, and webhooks.allowedHosts does not list it";
  return null;
}

/** The host of a URL, as the audit rows name it: without brackets, case or a final dot. */
function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  } catch {
    return "";
  }
}

/** The fields the body sets, checked, on a copy of the webhook; the webhook is left as it is. */
function applied(w: Webhook, b: Body): Webhook | Refusal {
  const out = { ...w };
  if (b.url !== undefined) {
    const why = urlRefusal(b.url);
    if (why) return invalid(`url: ${why}`);
    out.url = b.url;
  }
  if (b.events !== undefined) {
    const events = [...new Set(b.events)].sort();
    const unknown = events.find((e) => !TYPES.includes(e as WebhookEvent));
    if (unknown !== undefined) return invalid(`events: ${JSON.stringify(unknown)} is not one of [${TYPES.join(" ")}]`);
    out.events = events as WebhookEvent[];
  }
  if (b.active !== undefined) out.active = b.active;
  if (b.description !== undefined) {
    if (new TextEncoder().encode(b.description).length > 256) return invalid("description: longer than 256 bytes");
    out.description = b.description;
  }
  return out;
}

/** whsec_ and the base64 of 32 random bytes (webhooks.md §2). */
function newSecret(): string {
  return "whsec_" + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}

/** The audit row of a change of a webhook (rbac.md §5): its mask, the host of its URL and never
 * the URL. */
function record(action: string, w: Webhook, by: string): void {
  audited({
    principal: by,
    action,
    repo: w.mask,
    subject: `webhook:${w.id}`,
    details: { mask: w.mask, urlHost: hostOf(w.url), events: w.events.length ? w.events : null, active: w.active, source: "api" },
  });
}

const json = (w: Webhook): Webhook => ({ ...w, events: [...w.events] });

const deliveryJson = ({ webhookId: _, ...d }: MockDelivery): Delivery => d;

// --- The operations ----------------------------------------------------------------------------

/** The webhooks whose mask is mask, or every one for "", by id. */
export function listWebhooks(mask: string): Webhook[] {
  return webhooks.filter((w) => !mask || w.mask === mask).sort((a, b) => a.id - b.id).map(json);
}

/** The webhook of the id in the route's scope: under a repo, one of another mask is 404. */
export function webhookIn(mask: string, id: string): Webhook | Refusal {
  const n = /^\d+$/.test(id) ? Number(id) : 0;
  if (n <= 0) return { status: 404, code: "NOT_FOUND", message: `webhook ${JSON.stringify(id)} does not exist` };
  const w = webhooks.find((x) => x.id === n && (!mask || x.mask === mask));
  return w ? json(w) : { status: 404, code: "NOT_FOUND", message: `webhook ${n} does not exist` };
}

/** POST …/webhooks: under a repo its mask, which the body may name or leave out; under
 * /api/v1/webhooks the body names it. The answer has the secret, this once. */
export function createWebhook(scopeMask: string, body: unknown, by: string): CreatedWebhook | Refusal {
  const b = decodeBody(body);
  if ("status" in b) return b;
  if (scopeMask && b.mask !== undefined && b.mask !== scopeMask) return invalid(`mask: a webhook of this route has the mask ${scopeMask}; leave it out`);
  if (!scopeMask && b.mask === undefined) return invalid("mask: required, a repo mask such as apt/* or */*");
  const mask = scopeMask || b.mask!;
  if (!masterKey) return NO_MASTER_KEY;
  const badMask = checkMask(mask);
  if (badMask) return badMask;
  if (b.url === undefined) return invalid("url: required");
  const now = new Date().toISOString();
  const draft: Webhook = { id: 0, mask, url: "", events: [], active: true, description: "", createdBy: apiPrincipal(by), createdAt: now, updatedAt: now };
  const w = applied(draft, b);
  if ("status" in w) return w;
  w.id = nextId++;
  webhooks.push(w);
  record("webhook.create", w, by);
  persist();
  return { ...json(w), secret: newSecret() };
}

/** PATCH …/webhooks/{id}: the fields given of url, events, active and description; a mask, even
 * the same one, is 400. */
export function updateWebhook(w: Webhook, body: unknown, by: string): Webhook | Refusal {
  const b = decodeBody(body);
  if ("status" in b) return b;
  if (b.mask !== undefined) return invalid("mask: cannot change; delete the webhook and create one of the other mask");
  const changed = applied(w, b);
  if ("status" in changed) return changed;
  changed.updatedAt = new Date().toISOString();
  webhooks.splice(webhooks.findIndex((x) => x.id === w.id), 1, changed);
  record("webhook.update", changed, by);
  persist();
  return json(changed);
}

/** DELETE …/webhooks/{id}: the webhook and its delivery log. */
export function deleteWebhook(w: Webhook, by: string): void {
  webhooks.splice(webhooks.findIndex((x) => x.id === w.id), 1);
  for (let i = deliveries.length - 1; i >= 0; i--) if (deliveries[i]!.webhookId === w.id) deliveries.splice(i, 1);
  record("webhook.delete", w, by);
  persist();
}

/** POST …/webhooks/{id}/secret: a new secret, answered this once. */
export function rotateSecret(w: Webhook, by: string): WebhookSecret | Refusal {
  if (!masterKey) return NO_MASTER_KEY;
  const stored = webhooks.find((x) => x.id === w.id)!;
  stored.updatedAt = new Date().toISOString();
  record("webhook.secret", stored, by);
  persist();
  return { secret: newSecret() };
}

/** What a receiver answers in the demo, by the host of its URL: names that cannot resolve
 * (.invalid, localhost) are refused like a private address, .test never answers in time, and the
 * apt mirror's receiver is down; any other answers 200. */
function attempt(url: string): { delivered: boolean; status?: number; error?: string } {
  const host = hostOf(url);
  if (urlRefusal(url) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".invalid")) {
    return { delivered: false, error: "refused: the host has no public address" };
  }
  if (host.endsWith(".test")) return { delivered: false, error: "timeout" };
  if (host === "mirror-sync.example.org") return { delivered: false, error: "connection refused" };
  return { delivered: true, status: 200 };
}

/** POST …/webhooks/{id}/test: a webhook.ping now, once, active or not; its row of the log. */
export function testWebhook(w: Webhook): Delivery | Refusal {
  if (!masterKey) return NO_MASTER_KEY;
  const now = Date.now();
  const at = new Date(now).toISOString();
  const result = attempt(w.url);
  const d: MockDelivery = {
    webhookId: w.id,
    id: nextDelivery++,
    eventId: uuid7(now, `ping ${w.id} ${now} ${Math.random()}`),
    eventType: "webhook.ping",
    state: result.delivered ? "delivered" : "failed",
    attempts: 1,
    lastAt: at,
    ...(result.status ? { lastStatus: result.status } : {}),
    ...(result.error ? { lastError: result.error } : {}),
    createdAt: at,
    ...(result.delivered ? { deliveredAt: at } : {}),
  };
  deliveries.push(d);
  persist();
  return deliveryJson(d);
}

/** The cursor of a page: the id of its last row, in unpadded base64url, opaque to the client. */
const encodeCursor = (key: string) => btoa(key).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

function decodeCursor(cursor: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    return atob(cursor.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (cursor.length % 4)) % 4)) || null;
  } catch {
    return null;
  }
}

/** GET …/webhooks/{id}/deliveries[?limit=&cursor=]: a page of its log, newest first. */
export function listDeliveries(w: Webhook, limit: string | null, cursor: string | null): DeliveryList | Refusal {
  let n = 100;
  if (limit) {
    n = /^\d+$/.test(limit) ? Number(limit) : 0;
    if (n < 1 || n > 1000) return invalid(`limit: ${JSON.stringify(limit)} is not a number from 1 to 1000`);
  }
  let below = 0;
  if (cursor) {
    const key = decodeCursor(cursor);
    below = key && /^\d+$/.test(key) ? Number(key) : 0;
    if (below <= 0) return invalid(`cursor: ${JSON.stringify(cursor)} is not the next of a page of this list`);
  }
  const rows = deliveries.filter((d) => d.webhookId === w.id && (!below || d.id < below)).sort((a, b) => b.id - a.id);
  const page = rows.slice(0, n);
  return { deliveries: page.map(deliveryJson), ...(rows.length > n ? { next: encodeCursor(String(page.at(-1)!.id)) } : {}) };
}
