// realistic and optimistic (src/api/change.ts) against the mock of src/mocks/handlers.ts, served by
// msw in node: what the query cache holds while a change is in flight, once the server has made
// it, and once the server has refused it.

import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { dismiss, getNotices } from "@/lib/notices";
import { revoked } from "@/lib/tokens";
import { createToken } from "@/mocks/auth";
import { handlers } from "@/mocks/handlers";

import { optimistic, realistic, update } from "./change";
import { createUserToken, revokeUserToken } from "./mutations";
import { userTokensQuery } from "./queries";
import { setSession } from "./session";
import type { Token, TokenRequest } from "./types";

const server = setupServer(...handlers);

beforeAll(() => {
  // The client resolves /api/v1 against the page's origin.
  vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  server.resetHandlers();
  for (const n of getNotices()) dismiss(n.id);
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

/** Signs in as the user with a token of the mock's. */
function signIn(user: string) {
  const t = createToken({ user }, { name: `change test ${Math.random()}`, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  setSession({ token: t.secret, user, tokenId: t.id, expiresAt: null });
}

/** A token of the user's, made in the mock. */
function tokenOf(user: string, name: string): Token {
  const t = createToken({ user }, { name, expiresIn: "1h" });
  if ("status" in t) throw new Error(t.message);
  const { secret: _, ...token } = t;
  return token;
}

/** A query client whose list of the user's tokens is fetched, and stays observed, the way a page
 * shows it: an invalidated query is fetched again. */
async function watching(user: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const observer = new QueryObserver(client, userTokensQuery(user));
  observer.subscribe(() => {});
  await vi.waitFor(() => expect(observer.getCurrentResult().data).toBeDefined());
  return client;
}

const list = (user: string) => userTokensQuery(user).queryKey;
const row = (client: QueryClient, user: string, id: number) => client.getQueryData<Token[]>(list(user))?.find((t) => t.id === id);

function revoke(client: QueryClient, user: string, token: Token) {
  return new MutationObserver(client, {
    mutationFn: (t: Token) => revokeUserToken(user, t.id),
    ...optimistic({ updates: (t: Token) => [update(list(user), (tokens: Token[]) => revoked(tokens, t))], describe: (t) => `Revoke ${t.name}` }),
  }).mutate(token);
}

describe("optimistic", () => {
  it("shows the change before the server answers, and the server's state after", async () => {
    signIn("bob");
    const token = tokenOf("bob", "optimistic ok");
    const client = await watching("bob");
    const fetched = client.getQueryState(list("bob"))!.dataUpdatedAt;

    const done = revoke(client, "bob", token);
    await vi.waitFor(() => expect(row(client, "bob", token.id)?.revokedAt).toBeTruthy());
    expect(client.isMutating()).toBe(1);

    await done;
    expect(client.getQueryState(list("bob"))!.dataUpdatedAt).toBeGreaterThan(fetched);
    expect(row(client, "bob", token.id)?.revokedAt).toBeTruthy();
    expect(getNotices()).toEqual([]);
  });

  it("goes back to the server's state when the server refuses, and says why", async () => {
    signIn("bob");
    // A list bob saw before: alice's tokens are hers or the admin's (docs/api.md, Tokens).
    const token = tokenOf("alice", "optimistic refused");
    const client = new QueryClient();
    client.setQueryData(list("alice"), [token]);

    await expect(revoke(client, "alice", token)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(client.getQueryData(list("alice"))).toEqual([token]);
    expect(getNotices()).toMatchObject([
      { tone: "danger", title: "Revoke optimistic refused: refused", description: "Not allowed: the tokens of alice are alice's or the admin's." },
    ]);
  });

  it("keeps a change in flight when an earlier change of the same list is refused", async () => {
    signIn("bob");
    const first = tokenOf("bob", "first, refused");
    const second = tokenOf("bob", "second, revoked");
    const client = await watching("bob");
    // The first answer waits until the second change shows, then refuses.
    let refuse = () => {};
    const answered = new Promise<void>((resolve) => (refuse = resolve));
    server.use(
      http.delete(`*/api/v1/users/bob/tokens/${first.id}`, async () => {
        await answered;
        return HttpResponse.json({ error: { code: "CONFLICT", message: "the token is being rotated" } }, { status: 409 });
      }),
    );

    const one = revoke(client, "bob", first).catch((err: unknown) => err);
    const two = revoke(client, "bob", second);
    await vi.waitFor(() => expect(row(client, "bob", second.id)?.revokedAt).toBeTruthy());
    expect(row(client, "bob", first.id)?.revokedAt).toBeTruthy();

    refuse();
    await expect(one).resolves.toMatchObject({ status: 409 });
    expect(row(client, "bob", first.id)?.revokedAt).toBeNull();
    expect(row(client, "bob", second.id)?.revokedAt).toBeTruthy();
    expect(client.isMutating()).toBe(1);

    await two;
    expect(row(client, "bob", first.id)?.revokedAt).toBeNull();
    expect(row(client, "bob", second.id)?.revokedAt).toBeTruthy();
    expect(getNotices().map((n) => n.title)).toEqual(["Revoke first, refused: refused"]);
  });
});

describe("realistic", () => {
  it("shows nothing until the server answers, then the list as the server has it", async () => {
    signIn("bob");
    const client = await watching("bob");
    const before = client.getQueryData<Token[]>(list("bob"))!;

    const done = new MutationObserver(client, {
      mutationFn: (req: TokenRequest) => createUserToken("bob", req, { user: "bob", password: "bob" }),
      ...realistic(list("bob")),
    }).mutate({ name: "realistic", expiresIn: "30d" });
    await vi.waitFor(() => expect(client.isMutating()).toBe(1));
    expect(client.getQueryData(list("bob"))).toBe(before);

    const created = await done;
    expect(row(client, "bob", created.id)).toMatchObject({ name: "realistic", revokedAt: null });
  });

  it("leaves the list as it was when the server refuses", async () => {
    signIn("bob");
    const client = await watching("bob");
    const before = client.getQueryData<Token[]>(list("bob"))!;

    const done = new MutationObserver(client, {
      mutationFn: (req: TokenRequest) => createUserToken("bob", req, { user: "bob", password: "bob" }),
      ...realistic(list("bob")),
    }).mutate({ name: "", expiresIn: "30d" });
    await expect(done).rejects.toMatchObject({ status: 400 });
    expect(client.getQueryData(list("bob"))).toBe(before);
  });
});
