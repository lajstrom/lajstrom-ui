// The actions of the audit log as the server writes them (docs/operations.md, Audit), and the
// states of a row.
export const auditActions = [
  "push",
  "delete",
  "npm.dist-tag",
  "npm.deprecate",
  "pypi.yank",
  "proxy.fetch",
  "proxy.reject",
  "repo.create",
  "repo.update",
  "repo.delete",
  "repo.reindex",
  "repo.cache.purge",
  "user.create",
  "user.rename",
  "user.disable",
  "user.enable",
  "user.password",
  "user.delete",
  "binding.create",
  "binding.delete",
  "token.create",
  "token.revoke",
  "key.rotate",
  "key.drop",
  "reconcile",
  "referrers.repair",
];

export const auditStates = ["ok", "pending", "failed", "unknown"] as const;
