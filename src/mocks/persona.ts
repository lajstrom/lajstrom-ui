// Who the mock serves: the principal of the request being answered, set by the authentication
// of src/mocks/auth.ts from its Authorization header, the way the server does (docs/auth.md).
// A user name of the mock, or "anonymous".
//
// Handlers are answered one at a time up to their first await, and src/mocks/handlers.ts sets
// the persona after its simulated latency and before it reads the database, so a request never
// sees another one's principal.

export type Persona = string;

let current: Persona = "anonymous";

export function getPersona(): Persona {
  return current;
}

export function setPersona(p: Persona): void {
  current = p;
}
