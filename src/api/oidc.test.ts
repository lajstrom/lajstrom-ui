import { describe, expect, it } from "vitest";

import { oidcLoginUrl, pkceChallenge, pkceVerifier, rememberVerifier, takeOidcCallback } from "./oidc";

/** sessionStorage of one tab. */
function storage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("PKCE (RFC 7636)", () => {
  it("makes the verifier and the S256 challenge of Appendix B", async () => {
    const octets = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121];
    const verifier = pkceVerifier(new Uint8Array(octets));
    expect(verifier).toBe("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
    expect(await pkceChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("makes a new verifier of 43 allowed characters", () => {
    const a = pkceVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceVerifier()).not.toBe(a);
  });
});

describe("oidcLoginUrl", () => {
  it("names return_to, the challenge, S256 and the key's thumbprint", () => {
    const url = new URL(
      oidcLoginUrl("https://art.example.com", {
        returnTo: "https://art.example.com/ui/sign-in?redirect=/apt/ubuntu",
        challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        jkt: "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://art.example.com/-/oidc/login");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      return_to: "https://art.example.com/ui/sign-in?redirect=/apt/ubuntu",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      dpop_jkt: "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I",
    });
  });

  it("asks the IdP to authenticate the person again with prompt=login, a step-up", () => {
    const p = { returnTo: "https://art.example.com/ui/sign-in", challenge: "c".repeat(43), jkt: "j".repeat(43) };
    expect(new URL(oidcLoginUrl("https://art.example.com", { ...p, prompt: "login" })).searchParams.get("prompt")).toBe("login");
    expect(new URL(oidcLoginUrl("https://art.example.com", p)).searchParams.has("prompt")).toBe(false);
  });
});

describe("takeOidcCallback", () => {
  it("takes the code of the fragment and the verifier of the tab, once", () => {
    const tab = storage();
    rememberVerifier("v".repeat(43), tab);
    const location = { pathname: "/ui/sign-in", search: "?redirect=%2Fapt%2Fubuntu", hash: "#code=abc-123" };
    const replaced: string[] = [];
    const history = { state: null, replaceState: (_s: unknown, _t: string, url?: string | URL | null) => void replaced.push(String(url)) };

    expect(takeOidcCallback(location, history, tab)).toEqual({ code: "abc-123", verifier: "v".repeat(43) });
    // The code leaves the address, the verifier the tab.
    expect(replaced).toEqual(["/ui/sign-in?redirect=%2Fapt%2Fubuntu"]);
    expect(takeOidcCallback({ ...location, hash: "" }, history, tab)).toBeNull();
    expect(takeOidcCallback(location, history, tab)).toEqual({ code: "abc-123", verifier: null });
  });
});
