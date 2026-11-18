// Who the mock serves: the principal of the request being answered, set by the authentication
// of src/mocks/auth.ts from its Authorization header, the way the server does (docs/auth.md).
// A user name of the mock, or "anonymous"; and the credential it came with, which the steps of a
// CI trust policy that writes read (docs/spec/rbac.md §10, §11).
//
// Handlers are answered one at a time up to their first await, and src/mocks/handlers.ts sets
// the persona after its simulated latency and before it reads the database, so a request never
// sees another one's principal. A handler that awaits the body reads them before.

export type Persona = string;

/** When and how the person authenticated at the IdP, as an OIDC login keeps it on its token
 * (tokens.auth_time and tokens.amr): the sign-in of rbac.md §10. at is in milliseconds. */
export type SignIn = { at: number; amr: string[] };

/** What authenticated the request: nothing, a password in Basic credentials, a personal access
 * token, or the token of a web UI's sign-in with a proof of its key, with the sign-in of an OIDC
 * login when it has one. */
export type Credential = { kind: "none" } | { kind: "password" } | { kind: "token" } | { kind: "sign-in"; signIn?: SignIn };

const FACTORS: Record<string, string[]> = {
  knowledge: ["pwd", "pin", "kba"],
  possession: ["hwk", "swk", "otp", "sms", "tel", "sc", "pop"],
  inherence: ["fpt", "face", "iris", "retina", "vbm"],
};

/** Whether an amr shows a second factor: mfa, or methods of two kinds, with auth.oidc.mfa empty
 * (the demo's). */
export function secondFactor(amr: string[]): boolean {
  if (amr.includes("mfa")) return true;
  return Object.values(FACTORS).filter((methods) => methods.some((m) => amr.includes(m))).length >= 2;
}

let current: Persona = "anonymous";
let credential: Credential = { kind: "none" };

export function getPersona(): Persona {
  return current;
}

export function setPersona(p: Persona, c: Credential = { kind: "none" }): void {
  current = p;
  credential = c;
}

export function getCredential(): Credential {
  return credential;
}
