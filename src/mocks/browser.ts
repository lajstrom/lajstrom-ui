import { setupWorker } from "msw/browser";

import { handlers } from "./handlers";
import { restoreDemoState } from "./state";

/** Starts the service worker that answers /api/v1 with the mock data, with what the demo kept. */
export async function startMock(): Promise<void> {
  restoreDemoState();
  const worker = setupWorker(...handlers);
  await worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledRequest: "bypass",
    // Every answer of the mock is logged in the console, request and response, also where no
    // service worker runs (plain http to an IP), whose requests the Network panel cannot show.
    quiet: false,
  });
}
