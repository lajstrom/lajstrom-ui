import { setupWorker } from "msw/browser";

import { basePath } from "@/app/base";

import { handlers } from "./handlers";
import { restoreDemoState } from "./state";
import { isFailedWorkerUpdate } from "./worker-update";

/** Starts the service worker that answers /api/v1 with the mock data, with what the demo kept. */
export async function startMock(): Promise<void> {
  restoreDemoState();
  const url = `${basePath()}mockServiceWorker.js`;
  // MSW's update of the worker may fail when the previous page's worker unregisters itself late
  // (src/mocks/worker-update.ts). MSW does not catch that error, so this page does, for this
  // worker only; it may come after the start. Every other unhandled rejection still shows.
  const scriptUrl = new URL(url, window.location.href).href;
  window.addEventListener("unhandledrejection", (e) => {
    if (isFailedWorkerUpdate(e.reason, scriptUrl)) e.preventDefault();
  });
  const worker = setupWorker(...handlers);
  await worker.start({
    serviceWorker: { url },
    onUnhandledRequest: "bypass",
    // Every answer of the mock is logged in the console, request and response, also where no
    // service worker runs (plain http to an IP), whose requests the Network panel cannot show.
    quiet: false,
  });
}
