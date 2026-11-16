// The roles of a binding (docs/spec/rbac.md §3) as the UI shows them.

import type { Binding } from "@/api/types";

export type Role = Binding["role"];

export const roles: Role[] = ["reader", "attacher", "writer", "maintainer", "admin"];

export const roleTone: Record<Role, "primary" | "success" | "warning" | "neutral"> = {
  admin: "warning",
  maintainer: "primary",
  writer: "success",
  attacher: "neutral",
  reader: "neutral",
};

export const roleActions: Record<Role, string> = {
  reader: "read",
  // A scanner's or a signing job's: signatures, SBOMs, scan reports as referrers on /v2.
  attacher: "read, attach",
  writer: "read, write",
  maintainer: "read, write, delete, manage",
  admin: "everything, plus system and audit",
};
