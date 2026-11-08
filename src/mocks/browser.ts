import { setupWorker } from "msw/browser";

import { restoreDemoState } from "./auth";
import { handlers } from "./handlers";

/** Starts the service worker that answers /api/v1 with the mock data, with what the demo kept. */
export async function startMock(): Promise<void> {
  restoreDemoState();
  const worker = setupWorker(...handlers);
  await worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledRequest: "bypass",
    quiet: true,
  });
}
