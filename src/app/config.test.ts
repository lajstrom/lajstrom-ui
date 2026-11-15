import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultConfig, loadConfig, parseConfig } from "./config";

const ok = (text: string) => {
  const r = parseConfig(text);
  if (!r.ok) throw new Error(r.problem);
  return r;
};
const problem = (text: string) => {
  const r = parseConfig(text);
  if (r.ok) throw new Error("parsed");
  return r.problem;
};

describe("parseConfig", () => {
  it("fills what the file leaves out with the defaults", () => {
    expect(ok('{"schema": 1}').config).toEqual(defaultConfig);
    expect(ok('{"schema": 1, "mock": true, "branding": {"title": "Acme Artifacts"}}').config).toEqual({
      ...defaultConfig,
      mock: true,
      branding: { ...defaultConfig.branding, title: "Acme Artifacts" },
    });
  });

  it("reads every setting of schema 1", () => {
    const file = {
      schema: 1,
      apiBaseUrl: "https://art.example.com/",
      mock: false,
      demo: false,
      branding: {
        title: "Acme",
        logo: "branding/logo.svg",
        colors: { primary: "#c2410c", primaryDark: "#FB923C" },
        supportUrl: "mailto:platform@example.com",
      },
    };
    expect(ok(JSON.stringify(file))).toEqual({
      ok: true,
      warnings: [],
      config: { ...file, apiBaseUrl: "https://art.example.com" },
    });
  });

  it("names a file that is not JSON, or not an object", () => {
    expect(problem('{"schema": 1,}')).toMatch(/^config.json is not valid JSON: /);
    expect(problem("[1]")).toMatch(/must hold a JSON object/);
    expect(problem("null")).toMatch(/must hold a JSON object/);
  });

  it("names a missing or unknown schema", () => {
    expect(problem('{"apiBaseUrl": "", "mock": true, "title": "Lajstrom"}')).toBe('config.json has no "schema"; this UI reads "schema": 1');
    expect(problem('{"schema": 2}')).toBe('config.json has "schema": 2; this UI reads "schema": 1 only');
    expect(problem('{"schema": "1"}')).toBe('config.json has "schema": "1"; this UI reads "schema": 1 only');
  });

  it("names the setting with a value of the wrong kind", () => {
    expect(problem('{"schema": 1, "mock": "true"}')).toBe('config.json: "mock" must be true or false, not "true"');
    expect(problem('{"schema": 1, "apiBaseUrl": "art.example.com"}')).toBe('config.json: "apiBaseUrl" must be an http(s) URL, not "art.example.com"');
    expect(problem('{"schema": 1, "branding": "Acme"}')).toBe('config.json: "branding" must be an object, not "Acme"');
    expect(problem('{"schema": 1, "branding": {"colors": {"primary": "red"}}}')).toMatch(/"branding.colors.primary" must be a colour/);
    expect(problem('{"schema": 1, "branding": {"supportUrl": "javascript:alert(1)"}}')).toMatch(/"branding.supportUrl" must be an http\(s\) or mailto: URL/);
    expect(problem('{"schema": 1, "branding": {"logo": "javascript:alert(1)"}}')).toMatch(/"branding.logo" must be a path relative/);
    expect(problem('{"schema": 1, "branding": {"logo": "//cdn.example.com/logo.svg"}}')).toMatch(/"branding.logo"/);
  });

  it("takes the logo relative to the bundle, over http(s) or as a data:image URL", () => {
    for (const logo of ["logo.svg", "branding/logo.png", "/static/logo.svg", "https://cdn.example.com/logo.svg", "data:image/svg+xml;base64,PHN2Zy8+"]) {
      expect(ok(JSON.stringify({ schema: 1, branding: { logo } })).config.branding.logo).toBe(logo);
    }
  });

  it("warns about settings that schema 1 does not have, and goes on", () => {
    expect(ok('{"schema": 1, "title": "Old", "branding": {"titel": "x"}}').warnings).toEqual([
      "config.json: title is not a setting of schema 1; it is ignored",
      "config.json: branding.titel is not a setting of schema 1; it is ignored",
    ]);
  });
});

describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const answer = (status: number, body: string, type = "application/json") => {
    vi.stubGlobal("window", { location: { href: "http://localhost/ui/" } });
    vi.stubGlobal("fetch", async () => new Response(body, { status, headers: { "Content-Type": type } }));
  };

  it("takes the defaults when there is no config.json", async () => {
    answer(404, "Not Found", "text/plain");
    expect(await loadConfig()).toEqual({ ok: true, config: defaultConfig, warnings: [] });
  });

  it("takes the defaults for the index.html a static host answers instead", async () => {
    answer(200, "<!doctype html><html></html>", "text/html");
    expect(await loadConfig()).toEqual({ ok: true, config: defaultConfig, warnings: [] });
  });

  it("names any other answer", async () => {
    answer(500, "oops", "text/plain");
    expect(await loadConfig()).toMatchObject({ ok: false, problem: expect.stringMatching(/the answer was 500/) });
    answer(200, '{"schema": 3}');
    expect(await loadConfig()).toMatchObject({ ok: false, problem: expect.stringMatching(/"schema": 3/) });
  });
});
