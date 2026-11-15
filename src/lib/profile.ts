// The naming rules of docs/spec/manifest-profile.md §4 (lajstrom/lajstrom), ported from
// internal/oci/profile/escape.go and path.go for the mock data and for showing users what a name
// becomes in the registry. The server never decodes tags, and neither does the UI: the API returns
// tag and OCI path as stored. profile.test.ts holds the test vectors of escape_test.go, path_test.go
// and the plugins' name tests. Only the newest form is written here: the earlier forms of a path
// (before ADR 0017) are the server's to read.

import { sha256Hex } from "./sha256";

const plain = /[A-Za-z0-9.-]/;

/** Escape of §4.3: bytes outside [A-Za-z0-9.-] become _ and two lowercase hex digits. */
export function escape(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (const b of bytes) {
    const ch = String.fromCharCode(b);
    out += b < 0x80 && plain.test(ch) ? ch : "_" + b.toString(16).padStart(2, "0");
  }
  // A tag must not start with "." or "-".
  if (out.startsWith(".")) out = "_2e" + out.slice(1);
  else if (out.startsWith("-")) out = "_2d" + out.slice(1);
  return out;
}

/** The path-component grammar of the OCI distribution specification 1.1. */
const ociComponent = /^[a-z0-9]+(?:(?:[._]|__|[-]+)[a-z0-9]+)*$/;

// ADR 0017 and its amendment: the components a registry keeps for itself. Zot's catalog and
// garbage collector skip the suffixes, its image layout has the files, Harbor's routes find the
// words anywhere in a URL.
const reservedSuffixes = ["blobs", ".uploads", ".sync"];
const reservedComponents = ["index.json", "oci-layout", "manifests", "referrers"];

const reserved = (c: string) => reservedSuffixes.some((s) => c.endsWith(s)) || reservedComponents.includes(c);

const hexByte = (c: string) => "_" + c.charCodeAt(0).toString(16).padStart(2, "0");

/**
 * EscapeComponent of §4.3, for repository path components (ADR 0017). A name whose escaped form
 * the 1.1 grammar rejects becomes "h0_h" and 32 hex digits of the sha256 of the original name;
 * otherwise each "-" of a run of two or more is escaped, and so is the last byte of a reserved
 * component: "a--b" is "a_2d_2db", "blobs" is "blob_73".
 */
export function escapeComponent(s: string): string {
  return escapeComponentMax(s, 0);
}

/** EscapeComponentMax: escapeComponent, hashing a name whose escaped form is longer than maxLen
 * bytes too when maxLen is positive (a raw path's 64-byte components, §4.1). */
export function escapeComponentMax(s: string, maxLen: number): string {
  const e = escape(s.replace(/[A-Z]/g, (c) => c.toLowerCase()));
  if (!ociComponent.test(e) || (maxLen > 0 && e.length > maxLen)) return "h0_h" + sha256Hex(s).slice(0, 32);
  const last = reserved(e);
  if (!last && !e.includes("--")) return e;
  let out = "";
  for (let i = 0; i < e.length; i++) {
    const c = e[i]!;
    const dashRun = c === "-" && (e[i - 1] === "-" || e[i + 1] === "-");
    out += dashRun || (last && i === e.length - 1) ? hexByte(c) : c;
  }
  return out;
}

/** PackagePath of §4.3: joins escaped components with "/", writing a component "tags" that a
 * component starting with "list" follows as "tag_73" (Harbor's tag-list route). */
export function joinPackagePath(components: string[]): string {
  return components.map((c, i) => (c === "tags" && components[i + 1]?.startsWith("list") ? "tag_73" : c)).join("/");
}

/**
 * The tag of §4.2: Escape(version) ["__" Escape(variant)]. A tag longer than 128 characters is
 * replaced by "_h" and 40 hex digits of the sha256 of that unhashed tag string.
 */
export function tagFor(version: string, variant = ""): string {
  const tag = variant ? `${escape(version)}__${escape(variant)}` : escape(version);
  if (tag.length <= 128) return tag;
  return "_h" + sha256Hex(tag).slice(0, 40);
}

/** PEP 503 normalisation of a Python project name. */
export function normalizePypi(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/** An npm name split into its scope, without the @, and the name without the scope:
 * ["acme", "widgets"] for @acme/widgets, ["", "lodash"] for lodash. */
export function npmScope(name: string): [scope: string, base: string] {
  if (!name.startsWith("@")) return ["", name];
  const slash = name.indexOf("/");
  return slash === -1 ? ["", name] : [name.slice(1, slash), name.slice(slash + 1)];
}

/** The package path of §4.1 for a package name, as each plugin's EscapeName computes it. */
export function packagePath(format: string, name: string): string {
  switch (format) {
    case "raw":
      // A component longer than 64 bytes escaped is hashed (raw's maxComponentLen).
      return joinPackagePath(name.split("/").filter(Boolean).map((c) => escapeComponentMax(c, 64)));
    case "pypi":
      return escapeComponent(normalizePypi(name));
    case "maven": {
      const [groupId = "", artifactId = ""] = name.split(":");
      return joinPackagePath([escapeComponent(groupId.toLowerCase()), escapeComponent(artifactId)]);
    }
    case "npm": {
      // @scope/name is two components without the @; an unscoped name is one.
      const [scope, base] = npmScope(name);
      return scope ? joinPackagePath([escapeComponent(scope), escapeComponent(base)]) : escapeComponent(base);
    }
    default:
      // apt (deb), rpm: EscapeComponent of the name.
      return escapeComponent(name);
  }
}
