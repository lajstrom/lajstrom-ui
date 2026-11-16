import { describe, expect, it } from "vitest";

import { isFailedWorkerUpdate } from "./worker-update";

const script = "http://localhost:5173/ui/mockServiceWorker.js";
// What Chrome rejects update() with when the registration was unregistered in between.
const notFound = new TypeError(
  `Failed to update a ServiceWorker for scope ('http://localhost:5173/ui/') with script ('${script}'): Not found`,
);

describe("isFailedWorkerUpdate", () => {
  it("is the failed update of the mock's worker", () => {
    expect(isFailedWorkerUpdate(notFound, script)).toBe(true);
  });

  it("is not the update of another worker, or of the worker below another path", () => {
    expect(isFailedWorkerUpdate(notFound, "http://localhost:5173/mockServiceWorker.js")).toBe(false);
    expect(isFailedWorkerUpdate(notFound, "https://example.github.io/lajstrom-ui/mockServiceWorker.js")).toBe(false);
    const other = new TypeError(
      "Failed to update a ServiceWorker for scope ('http://localhost:5173/ui/') with script ('http://localhost:5173/ui/sw.js'): Not found",
    );
    expect(isFailedWorkerUpdate(other, script)).toBe(false);
  });

  it("is no other rejection", () => {
    expect(isFailedWorkerUpdate(new Error(notFound.message), script)).toBe(false);
    expect(isFailedWorkerUpdate(notFound.message, script)).toBe(false);
    expect(isFailedWorkerUpdate(new TypeError(`Failed to fetch ${script}`), script)).toBe(false);
    expect(isFailedWorkerUpdate(new TypeError(`Failed to register a ServiceWorker for scope ('http://localhost:5173/ui/') with script ('${script}'): Not found`), script)).toBe(false);
    expect(isFailedWorkerUpdate(undefined, script)).toBe(false);
  });
});
