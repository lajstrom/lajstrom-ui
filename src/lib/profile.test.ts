import { describe, expect, it } from "vitest";

import { escape, escapeComponent, escapeComponentMax, joinPackagePath, normalizePypi, packagePath, tagFor } from "./profile";
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
    ["2.12-1.el9", "x86_64", "2.12-1.el9__x86_5f64"],
    ["1:2.12-1.el9", "src", "1_3a2.12-1.el9__src"],
    ["2.0.0-rc.1", "", "2.0.0-rc.1"],
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

/** The hash fallback of §4.3 step 3: "h0_h" and 32 hex digits of the sha256 of the original name. */
const hashed = (s: string) => "h0_h" + sha256Hex(s).slice(0, 32);

describe("escapeComponent and packagePath (manifest-profile.md §4.1)", () => {
  it.each([
    ["deb", "libstdc++6", "libstdc_2b_2b6"],
    ["pypi", "Requests", "requests"],
    ["maven", "com.example:Lib-Core", "com.example/lib-core"],
    ["raw", "Docs/Readme.MD", "docs/readme.md"],
    // npm/name_test.go, TestPackagePathAndFilename: a scope is a component of its own.
    ["npm", "lodash", "lodash"],
    ["npm", "@acme/widgets", "acme/widgets"],
    ["npm", "@types/node", "types/node"],
    ["npm", "JSONStream", "jsonstream"],
    // §4.1 and rpm/ingest_test.go: EscapeComponent of the header's NAME.
    ["rpm", "libstdc++", "libstdc_2b_2b"],
    ["rpm", "NetworkManager", "networkmanager"],
    // path_test.go, TestPackagePath: the examples of the amendment, as the plugins escape them.
    ["raw", "k8s/manifests/app.yaml", "k8s/manifest_73/app.yaml"],
    ["raw", "x/referrers/y", "x/referrer_73/y"],
    ["raw", "x/tags/list", "x/tag_73/list"],
    ["raw", "X/Tags/Listing.TXT", "x/tag_73/listing.txt"],
    ["raw", "k8s/manifest/app.yaml", "k8s/manifest/app.yaml"],
    ["npm", "@tags/listing", "tag_73/listing"],
  ])("%s %s → %s", (format, name, path) => {
    expect(packagePath(format, name)).toBe(path);
  });

  // escape_test.go, TestEscapeComponent (ADR 0017 and its amendment).
  it.each([
    ["Docs", "docs"],
    ["Readme.MD", "readme.md"],
    ["Requests", "requests"],
    ["libstdc++6", "libstdc_2b_2b6"],
    ["Lib-Core", "lib-core"],
    ["com.example", "com.example"],
    ["a_b", "a_5fb"],
    ["h0__abc", "h0_5f_5fabc"],
    // Step 4: a run of dashes.
    ["a--b", "a_2d_2db"],
    ["A---B-c", "a_2d_2d_2db-c"],
    ["x-y--z", "x-y_2d_2dz"],
    // Step 5: the reserved words.
    ["blobs", "blob_73"],
    ["Blobs", "blob_73"],
    ["myblobs", "myblob_73"],
    ["netlify-blobs", "netlify-blob_73"],
    ["a--blobs", "a_2d_2dblob_73"],
    ["my.uploads", "my.upload_73"],
    ["x.sync", "x.syn_63"],
    ["index.json", "index.jso_6e"],
    ["oci-layout", "oci-layou_74"],
    // The amendment: Harbor's route words.
    ["manifests", "manifest_73"],
    ["Referrers", "referrer_73"],
    ["manifest", "manifest"],
    ["manifests.yaml", "manifests.yaml"],
    ["k8s-manifests", "k8s-manifests"],
    ["tags", "tags"],
    ["list", "list"],
    // Not reserved.
    ["blob", "blob"],
    ["blobsx", "blobsx"],
    ["uploads", "uploads"],
    ["sync", "sync"],
    ["x_2esync", "x_5f2esync"],
    ["index.jsonl", "index.jsonl"],
    ["sha256", "sha256"],
  ])("%s → %s", (name, component) => {
    expect(escapeComponent(name)).toBe(component);
    // The 1.0 grammar of ADR 0017, and no reserved word.
    expect(component).toMatch(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
  });

  // escape_test.go: names the OCI path grammar rejects, hashed from the original spelling.
  it.each(["_private", "_config.yml", ".gitignore", "-x", "Пакет", "a.-b", "a..b", "a--.b", "trailing.", ".uploads", ""])("hashes %j", (name) => {
    expect(escapeComponent(name)).toBe(hashed(name));
  });

  it("hashes the original spelling, not the lower-cased one", () => {
    expect(escapeComponent("_A")).not.toBe(escapeComponent("_a"));
  });

  // escape_test.go, TestEscapeComponentMax: the limit applies before the escapes of ADR 0017.
  it.each([
    ["a".repeat(64), 64, "a".repeat(64)],
    ["a".repeat(64) + "b", 64, hashed("a".repeat(64) + "b")],
    ["a".repeat(64) + "b", 0, "a".repeat(64) + "b"],
    ["~".repeat(22), 64, hashed("~".repeat(22))],
    ["a".repeat(57) + "--blobs", 64, "a".repeat(57) + "_2d_2dblob_73"],
    [".x", 64, hashed(".x")],
  ])("escapeComponentMax %#", (name, max, component) => {
    expect(escapeComponentMax(name, max)).toBe(component);
  });

  // path_test.go, TestPackagePath.
  it.each([
    [["x", "tags", "list"], "x/tag_73/list"],
    [["tags", "listing.txt"], "tag_73/listing.txt"],
    [["tags", "tags", "list"], "tags/tag_73/list"],
    [["tags", "list", "tags", "list"], "tag_73/list/tag_73/list"],
    [["tags"], "tags"],
    [["x", "tags"], "x/tags"],
    [["x", "tags", "other"], "x/tags/other"],
    [["x", "mytags", "list"], "x/mytags/list"],
    [["list"], "list"],
    [["tags", hashed(".list")], "tags/" + hashed(".list")],
    [[], ""],
  ])("joinPackagePath %j → %s", (components, path) => {
    expect(joinPackagePath(components)).toBe(path);
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
