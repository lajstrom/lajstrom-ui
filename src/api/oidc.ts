// What a sign-in through the server's OIDC login needs across the redirects (docs/api.md of the
// server, Sign in, With OIDC; ADR 0022 §5 and §8.7 there): a PKCE verifier (RFC 7636) that this
// tab keeps in sessionStorage while the person is at the IdP, and the code that the server's
// callback hands back in the fragment of the page it returns to, #code=<code>.

import { base64url } from "./dpop";

const PENDING = "lajstrom.oidc";

/** A PKCE verifier of 256 random bits: 43 characters of base64url, which RFC 7636 §4.1 allows
 * (A-Z a-z 0-9 - . _ ~, 43 to 128). */
export function pkceVerifier(random: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): string {
  return base64url(random);
}

/** The S256 challenge of a verifier: base64url(SHA-256(ASCII(verifier))), RFC 7636 §4.2. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
}

/** The server's login for a web UI: return_to, the page the callback sends the code to, the
 * challenge, and dpop_jkt, the thumbprint of the key that redeems the code. prompt "login" asks
 * the IdP to authenticate the person again, for a step that needs a fresh sign-in
 * (docs/spec/http-routing.md §7, rbac.md §10). */
export function oidcLoginUrl(apiBase: string, p: { returnTo: string; challenge: string; jkt: string; prompt?: "login" }): string {
  const q = new URLSearchParams({ return_to: p.returnTo, code_challenge: p.challenge, code_challenge_method: "S256", dpop_jkt: p.jkt });
  if (p.prompt) q.set("prompt", p.prompt);
  return `${apiBase}/-/oidc/login?${q.toString()}`;
}

/** Keeps the verifier in this tab until the person comes back from the IdP. */
export function rememberVerifier(verifier: string, storage: Storage = sessionStorage): void {
  storage.setItem(PENDING, verifier);
}

/**
 * The code that the server's callback put in the address's fragment, and the verifier this tab
 * kept for it; null when the address has no code. Once: the code leaves the address (the
 * fragment reaches no server, but stays in the history) and the verifier leaves the tab. The
 * verifier is null when this tab started no login: the code came to another tab, or the tab was
 * closed in between.
 */
export function takeOidcCallback(
  location: Pick<Location, "hash" | "pathname" | "search"> = window.location,
  history: Pick<History, "replaceState" | "state"> = window.history,
  storage: Storage = sessionStorage,
): { code: string; verifier: string | null } | null {
  const code = new URLSearchParams(location.hash.replace(/^#/, "")).get("code");
  if (!code) return null;
  history.replaceState(history.state, "", location.pathname + location.search);
  const verifier = storage.getItem(PENDING);
  storage.removeItem(PENDING);
  return { code, verifier };
}
