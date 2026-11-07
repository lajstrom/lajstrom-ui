import { describe, expect, it } from "vitest";

import { escape, escapeComponent, normalizePypi, packagePath, tagFor } from "./profile";
import { sha256Hex } from "./sha256";

describe("sha256Hex", () => {
  it("matches the FIPS 180-4 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("hashes the OCI empty config like the spec says", () => {
    // docs/spec/manifest-profile.md §1: the empty descriptor of the 2-byte blob {}.
    expect(sha256Hex("{}")).toBe("44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
  });
});

describe("escape and tagFor (manifest-profile.md §4.2, examples table)", () => {
  it.each([
    ["1:1.18.0-6ubuntu14.4", "amd64", "1_3a1.18.0-6ubuntu14.4__amd64"],
    ["2.32.3", "py3-none-any", "2.32.3__py3-none-any"],
    ["2.32.3", "sdist", "2.32.3__sdist"],
    ["1.2.0", "", "1.2.0"],
    ["1.0.0+build.7", "", "1.0.0_2bbuild.7"],
    ["2.1~rc1", "all", "2.1_7erc1__all"],
  ])("version %s variant %s → %s", (version, variant, tag) => {
    expect(tagFor(version, variant)).toBe(tag);
  });

  it("escapes underscores so the separator stays unambiguous", () => {
    expect(escape("manylinux_2_17")).toBe("manylinux_5f2_5f17");
    expect(escape("a_")).not.toContain("__");
  });

  it("never starts a tag with . or -", () => {
    expect(escape(".hidden")).toBe("_2ehidden");
    expect(escape("-x")).toBe("_2dx");
  });

  // escape_test.go: 128 characters is the limit; one more is hashed, from the unhashed tag.
  it.each([
    ["a".repeat(63), "b".repeat(63), false], // 63 + 2 + 63 = 128
    ["a".repeat(63), "b".repeat(64), true], // 129
    ["~".repeat(43), "", true], // 43 × "_7e" = 129 after escaping
  ])("tag of length limit: %#", (version, variant, hashed) => {
    const unhashed = variant ? `${escape(version)}__${escape(variant)}` : escape(version);
    expect(tagFor(version, variant)).toBe(hashed ? "_h" + sha256Hex(unhashed).slice(0, 40) : unhashed);
  });
});

describe("escapeComponent and packagePath (manifest-profile.md §4.1)", () => {
  it.each([
    ["deb", "libstdc++6", "libstdc_2b_2b6"],
    ["pypi", "Requests", "requests"],
    ["maven", "com.example:Lib-Core", "com.example/lib-core"],
    ["raw", "Docs/Readme.MD", "docs/readme.md"],
  ])("%s %s → %s", (format, name, path) => {
    expect(packagePath(format, name)).toBe(path);
  });

  // escape_test.go: names the OCI path grammar rejects, hashed from the original spelling.
  it.each(["_private", "-x", ".hidden", "Пакет", "a.-b", "a..b", "trailing.", ""])("hashes %j", (name) => {
    expect(escapeComponent(name)).toBe("h0__" + sha256Hex(name).slice(0, 32));
  });

  it("hashes the original spelling, not the lower-cased one", () => {
    expect(escapeComponent("_A")).not.toBe(escapeComponent("_a"));
  });
});

describe("normalizePypi (PEP 503)", () => {
  it.each([
    ["Requests", "requests"],
    ["zope.interface", "zope-interface"],
    ["Friendly__Bard", "friendly-bard"],
    ["acme_billing.client", "acme-billing-client"],
  ])("%s → %s", (name, normalized) => {
    expect(normalizePypi(name)).toBe(normalized);
  });
});
