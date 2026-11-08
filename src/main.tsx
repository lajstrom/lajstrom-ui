import "./styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { signInWithPassword } from "./api/auth";
import { ApiError } from "./api/client";
import { getSession, initSession, onSessionChange } from "./api/session";
import { loadConfig } from "./app/config";
import { DEMO_SESSION, demoIsFresh, initDemo, REAL_SESSION } from "./app/demo";
import { makeRouter } from "./app/router";
import { TooltipProvider } from "./components/ui/tooltip";

async function main() {
  const cfg = await loadConfig();
  const demo = initDemo(cfg);
  initSession(demo.active ? DEMO_SESSION : REAL_SESSION);
  if (demo.active) {
    // The mock and its data are a separate chunk, loaded only in the demo.
    const fresh = demoIsFresh();
    const { startMock } = await import("./mocks/browser");
    await startMock();
    // A demo starts signed in as its admin, so that every screen is there to try; after that,
    // signing out or in as another user is the visitor's choice and is kept.
    if (fresh && !getSession()) await signInWithPassword("admin", "demo").catch(() => undefined);
  }

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // 4xx answers are final; retry network and 5xx errors once.
        retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 1,
      },
    },
  });
  // What the API answers depends on who asks: sign-in, sign-out, another tab, or a token the
  // server refused (src/api/client.ts) start every query over.
  onSessionChange(() => void queryClient.resetQueries());
  const router = makeRouter(queryClient);

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void main();
