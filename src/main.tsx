import "./styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ApiError } from "./api/client";
import { initSession, onSessionChange } from "./api/session";
import { applyBranding } from "./app/branding";
import { configUrl, loadConfig } from "./app/config";
import { DEMO_SESSION, initDemo, REAL_SESSION } from "./app/demo";
import { makeRouter } from "./app/router";
import { probeServer, setServer, versionUrl } from "./app/startup";
import { ConfigError, ServerError, Starting } from "./app/startup-pages";
import { TooltipProvider } from "./components/ui/tooltip";

async function main() {
  // The start-up never leaves the page blank: it says what it waits for, and a configuration or
  // a server it cannot use gets a page that names the problem (src/app/startup.ts).
  const root = createRoot(document.getElementById("root")!);
  root.render(<Starting />);
  const loaded = await loadConfig();
  if (!loaded.ok) {
    root.render(<ConfigError problem={loaded.problem} url={configUrl().href} />);
    return;
  }
  for (const warning of loaded.warnings) console.warn(warning);
  const cfg = loaded.config;
  applyBranding(cfg.branding);

  const demo = initDemo(cfg);
  initSession(demo.active ? DEMO_SESSION : REAL_SESSION);
  if (demo.active) {
    // The mock and its data are a separate chunk, loaded only in the demo.
    const { startMock } = await import("./mocks/browser");
    await startMock();
  } else {
    root.render(<Starting url={versionUrl(cfg.apiBaseUrl)} />);
    const probe = await probeServer(cfg.apiBaseUrl);
    if (!probe.ok) {
      root.render(<ServerError probe={probe} demoOffered={demo.offered} />);
      return;
    }
    setServer(probe.server);
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
  // A change in flight, which an optimistic screen already shows as done, is lost with the page:
  // the browser asks before leaving (docs/adr/0003-changes-realistic-by-default.md).
  window.addEventListener("beforeunload", (e) => {
    if (queryClient.isMutating() > 0) e.preventDefault();
  });
  const router = makeRouter(queryClient);

  root.render(
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
