import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";

import { NotFound } from "@/pages/not-found";
import { SignInPage } from "@/pages/sign-in";

import { basePath } from "./base";
import { PagePending } from "./page-pending";
import { AppShell } from "./shell";

type Ctx = { queryClient: QueryClient };

// Every page is a chunk of its own, loaded when its route is entered or a link to it is pointed
// at (defaultPreload); src/main.tsx loads the first one with the start-up. The shell, the router
// and the sign-in page stay in the main chunk: a signed-out demo sends every address to sign-in
// at once (src/app/shell.tsx), and a chunk to wait for there would show the page it leaves.
const ReposPage = lazyRouteComponent(() => import("@/pages/repos"), "ReposPage");
const SearchPage = lazyRouteComponent(() => import("@/pages/search"), "SearchPage");
const RegistriesPage = lazyRouteComponent(() => import("@/pages/registries"), "RegistriesPage");
const AuditPage = lazyRouteComponent(() => import("@/pages/audit"), "AuditPage");
const AccessPage = lazyRouteComponent(() => import("@/pages/access"), "AccessPage");
const UserPage = lazyRouteComponent(() => import("@/pages/user"), "UserPage");
const WebhooksPage = lazyRouteComponent(() => import("@/pages/webhooks"), "WebhooksPage");
const FirstAdminPage = lazyRouteComponent(() => import("@/pages/first-admin"), "FirstAdminPage");
const TokensPage = lazyRouteComponent(() => import("@/pages/tokens"), "TokensPage");
const ApiDocsPage = lazyRouteComponent(() => import("@/pages/api-docs"), "ApiDocsPage");
const RepoPage = lazyRouteComponent(() => import("@/pages/repo"), "RepoPage");
const PackageRoute = lazyRouteComponent(() => import("@/pages/package"), "PackageRoute");

/** Keeps only string values: every UI state lives in plain, shareable query parameters. */
const strings = (s: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string>;

const rootRoute = createRootRouteWithContext<Ctx>()({ component: AppShell, notFoundComponent: NotFound });

// A splat also matches an empty rest, so /$format/$repo/$ next to /$format/$repo would swallow
// the repo page. Nesting both under one layout lets the index route win the exact path.
const repoLayout = createRoute({ getParentRoute: () => rootRoute, path: "/$format/$repo" });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: ReposPage, validateSearch: strings }),
  createRoute({ getParentRoute: () => rootRoute, path: "/search", component: SearchPage, validateSearch: strings }),
  createRoute({ getParentRoute: () => rootRoute, path: "/registries", component: RegistriesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/audit", component: AuditPage, validateSearch: strings }),
  createRoute({ getParentRoute: () => rootRoute, path: "/access", component: AccessPage, validateSearch: strings }),
  createRoute({ getParentRoute: () => rootRoute, path: "/access/users/$user", component: UserPage, validateSearch: strings }),
  createRoute({ getParentRoute: () => rootRoute, path: "/webhooks", component: WebhooksPage, validateSearch: strings }),
  createRoute({ getParentRoute: () => rootRoute, path: "/sign-in", component: SignInPage, validateSearch: strings }),
  createRoute({ getParentRoute: () => rootRoute, path: "/first-admin", component: FirstAdminPage, validateSearch: strings }),
  createRoute({ getParentRoute: () => rootRoute, path: "/tokens", component: TokensPage, validateSearch: strings }),
  createRoute({ getParentRoute: () => rootRoute, path: "/api-docs", component: ApiDocsPage }),
  repoLayout.addChildren([
    createRoute({ getParentRoute: () => repoLayout, path: "/", component: RepoPage, validateSearch: strings }),
    createRoute({ getParentRoute: () => repoLayout, path: "$", component: PackageRoute, validateSearch: strings }),
  ]),
]);

export function makeRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    basepath: basePath().replace(/\/$/, ""),
    context: { queryClient },
    defaultPreload: "intent",
    // Going to another page keeps the one shown until the next one's chunk is there; only a load
    // longer than a second shows PagePending, and then for half a second at least, not a flash.
    defaultPendingComponent: PagePending,
    defaultPendingMs: 1000,
    defaultPendingMinMs: 500,
    scrollRestoration: true,
    // Plain query strings (?q=nginx&suite=jammy) instead of JSON-encoded values.
    parseSearch: (s) => Object.fromEntries(new URLSearchParams(s)),
    stringifySearch: (o) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
      const s = p.toString();
      return s ? `?${s}` : "";
    },
  });
}
