// The naming rules of docs/spec/manifest-profile.md §4 (lajstrom/lajstrom), ported from
// internal/oci/profile/escape.go for the mock data and for showing users what a name becomes in
// the registry. The server never decodes tags, and neither does the UI: the API returns tag and
// OCI path as stored. profile.test.ts holds the test vectors of escape_test.go.

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

const ociComponent = /^[a-z0-9]+(?:(?:[._]|__|[-]+)[a-z0-9]+)*$/;

/**
 * EscapeComponent of §4.3, for repository path components. A name the OCI grammar rejects becomes
 * "h0__" and 32 hex digits of the sha256 of the original name; Escape never produces "__", so a
 * hashed component cannot collide with an escaped one.
 */
export function escapeComponent(s: string): string {
  const lowered = s.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const escaped = escape(lowered);
  if (ociComponent.test(escaped)) return escaped;
  return "h0__" + sha256Hex(s).slice(0, 32);
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

/** The package path of §4.1 for a package name, as each MVP plugin's EscapeName computes it. */
export function packagePath(format: string, name: string): string {
  switch (format) {
    case "raw":
      return name.split("/").filter(Boolean).map(escapeComponent).join("/");
    case "pypi":
      return escapeComponent(normalizePypi(name));
    case "maven": {
      const [groupId = "", artifactId = ""] = name.split(":");
      return `${escapeComponent(groupId.toLowerCase())}/${escapeComponent(artifactId)}`;
    }
    default:
      return escapeComponent(name);
  }
}
