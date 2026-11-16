// The DPoP proofs of the demo's sign-ins, checked as the server checks them
// (docs/spec/http-routing.md §4 of lajstrom/lajstrom; internal/auth/dpop there): the header
// DPoP, one JWT of at most 4096 bytes whose header has typ dpop+jwt, alg ES256 and a public P-256
// jwk, and whose signature verifies with it; htm the method, htu the URL without query and
// fragment, iat within 5 minutes, a jti used once, and ath with a token. Written apart from the
// client's src/api/dpop.ts, so that a proof the client gets wrong fails in the demo too.
//
// Stricter than the server in one point: an htu with a query or a fragment is refused, as RFC
// 9449 §4.2 says it has none, where the server drops them before it compares.

const WINDOW = 5 * 60; // seconds of iat before or after the clock
const MAX_PROOF = 4096;
const MAX_JTI = 256;
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];

/** A proof that holds for its request: the thumbprint of its key (RFC 7638), its jti and iat. */
export type Proof = { jkt: string; jti: string; iat: number };

/** A proof, or why it is refused, in the server's words (dpop.Why). */
export type ProofCheck = Proof | { why: string };

const refuse = (why: string): ProofCheck => ({ why });

function decode(part: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(part)) return null;
  try {
    const binary = atob(part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function encode(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function json(part: string): Record<string, unknown> | null {
  const bytes = decode(part);
  if (!bytes) return null;
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const sha256 = async (s: string) => encode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/** The JWK SHA-256 thumbprint of a P-256 key (RFC 7638 §3.2: crv, kty, x, y in that order). */
export function thumbprint(x: string, y: string): Promise<string> {
  return sha256(`{"crv":"P-256","kty":"EC","x":"${x}","y":"${y}"}`);
}

/** The ath of a token: the base64url SHA-256 of its ASCII. */
export function tokenHash(token: string): Promise<string> {
  return sha256(token);
}

/** The URL a proof's htu must name: the request's, without query and fragment. */
function target(request: Request): string {
  const u = new URL(request.url);
  return u.origin + u.pathname;
}

/**
 * Checks the proof of request: its header DPoP, against the request's method and URL, the
 * clock (now, in milliseconds) and, when token is given, ath. It does not record the jti:
 * spendProof does, once the request is otherwise accepted, as the server does.
 */
export async function verifyProof(request: Request, token: string | null, now = Date.now()): Promise<ProofCheck> {
  const value = request.headers.get("DPoP");
  // Headers joins two headers of one name with ", ", which no JWT has.
  if (value === null) return refuse("the request has no DPoP header");
  if (value.includes(",")) return refuse("the request has more than one DPoP header");
  if (value.length > MAX_PROOF) return refuse(`the proof is longer than ${MAX_PROOF} bytes`);
  const parts = value.split(".");
  const header = parts.length === 3 ? json(parts[0]!) : null;
  const claims = parts.length === 3 ? json(parts[1]!) : null;
  const signature = parts.length === 3 ? decode(parts[2]!) : null;
  if (!header || !claims || !signature) return refuse("the proof is not a JWT");

  if (header.alg !== "ES256") return refuse("the proof's alg is not ES256");
  if (header.typ !== "dpop+jwt") return refuse("the proof's typ is not dpop+jwt");
  const jwk = header.jwk;
  if (typeof jwk !== "object" || jwk === null || Array.isArray(jwk)) return refuse("the proof's header has no jwk");
  const k = jwk as Record<string, unknown>;
  if (PRIVATE_MEMBERS.some((m) => m in k)) return refuse("the proof's jwk holds a private key");
  if (k.kty !== "EC" || k.crv !== "P-256") return refuse("the proof's jwk is not a P-256 key");
  const x = typeof k.x === "string" ? k.x : "";
  const y = typeof k.y === "string" ? k.y : "";
  if (decode(x)?.length !== 32 || decode(y)?.length !== 32 || /=/.test(x + y)) return refuse("the proof's jwk has no x and y of 32 bytes");
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x, y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    return refuse("the proof's jwk is not a point of P-256");
  }
  const input = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid =
    signature.length === 64 &&
    (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, input));
  if (!valid) return refuse("the proof's signature does not verify with its jwk");

  const { jti, htm, htu, iat, ath } = claims;
  if (typeof jti !== "string" || !jti || typeof htm !== "string" || !htm || typeof htu !== "string" || !htu || typeof iat !== "number") {
    return refuse("the proof lacks one of jti, htm, htu and iat");
  }
  if (new TextEncoder().encode(jti).length > MAX_JTI) return refuse(`the proof's jti is longer than ${MAX_JTI} bytes`);
  if (htm !== request.method) return refuse("the proof's htm is not the method of the request");
  let named: string;
  try {
    const u = new URL(htu);
    if (u.search || u.hash || htu.includes("?") || htu.includes("#")) return refuse("the proof's htu has a query or a fragment");
    named = u.origin + u.pathname;
  } catch {
    return refuse("the proof's htu is not the URI of the request");
  }
  if (named !== target(request)) return refuse("the proof's htu is not the URI of the request");
  if (Math.abs(now / 1000 - iat) > WINDOW) return refuse("the proof's iat is not within 5 minutes of the server's clock");
  if (token !== null && ath !== (await tokenHash(token))) return refuse("the proof's ath is not the hash of the token");
  return { jkt: await thumbprint(x, y), jti, iat };
}

/** The proofs used, by thumbprint and jti, until their iat and 5 minutes. */
const spent = new Map<string, number>();

/** Records a proof as used; why it is refused when it was used already. */
export function spendProof(p: Proof, now = Date.now()): string | null {
  for (const [k, until] of spent) if (until * 1000 < now) spent.delete(k);
  const key = `${p.jkt} ${p.jti}`;
  if (spent.has(key)) return "the proof was used already";
  spent.set(key, p.iat + WINDOW);
  return null;
}
