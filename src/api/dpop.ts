// DPoP (RFC 9449): the proof of this browser's key that goes with the token of a sign-in
// (POST /api/v1/login) on every request, and with the sign-in itself. The server's side is
// docs/api.md, "The DPoP-bound token", and docs/spec/http-routing.md §4 of lajstrom/lajstrom; its
// choices, ADR 0022 §8 there: ES256 only, no server nonce, iat within 5 minutes of its clock.
//
// Written on WebCrypto, without a library (docs/adr/0002-stay-on-react.md: few dependencies): a
// proof is a JWS of two JSON objects, and WebCrypto's ECDSA P-256 signature with SHA-256 is
// already the r||s of 64 bytes that ES256 takes (RFC 7518 §3.4).

/** The public part of a P-256 key as a JWK, with the members a proof's header carries. */
export type PublicJwk = { kty: "EC"; crv: "P-256"; x: string; y: string };

/** The claims of a proof (RFC 9449 §4.2); ath only with a token. */
export type ProofClaims = { jti: string; htm: string; htu: string; iat: number; ath?: string };

const KEY = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGNATURE = { name: "ECDSA", hash: "SHA-256" } as const;

const utf8 = (s: string) => new TextEncoder().encode(s);

/** base64url without padding (RFC 4648 §5), as JWS and RFC 7638 write bytes. */
export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const x of b) binary += String.fromCharCode(x);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const sha256 = async (s: string) => base64url(await crypto.subtle.digest("SHA-256", utf8(s)));

/** Whether this browser can sign proofs: WebCrypto's subtle API exists in a secure context only
 * (https, or http on localhost). */
export function dpopSupported(): boolean {
  return typeof crypto !== "undefined" && crypto.subtle !== undefined;
}

/** A new P-256 key pair whose private key cannot be exported (extractable false): a script can
 * sign with it while the page is open, but never read it out. The public key is always
 * exportable. */
export function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(KEY, false, ["sign", "verify"]);
}

const jwks = new WeakMap<CryptoKey, Promise<PublicJwk>>();

/** The public key as the jwk of a proof's header: kty, crv, x and y, nothing else. */
export function publicJwk(publicKey: CryptoKey): Promise<PublicJwk> {
  let jwk = jwks.get(publicKey);
  if (!jwk) {
    jwk = crypto.subtle.exportKey("jwk", publicKey).then(({ x, y }) => {
      if (!x || !y) throw new Error("the DPoP key has no public x and y");
      return { kty: "EC", crv: "P-256", x, y };
    });
    jwks.set(publicKey, jwk);
  }
  return jwk;
}

/** The JWK SHA-256 thumbprint of RFC 7638 §3: the SHA-256 of the required members in
 * lexicographic order, without whitespace, base64url. The token's dpopJkt, and the dpop_jkt of
 * an OIDC login. */
export function jwkThumbprint(jwk: PublicJwk): Promise<string> {
  return sha256(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }));
}

/** The ath of a proof that goes with a token: the base64url SHA-256 of its ASCII (RFC 9449 §4.2). */
export function tokenHash(token: string): Promise<string> {
  return sha256(token);
}

/** The htu of a request: its absolute URL without query and fragment. The URL parser has
 * normalized it already: the scheme and host in lower case, no default port, no dot segments. */
export function htuOf(url: string | URL): string {
  const u = new URL(url);
  return u.origin + u.pathname;
}

// The server's clock. It refuses a proof whose iat is more than 5 minutes off its own, and a
// laptop's clock may be that far off; without a nonce of the server's (ADR 0022 §8.6), the UI
// takes the server's time from the Date of the answer that refused a proof, and signs by it from
// then on (§8.4). CORS exposes Date to another origin (http-routing.md §4). The offset is kept in
// localStorage: it is the laptop's, and a reload need not be refused once more to learn it.

const SKEW = "lajstrom.serverClock";

/** How far the server's clock is ahead of this browser's, in milliseconds; null until read. */
let skew: number | null = null;

/** How far the server's clock is ahead of this browser's, in milliseconds, as last learned. */
export function clockSkew(): number {
  if (skew === null) {
    skew = 0;
    try {
      const kept = Number(localStorage.getItem(SKEW) ?? 0);
      if (Number.isFinite(kept)) skew = kept;
    } catch {
      // No storage: the tab learns it again.
    }
  }
  return skew;
}

/** Now by the server's clock, as far as this browser knows it. */
export function serverNow(now = Date.now()): number {
  return now + clockSkew();
}

/** Takes the server's time from the Date of an answer, received at now. Whether it moved the
 * clock proofs are signed by: Date counts whole seconds, so a move of less is none. */
export function learnServerClock(date: string | null, now = Date.now()): boolean {
  const server = date ? Date.parse(date) : NaN;
  if (!Number.isFinite(server)) return false;
  const before = clockSkew();
  skew = server - now;
  try {
    if (Math.abs(skew) < 1000) localStorage.removeItem(SKEW);
    else localStorage.setItem(SKEW, String(skew));
  } catch {
    // Kept for this tab only.
  }
  return Math.abs(skew - before) >= 1000;
}

/** The error of a DPoP challenge, WWW-Authenticate: DPoP error="…" (RFC 9449 §7.1), and its
 * error_description; null for any other challenge. */
export function dpopChallenge(header: string | null): { error: string; description: string } | null {
  if (!header || !/(^|,\s*)DPoP(\s|$)/i.test(header)) return null;
  const error = /\berror="([^"]*)"/.exec(header)?.[1];
  if (!error) return null;
  return { error, description: /\berror_description="([^"]*)"/.exec(header)?.[1] ?? "" };
}

/** Whether an answer refused a proof for its iat, which the server's clock may set right: a 401
 * whose challenge is DPoP error="invalid_dpop_proof" about iat, or the 400 of a sign-in whose
 * message is the proof's refusal ("DPoP: the proof's iat is not within 5 minutes of the
 * server's clock", internal/api/login.go of the server). */
export function refusedForIat(status: number, challenge: string | null, message: string): boolean {
  const aboutIat = (s: string) => /\biat\b/.test(s);
  if (status === 401) {
    const c = dpopChallenge(challenge);
    return c?.error === "invalid_dpop_proof" && aboutIat(c.description || message);
  }
  return status === 400 && /^DPoP:/.test(message) && aboutIat(message);
}

/** A new proof for a request (RFC 9449 §4.2), signed with the key: its method and URL, a random
 * jti, iat by the server's clock, and ath with the token it goes with; a sign-in has none. A
 * proof is good for one request: the server takes a jti once. */
export async function createProof(
  key: CryptoKeyPair,
  request: { method: string; url: string | URL; token?: string; now?: number },
): Promise<string> {
  const header = { typ: "dpop+jwt", alg: "ES256", jwk: await publicJwk(key.publicKey) };
  const claims: ProofClaims = {
    jti: base64url(crypto.getRandomValues(new Uint8Array(16))),
    htm: request.method,
    htu: htuOf(request.url),
    iat: Math.floor(serverNow(request.now) / 1000),
  };
  if (request.token !== undefined) claims.ath = await tokenHash(request.token);
  const input = `${base64url(utf8(JSON.stringify(header)))}.${base64url(utf8(JSON.stringify(claims)))}`;
  const signature = await crypto.subtle.sign(SIGNATURE, key.privateKey, utf8(input));
  return `${input}.${base64url(signature)}`;
}
