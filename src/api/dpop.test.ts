import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256Hex } from "@/lib/sha256";

import {
  base64url,
  clockSkew,
  createProof,
  dpopChallenge,
  generateKeyPair,
  htuOf,
  jwkThumbprint,
  learnServerClock,
  publicJwk,
  refusedForIat,
  serverNow,
  tokenHash,
} from "./dpop";

/** base64url decoded with atob, independently of the code under test. */
const bytes = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The parts of a JWS. */
function parts(jws: string) {
  const [h, p, s] = jws.split(".");
  const json = (part: string) => JSON.parse(new TextDecoder().decode(bytes(part))) as Record<string, unknown>;
  return { header: json(h!), claims: json(p!), signature: bytes(s!), input: `${h}.${p}` };
}

afterEach(() => {
  learnServerClock(new Date().toUTCString());
});

describe("base64url", () => {
  it("writes RFC 4648 §5 without padding", () => {
    expect(base64url(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe("-_-_");
    expect(base64url(new Uint8Array([0x66, 0x6f]))).toBe("Zm8");
    expect(base64url(new Uint8Array([]))).toBe("");
  });
});

describe("the key", () => {
  it("is a P-256 key whose private part cannot be exported", async () => {
    const key = await generateKeyPair();
    expect(key.privateKey.extractable).toBe(false);
    expect(key.privateKey.algorithm).toMatchObject({ name: "ECDSA", namedCurve: "P-256" });
    await expect(crypto.subtle.exportKey("jwk", key.privateKey)).rejects.toThrow();
    const jwk = await publicJwk(key.publicKey);
    expect(Object.keys(jwk).sort()).toEqual(["crv", "kty", "x", "y"]);
    expect(jwk).toMatchObject({ kty: "EC", crv: "P-256" });
    expect(bytes(jwk.x)).toHaveLength(32);
    expect(bytes(jwk.y)).toHaveLength(32);
  });
});

describe("jwkThumbprint (RFC 7638)", () => {
  it("is the thumbprint of RFC 9449's example key, its Figure 9 jkt", async () => {
    const jwk = { kty: "EC", crv: "P-256", x: "l8tFrhx-34tV3hRICRDY9zCkDlpBhF42UQUfWVAWBFs", y: "9VE4jf_Ok_o64zbTTlcuNJajHmt6v9TDVrU0CdvGRDA" } as const;
    expect(await jwkThumbprint(jwk)).toBe("0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I");
  });

  it("is the SHA-256 of the canonical JSON of crv, kty, x and y (§3.1)", async () => {
    const jwk = await publicJwk((await generateKeyPair()).publicKey);
    const canonical = `{"crv":"P-256","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`;
    // The SHA-256 of src/lib/sha256.ts, not WebCrypto's.
    expect(hex(bytes(await jwkThumbprint(jwk)))).toBe(sha256Hex(canonical));
  });
});

describe("tokenHash", () => {
  it("is the ath of RFC 9449 Figure 14 for its token", async () => {
    expect(await tokenHash("Kz~8mXK1EalYznwH-LC-1fBAo.4Ljp~zsPE_NeO.gxU")).toBe("fUHyO2r2Z3DZ53EsNrWBb0xWXoaNy59IiKCAqksmQEo");
  });
});

describe("htuOf", () => {
  it("drops the query and the fragment, keeps the path as sent", () => {
    expect(htuOf("https://art.example.com/api/v1/repos?format=apt#x")).toBe("https://art.example.com/api/v1/repos");
    expect(htuOf("https://ART.example.com:443/api/v1/repos/raw/a%2Fb")).toBe("https://art.example.com/api/v1/repos/raw/a%2Fb");
    expect(htuOf("http://localhost:5173/api/v1/login")).toBe("http://localhost:5173/api/v1/login");
  });
});

describe("createProof (RFC 9449 §4.2)", () => {
  it("has the header and claims of a proof, and a signature of its key", async () => {
    const key = await generateKeyPair();
    const now = Date.parse("2026-11-16T10:00:00.900Z");
    const proof = await createProof(key, { method: "GET", url: "https://art.example.com/api/v1/repos?format=apt", token: "ljs_pat_x", now });
    const { header, claims, signature, input } = parts(proof);
    expect(header).toEqual({ typ: "dpop+jwt", alg: "ES256", jwk: await publicJwk(key.publicKey) });
    expect(claims).toEqual({
      jti: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
      htm: "GET",
      htu: "https://art.example.com/api/v1/repos",
      iat: Date.parse("2026-11-16T10:00:00Z") / 1000,
      ath: await tokenHash("ljs_pat_x"),
    });
    expect(signature).toHaveLength(64);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key.publicKey, signature, new TextEncoder().encode(input));
    expect(ok).toBe(true);
  });

  it("has no ath without a token, and a new jti every time", async () => {
    const key = await generateKeyPair();
    const a = parts(await createProof(key, { method: "POST", url: "https://art.example.com/api/v1/login" }));
    const b = parts(await createProof(key, { method: "POST", url: "https://art.example.com/api/v1/login" }));
    expect(a.claims).not.toHaveProperty("ath");
    expect(a.claims.htm).toBe("POST");
    expect(a.claims.jti).not.toBe(b.claims.jti);
  });

  it("signs iat by the server's clock once an answer said it", async () => {
    const key = await generateKeyPair();
    const now = Date.parse("2026-11-16T10:00:00Z");
    expect(learnServerClock("Mon, 16 Nov 2026 10:10:00 GMT", now)).toBe(true);
    expect(serverNow(now)).toBe(now + 600_000);
    const { claims } = parts(await createProof(key, { method: "GET", url: "https://h/api/v1/info", now }));
    expect(claims.iat).toBe(now / 1000 + 600);
  });
});

describe("learnServerClock", () => {
  it("keeps the offset for the next page, and forgets one of less than a second", () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
    vi.stubGlobal("localStorage", storage);
    try {
      const now = Date.parse("2026-11-16T10:00:00Z");
      learnServerClock("Mon, 16 Nov 2026 11:00:00 GMT", now);
      expect(kept.get("lajstrom.serverClock")).toBe("3600000");
      expect(clockSkew()).toBe(3_600_000);
      learnServerClock("Mon, 16 Nov 2026 10:00:00 GMT", now + 400);
      expect(kept.has("lajstrom.serverClock")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("moves the clock by the Date of an answer, and says whether it moved", () => {
    const now = Date.parse("2026-11-16T10:00:00Z");
    expect(learnServerClock("Mon, 16 Nov 2026 09:50:00 GMT", now)).toBe(true);
    expect(serverNow(now)).toBe(now - 600_000);
    // The same time again: signing again would be refused again.
    expect(learnServerClock("Mon, 16 Nov 2026 09:50:00 GMT", now + 300)).toBe(false);
    expect(learnServerClock(null, now)).toBe(false);
    expect(learnServerClock("yesterday", now)).toBe(false);
    expect(serverNow(now)).toBe(now - 600_300);
  });
});

describe("refusedForIat", () => {
  const iat = "the proof's iat is not within 5 minutes of the server's clock";

  it("is true for the 401 of a request whose proof was refused for iat", () => {
    const challenge = `DPoP error="invalid_dpop_proof", error_description="${iat}", algs="ES256"`;
    expect(refusedForIat(401, challenge, iat)).toBe(true);
    expect(dpopChallenge(challenge)).toEqual({ error: "invalid_dpop_proof", description: iat });
  });

  it("is true for the 400 of a sign-in whose proof was refused for iat", () => {
    expect(refusedForIat(400, null, `DPoP: ${iat}`)).toBe(true);
  });

  it("is false for any other refusal", () => {
    const htu = "the proof's htu is not the URI of the request";
    expect(refusedForIat(401, `DPoP error="invalid_dpop_proof", error_description="${htu}", algs="ES256"`, htu)).toBe(false);
    expect(refusedForIat(401, 'DPoP error="invalid_token", algs="ES256"', "credentials are needed")).toBe(false);
    expect(refusedForIat(401, 'Basic realm="lajstrom"', iat)).toBe(false);
    expect(refusedForIat(400, null, "body: iat is not a field")).toBe(false);
    expect(refusedForIat(403, null, `DPoP: ${iat}`)).toBe(false);
    expect(dpopChallenge('Basic realm="lajstrom"')).toBeNull();
  });
});
