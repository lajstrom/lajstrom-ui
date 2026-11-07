import "./styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ApiError } from "./api/client";
import { loadConfig } from "./app/config";
import { makeRouter } from "./app/router";
import { TooltipProvider } from "./components/ui/tooltip";

async function main() {
  const cfg = await loadConfig();
  if (cfg.mock) {
    // The mock and its data are a separate chunk, loaded only when config.json asks for it.
    const { startMock } = await import("./mocks/browser");
    await startMock();
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
