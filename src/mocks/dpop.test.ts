// The mock's check of DPoP proofs (src/mocks/dpop.ts): the example of RFC 9449, the client's own
// proofs, and each refusal, so that a client that gets a proof wrong fails in the demo.

import { describe, expect, it } from "vitest";

import { base64url, createProof, generateKeyPair, publicJwk } from "@/api/dpop";

import { spendProof, thumbprint, verifyProof } from "./dpop";

const URL_ = "https://art.example.com/api/v1/repos/apt/ubuntu";
const TOKEN = "ljs_pat_0123456789abcdef";

const withProof = (proof: string, method = "GET", url = `${URL_}?limit=5`) => new Request(url, { method, headers: { DPoP: proof } });

/** A proof with its header and claims as given, signed with key. */
async function signed(key: CryptoKeyPair, header: object, claims: object): Promise<string> {
  const enc = (v: object) => base64url(new TextEncoder().encode(JSON.stringify(v)));
  const input = `${enc(header)}.${enc(claims)}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, new TextEncoder().encode(input));
  return `${input}.${base64url(sig)}`;
}

describe("verifyProof", () => {
  it("takes the proof of RFC 9449 Figure 13 at its time, with the jkt of Figure 9", async () => {
    const proof =
      "eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7Imt0eSI6IkVDIiwieCI6Imw4dEZyaHgtMzR0VjNoUklDUkRZOXpDa0R" +
      "scEJoRjQyVVFVZldWQVdCRnMiLCJ5IjoiOVZFNGpmX09rX282NHpiVFRsY3VOSmFqSG10NnY5VERWclUwQ2R2R1JEQSIsImNydiI6IlAtMjU2In19.eyJ" +
      "qdGkiOiJlMWozVl9iS2ljOC1MQUVCIiwiaHRtIjoiR0VUIiwiaHR1IjoiaHR0cHM6Ly9yZXNvdXJjZS5leGFtcGxlLm9yZy9wcm90ZWN0ZWRyZXNvd" +
      "XJjZSIsImlhdCI6MTU2MjI2MjYxOCwiYXRoIjoiZlVIeU8ycjJaM0RaNTNFc05yV0JiMHhXWG9hTnk1OUlpS0NBcWtzbVFFbyJ9.2oW9RP35yRqzhrt" +
      "NP86L-Ey71EOptxRimPPToA1plemAgR6pxHF8y6-yqyVnmcw6Fy1dqd-jfxSYoMxhAJpLjA";
    const req = withProof(proof, "GET", "https://resource.example.org/protectedresource");
    expect(await verifyProof(req, "Kz~8mXK1EalYznwH-LC-1fBAo.4Ljp~zsPE_NeO.gxU", 1562262618_000)).toEqual({
      jkt: "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I",
      jti: "e1j3V_bKic8-LAEB",
      iat: 1562262618,
    });
    // Ten minutes later, and with another token, it is refused.
    expect(await verifyProof(req, "Kz~8mXK1EalYznwH-LC-1fBAo.4Ljp~zsPE_NeO.gxU", 1562263218_000)).toEqual({
      why: "the proof's iat is not within 5 minutes of the server's clock",
    });
    expect(await verifyProof(req, "another", 1562262618_000)).toEqual({ why: "the proof's ath is not the hash of the token" });
  });

  it("takes the client's proof, and gives its key's thumbprint", async () => {
    const key = await generateKeyPair();
    const jwk = await publicJwk(key.publicKey);
    const proof = await createProof(key, { method: "GET", url: `${URL_}?limit=5`, token: TOKEN });
    expect(await verifyProof(withProof(proof), TOKEN)).toEqual({ jkt: await thumbprint(jwk.x, jwk.y), jti: expect.any(String), iat: expect.any(Number) });
    // A sign-in's proof has no ath, and needs none.
    const login = await createProof(key, { method: "POST", url: "https://art.example.com/api/v1/login" });
    expect(await verifyProof(withProof(login, "POST", "https://art.example.com/api/v1/login"), null)).toHaveProperty("jkt");
  });

  it("refuses a proof that does not hold for its request", async () => {
    const key = await generateKeyPair();
    const proof = (method: string, url: string, token?: string) => createProof(key, { method, url, token });
    const why = async (req: Request, token: string | null = TOKEN) => ((await verifyProof(req, token)) as { why?: string }).why;

    expect(await why(new Request(URL_))).toBe("the request has no DPoP header");
    expect(await why(withProof(await proof("POST", URL_, TOKEN)))).toBe("the proof's htm is not the method of the request");
    expect(await why(withProof(await proof("GET", "https://art.example.com/api/v1/repos", TOKEN)))).toBe("the proof's htu is not the URI of the request");
    expect(await why(withProof(await proof("GET", "http://art.example.com/api/v1/repos/apt/ubuntu", TOKEN)))).toBe(
      "the proof's htu is not the URI of the request",
    );
    expect(await why(withProof(await proof("GET", URL_)))).toBe("the proof's ath is not the hash of the token");
    expect(await why(withProof(await proof("GET", URL_, "ljs_pat_other")))).toBe("the proof's ath is not the hash of the token");
    expect(await why(withProof("not.a.jwt"))).toBe("the proof is not a JWT");
    const two = new Request(URL_, { headers: [["DPoP", await proof("GET", URL_, TOKEN)], ["DPoP", await proof("GET", URL_, TOKEN)]] });
    expect(await why(two)).toBe("the request has more than one DPoP header");
  });

  it("refuses a proof whose header or claims are not a proof's", async () => {
    const key = await generateKeyPair();
    const jwk = await publicJwk(key.publicKey);
    const ath = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN)));
    const claims = { jti: "j1", htm: "GET", htu: URL_, iat: Math.floor(Date.now() / 1000), ath };
    const header = { typ: "dpop+jwt", alg: "ES256", jwk };
    const why = async (h: object, c: object) => ((await verifyProof(withProof(await signed(key, h, c)), TOKEN)) as { why?: string }).why;

    expect(await why(header, claims)).toBeUndefined();
    expect(await why({ ...header, typ: "JWT" }, claims)).toBe("the proof's typ is not dpop+jwt");
    expect(await why({ ...header, alg: "RS256" }, claims)).toBe("the proof's alg is not ES256");
    expect(await why({ typ: "dpop+jwt", alg: "ES256" }, claims)).toBe("the proof's header has no jwk");
    expect(await why({ ...header, jwk: { ...jwk, d: "secret" } }, claims)).toBe("the proof's jwk holds a private key");
    expect(await why({ ...header, jwk: { ...jwk, crv: "P-384" } }, claims)).toBe("the proof's jwk is not a P-256 key");
    expect(await why({ ...header, jwk: { ...jwk, x: "AAAA" } }, claims)).toBe("the proof's jwk has no x and y of 32 bytes");
    const other = await publicJwk((await generateKeyPair()).publicKey);
    expect(await why({ ...header, jwk: other }, claims)).toBe("the proof's signature does not verify with its jwk");
    const { jti: _jti, ...noJti } = claims;
    expect(await why(header, noJti)).toBe("the proof lacks one of jti, htm, htu and iat");
    expect(await why(header, { ...claims, iat: String(claims.iat) })).toBe("the proof lacks one of jti, htm, htu and iat");
    expect(await why(header, { ...claims, iat: claims.iat - 301 })).toBe("the proof's iat is not within 5 minutes of the server's clock");
    expect(await why(header, { ...claims, iat: claims.iat + 301 })).toBe("the proof's iat is not within 5 minutes of the server's clock");
    expect(await why(header, { ...claims, htu: `${URL_}?limit=5` })).toBe("the proof's htu has a query or a fragment");
    expect(await why(header, { ...claims, jti: "x".repeat(257) })).toBe("the proof's jti is longer than 256 bytes");
  });
});

describe("spendProof", () => {
  it("takes a jti of a key once", () => {
    const p = { jkt: "k1", jti: "once", iat: Math.floor(Date.now() / 1000) };
    expect(spendProof(p)).toBeNull();
    expect(spendProof(p)).toBe("the proof was used already");
    expect(spendProof({ ...p, jkt: "k2" })).toBeNull();
  });
});
