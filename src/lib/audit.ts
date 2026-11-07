// push, delete, repo.create and token.create are named in docs/spec/index-schema.md; the others
// follow the same <resource>.<verb> pattern and are this prototype's proposal.
export const auditActions = [
  "push",
  "delete",
  "repo.create",
  "repo.update",
  "repo.reindex",
  "token.create",
  "token.revoke",
  "binding.create",
  "user.create",
  "user.disable",
  "key.rotate",
];
