# 0003. Changes are realistic by default and optimistic where it is safe

- Status: proposed
- Date: 2026-11-15
- Deciders: gecube

## Context

The UI starts to change things on the server: tokens now, then yank and delete ([#8](https://github.com/lajstrom/lajstrom-ui/issues/8)),
users and bindings ([#9](https://github.com/lajstrom/lajstrom-ui/issues/9)), repositories ([#10](https://github.com/lajstrom/lajstrom-ui/issues/10)), webhooks ([#32](https://github.com/lajstrom/lajstrom-ui/issues/32)) and deploy tokens over a mask
([#33](https://github.com/lajstrom/lajstrom-ui/issues/33)). Without one rule, each screen would invent its own: one waits for the server, the next
shows the change at once and forgets to undo it when the server refuses, a third does both on
different rows. [ADR 0002](0002-stay-on-react.md) kept TanStack Query for its cache and rollback;
this ADR says how the screens use them ([#3](https://github.com/lajstrom/lajstrom-ui/issues/3)).

## Decision

**Realistic is the default.** The screen shows what the server confirmed. A change in flight
shows as pending: the button says so and is disabled, the form stays open. When the server
answers, the queries that show the change are fetched again, and the change stays pending until
they are, so the screen goes from the old state straight to the server's new one.

**Optimistic where it is safe.** The screen shows the result at once and goes back to the
server's state if the server refuses. Safe means all three:

- the change can be undone, or the user confirmed it before it was sent;
- the UI knows the caller may make it (`permissions`, the role), so a refusal is rare;
- nothing in the answer is needed to show the result.

| Change | Mode | Why |
| --- | --- | --- |
| revoke a token (personal or deploy) | confirm, then optimistic | idempotent; the row only gets "revoked" |
| yank, unyank | optimistic, with Undo in the notice | the opposite call undoes it |
| disable or enable a user, change a repo's `anonymousRead` or policy | optimistic | a PATCH the UI can predict |
| delete a binding | optimistic | can be created again |
| create a token, a webhook, or rotate a secret | realistic | the secret exists only in the answer |
| create a user, a binding or a repo | realistic | the server assigns ids and checks the name |
| delete a version or a repo | confirm, then realistic | cannot be undone |
| reindex, prefetch, purge the upstream cache | realistic, polled | a job on the server; progress comes from its status |

**A refusal is shown where the change was made.** A realistic change shows the server's error in
its form or dialog, which is still open. An optimistic one has left the screen: the thing goes
back to the server's state with the error next to it, and a notice says what was refused and
why. Notices (`src/lib/notices.ts`, `<Notices />` in the shell) stay a few seconds, a refusal
until it is closed, and may carry an action such as Undo.

**How.** `src/api/change.ts` holds both modes as callbacks of `useMutation`:

- `realistic(...queryKeys)` fetches the queries again once the server has answered.
- `optimistic({ queryKey, apply, describe })` cancels the query's fetches, applies the change to
  its cached data, and, on a refusal, puts back the data as it was before the first change in
  flight with the other changes applied again, so that two changes of one list do not undo each
  other. When the last change of the query settles, the query is fetched again.
- `useChanges(mutationKey, id)` gives each thing's last change, pending or refused, for the row
  or the button that shows it.

A mutation that changes something shows the mode it uses; an issue for a new change names its
row of the table, or adds one.

## Consequences

- The token screens use it: revoke is optimistic after the confirmation, create is realistic.
- Every new change picks a row of the table in its pull request; a change that fits none is a
  reason to amend this ADR.
- An optimistic change reads the cached data; a screen whose data is not in the cache (another
  page of a list) shows the change when the query is fetched again.
- An optimistic screen shows a change as done before the request has reached the server, and
  closing or reloading the page then drops the request. While a change is in flight the browser
  asks before leaving the page (`beforeunload` in `src/main.tsx`).
- `src/api/change.test.ts` runs both modes against the mock: success, refusal and rollback, and
  a refusal while another change of the same list is in flight.
