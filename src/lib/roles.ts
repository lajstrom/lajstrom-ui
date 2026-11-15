// The roles of a binding (docs/spec/rbac.md §3) as the UI shows them.

import type { Binding } from "@/api/types";

export type Role = Binding["role"];

export const roles: Role[] = ["reader", "writer", "maintainer", "admin"];

export const roleTone: Record<Role, "primary" | "success" | "warning" | "neutral"> = {
  admin: "warning",
  maintainer: "primary",
  writer: "success",
  reader: "neutral",
};

export const roleActions: Record<Role, string> = {
  reader: "read",
  writer: "read, write",
  maintainer: "read, write, delete, manage",
  admin: "everything, plus system and audit",
};
