import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, createRoute, createRouter } from "@tanstack/react-router";

import { AccessPage } from "@/pages/access";
import { AuditPage } from "@/pages/audit";
import { NotFound } from "@/pages/not-found";
import { PackageRoute } from "@/pages/package";
import { RegistriesPage } from "@/pages/registries";
import { RepoPage } from "@/pages/repo";
import { ReposPage } from "@/pages/repos";
import { SearchPage } from "@/pages/search";
import { SignInPage } from "@/pages/sign-in";
import { TokensPage } from "@/pages/tokens";

import { AppShell } from "./shell";

type Ctx = { queryClient: QueryClient };


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
  createRoute({ getParentRoute: () => rootRoute, path: "/sign-in", component: SignInPage, validateSearch: strings }),
  createRoute({ getParentRoute: () => rootRoute, path: "/tokens", component: TokensPage, validateSearch: strings }),
  repoLayout.addChildren([
    createRoute({ getParentRoute: () => repoLayout, path: "/", component: RepoPage, validateSearch: strings }),
    createRoute({ getParentRoute: () => repoLayout, path: "$", component: PackageRoute, validateSearch: strings }),
  ]),
]);

export function makeRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    basepath: import.meta.env.BASE_URL.replace(/\/$/, ""),
    context: { queryClient },
    defaultPreload: "intent",
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
