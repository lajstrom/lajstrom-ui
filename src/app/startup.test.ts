import { afterEach, describe, expect, it, vi } from "vitest";

import { probeServer } from "./startup";

afterEach(() => {
  vi.unstubAllGlobals();
});

function serve(answer: () => Response | Promise<Response>) {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal("window", { location: { origin: "https://art.example.com" } });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return answer();
  });
  return seen;
}

describe("probeServer", () => {
  it("asks /-/version of the same origin, without credentials, and reads the build", async () => {
    const seen = serve(() => Response.json({ version: "v0.1.0", commit: "abc1234", date: "2026-11-15T10:00:00Z" }));
    expect(await probeServer("")).toEqual({ ok: true, server: { version: "v0.1.0", commit: "abc1234", date: "2026-11-15T10:00:00Z" } });
    expect(seen[0]?.url).toBe("https://art.example.com/-/version");
    expect(seen[0]?.init?.credentials).toBe("omit");
  });

  it("asks the API's origin when config.json names one", async () => {
    const seen = serve(() => Response.json({ version: "dev", commit: "", date: "" }));
    await probeServer("https://lajstrom.example.com");
    expect(seen[0]?.url).toBe("https://lajstrom.example.com/-/version");
  });

  it("names the status of an answer that is not 2xx", async () => {
    serve(() => new Response("bad gateway", { status: 502, statusText: "Bad Gateway" }));
    expect(await probeServer("")).toEqual({ ok: false, url: "https://art.example.com/-/version", status: "502 Bad Gateway" });
  });

  it("says when the answer is not Lajstrom's, such as a static host's index.html", async () => {
    serve(() => new Response("<!doctype html>", { status: 200, statusText: "OK", headers: { "Content-Type": "text/html" } }));
    expect(await probeServer("")).toMatchObject({ ok: false, status: "200 OK, but text/html, not the JSON of Lajstrom's /-/version" });
  });

  it("says when nothing answers", async () => {
    serve(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await probeServer("")).toMatchObject({ ok: false, status: expect.stringMatching(/^no answer: /) });
    serve(() => Promise.reject(new DOMException("timed out", "TimeoutError")));
    expect(await probeServer("", 5000)).toMatchObject({ ok: false, status: "no answer within 5 seconds" });
  });
});
