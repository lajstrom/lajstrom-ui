// Who the mock pretends the caller is. The real UI gets this from GET /api/v1/whoami; in mock
// mode the user menu switches between personas to show how the UI adapts to RBAC.

export type Persona = "admin" | "alice" | "anonymous";

export const personas: { id: Persona; label: string; description: string }[] = [
  { id: "admin", label: "admin", description: "admin on */* — sees system pages" },
  { id: "alice", label: "alice", description: "reader on */*, writer on */payments" },
  { id: "anonymous", label: "anonymous", description: "no credentials — anonymous-read repos only" },
];

const KEY = "lajstrom.mock.persona";

export function getPersona(): Persona {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "admin" || v === "alice" || v === "anonymous") return v;
  } catch {
    // Storage disabled: fall back to the default.
  }
  return "admin";
}

export function setPersona(p: Persona): void {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    // Ignore: the choice then lasts until reload.
  }
}
