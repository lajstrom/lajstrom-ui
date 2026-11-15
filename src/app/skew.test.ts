import { describe, expect, it } from "vitest";

import type { Contract } from "./build";
import { parseVersion, skewOf } from "./skew";

const commit = "f0d887d5ebd9b34f49c9a1d528af6c6b60df2531";
const between: Contract = { api: "v1", serverCommit: commit, serverVersion: "v0.0.1-959-gf0d887d" };
const release: Contract = { api: "v1", serverCommit: commit, serverVersion: "v0.1.0" };
const server = (version: string, c = "") => ({ version, commit: c, date: "" });

describe("parseVersion", () => {
  it("reads release tags and git describe", () => {
    expect(parseVersion("v0.1.0")).toEqual({ n: [0, 1, 0], pre: "", ahead: 0, commit: "" });
    expect(parseVersion("v0.1.0-rc.1")).toEqual({ n: [0, 1, 0], pre: "rc.1", ahead: 0, commit: "" });
    expect(parseVersion("v0.0.1-959-gf0d887d")).toEqual({ n: [0, 0, 1], pre: "", ahead: 959, commit: "f0d887d" });
    expect(parseVersion("v0.1.0-rc.1-3-gabcdef1-dirty")).toEqual({ n: [0, 1, 0], pre: "rc.1", ahead: 3, commit: "abcdef1" });
  });

  it("is null for what is not a version", () => {
    expect(parseVersion("dev")).toBeNull();
    expect(parseVersion("f0d887d")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });
});

describe("skewOf", () => {
  it("is the same for the contract's commit, however the server names it", () => {
    expect(skewOf(between, server("v0.0.1-959-gf0d887d", "f0d887d"))).toBe("same");
    // git describe --always in a checkout without tags, as CI's e2e builds the server.
    expect(skewOf(between, server("f0d887d", "f0d887d"))).toBe("same");
    expect(skewOf(between, server("f0d887d", ""))).toBe("same");
    expect(skewOf(release, server("v0.1.0", "abc1234"))).toBe("same");
  });

  it("is older before the contract", () => {
    expect(skewOf(between, server("v0.0.1", "e26e19d"))).toBe("older");
    expect(skewOf(between, server("v0.0.1-900-gabc1234", "abc1234"))).toBe("older");
    expect(skewOf(release, server("v0.1.0-rc.2", "abc1234"))).toBe("older");
    expect(skewOf(release, server("v0.0.9", "abc1234"))).toBe("older");
  });

  it("is compatible on the contract's line, and between releases on the next one", () => {
    expect(skewOf(release, server("v0.1.3", "abc1234"))).toBe("compatible");
    expect(skewOf(release, server("v0.1.3-12-gabc1234", "abc1234"))).toBe("compatible");
    expect(skewOf(between, server("v0.0.1-1000-gabc1234", "abc1234"))).toBe("compatible");
    // The release that will contain the contract's commit.
    expect(skewOf(between, server("v0.1.0", "abc1234"))).toBe("compatible");
  });

  it("is newer on a later line", () => {
    expect(skewOf(release, server("v0.2.0", "abc1234"))).toBe("newer");
    expect(skewOf(between, server("v0.2.0", "abc1234"))).toBe("newer");
    expect(skewOf(release, server("v1.0.0", "abc1234"))).toBe("newer");
    expect(skewOf({ ...release, serverVersion: "v1.2.0" }, server("v1.9.0", "abc1234"))).toBe("compatible");
    expect(skewOf({ ...release, serverVersion: "v1.2.0" }, server("v2.0.0", "abc1234"))).toBe("newer");
  });

  it("is unknown when a version says nothing", () => {
    expect(skewOf(between, server("dev", ""))).toBe("unknown");
    expect(skewOf(between, server("abc1234", "abc1234"))).toBe("unknown");
    expect(skewOf({ ...between, serverVersion: "" }, server("v0.1.0", "abc1234"))).toBe("unknown");
  });
});
