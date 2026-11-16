// A failed update of the mock's service worker, which MSW leaves uncaught (lajstrom/lajstrom-ui#55).
//
// The worker unregisters itself when the last page it serves closes, a reload included: MSW's
// beforeunload sends it CLIENT_CLOSED (mockServiceWorker.js). The next page registers it again.
// When the next page is quicker, MSW finds the registration not yet gone and calls
// existingRegistration.update() without waiting for it or catching its error (getWorkerInstance,
// https://github.com/mswjs/msw/blob/v2.15.0/src/browser/utils/get-worker-instance.ts; the same
// in msw 3.0.6). The unregister then lands first, and the update rejects with
//
//   TypeError: Failed to update a ServiceWorker for scope ('…/ui/') with script
//   ('…/ui/mockServiceWorker.js'): Not found
//
// in the console, rarely: once in about 700 reloads of the dev server. Nothing is lost: the page
// keeps the worker that controls it, and the next load registers it again.

/** Whether an unhandled rejection is MSW's update of the worker at scriptUrl (absolute) failing. */
export function isFailedWorkerUpdate(reason: unknown, scriptUrl: string): boolean {
  return (
    reason instanceof TypeError &&
    reason.message.startsWith("Failed to update a ServiceWorker") &&
    reason.message.includes(`with script ('${scriptUrl}')`)
  );
}
