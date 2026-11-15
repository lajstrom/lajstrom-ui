// The proxy repos of the mock (docs/spec/proxy-and-group.md): which names a proxy mirrors (§3),
// and what a prefetch of an oci proxy fetches (§11.10). db.ts keeps the state and the audit rows.

import type { PrefetchItemResult, PrefetchResult, Upstream } from "@/api/types";
import { sha256Hex } from "@/lib/sha256";

import type { Refusal } from "./db";

const invalid = (message: string): Refusal => ({ status: 400, code: "INVALID", message });

/** A path of an OCI name (http-routing.md §2): components of lowercase letters and digits
 * joined by ".", "_", "__" or dashes, separated by "/". */
export const OCI_PATH = /^[a-z0-9]+(?:(?:\.|_|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:\.|_|__|-+)[a-z0-9]+)*)*$/;

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** Whether a name pattern matches a name, ignoring ASCII case (§3): `*` matches any run of
 * characters; on an oci repo, a run within one component of the path (§11.2). */
export function matches(pattern: string, name: string, oci: boolean): boolean {
  return new RegExp(`^${pattern.split("*").map(escape).join(oci ? "[^/]*" : ".*")}$`, "i").test(name);
}

/** Why a proxy does not mirror a name: "deny: <pattern>", or "allow" when its allow list has no
 * pattern that matches; null when it mirrors it (§3: deny wins). */
export function refusedBy(upstream: Upstream, name: string, oci: boolean): string | null {
  const deny = (upstream.deny ?? []).find((p) => matches(p, name, oci));
  if (deny) return `deny: ${deny}`;
  const allow = upstream.allow ?? [];
  return allow.length && !allow.some((p) => matches(p, name, oci)) ? "allow" : null;
}

/** Whether a ?name= of a purge is a name of the format: an image path of oci, any other a name
 * without spaces. */
export function isPackageName(name: string, format: string): boolean {
  return format === "oci" ? OCI_PATH.test(name) : /^[^\s]{1,256}$/.test(name);
}

type ImageRef = { path: string; tag: string | null; digest: string | null };

/** `<path>[:<tag>][@<digest>]` below the repo, as a client names it (§11.10): latest without a
 * tag or a digest; on Docker Hub a path of one component is library/<path> (§11.7). A string is
 * why it is not one. */
export function parseImage(ref: string, dockerHub: boolean): ImageRef | string {
  let rest = ref.trim();
  let digest: string | null = null;
  const at = rest.indexOf("@");
  if (at >= 0) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) return `"${digest}" is not a sha256 digest`;
  }
  let tag: string | null = null;
  const colon = rest.lastIndexOf(":");
  if (colon > rest.lastIndexOf("/")) {
    tag = rest.slice(colon + 1);
    rest = rest.slice(0, colon);
    if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(tag)) return `"${tag}" is not a tag`;
  }
  const first = rest.split("/")[0]!;
  if (rest.includes("/") && (first.includes(".") || first.includes(":") || first === "localhost")) {
    return `${ref} names a registry: send the reference below the repo`;
  }
  if (!OCI_PATH.test(rest)) return `"${rest}" is not a repository path`;
  if (dockerHub && !rest.includes("/")) rest = `library/${rest}`;
  return { path: rest, tag: digest ? tag : (tag ?? "latest"), digest };
}

/** The platform as containerd normalises it: linux/arm64/v8 is linux/arm64, linux/arm is
 * linux/arm/v7, linux/amd64/v1 is linux/amd64; null when it is not os/architecture[/variant]. */
export function normalizePlatform(p: string): string | null {
  const parts = p.split("/");
  if (parts.length < 2 || parts.length > 3 || parts.some((x) => !/^[a-z0-9_.-]+$/.test(x))) return null;
  const [os, arch] = parts as [string, string];
  let variant = parts[2];
  if ((arch === "arm64" && variant === "v8") || (arch === "amd64" && variant === "v1")) variant = undefined;
  if (arch === "arm" && !variant) variant = "v7";
  return [os, arch, variant].filter(Boolean).join("/");
}

/** The platforms every tag of the mock's upstreams names: an index of three. */
const INDEX_PLATFORMS = ["linux/amd64", "linux/arm64", "linux/arm/v7"];

const digestOf = (seed: string) => `sha256:${sha256Hex(seed)}`;
const sizeOf = (digest: string, min: number, spread: number) => min + (parseInt(digest.slice(7, 15), 16) % spread);

type Fetch = {
  /** The repo, <format>/<name>: what it holds is keyed by it. */
  repo: string;
  upstream: Upstream;
  dockerHub: boolean;
  /** What the backend holds, `<repo>@<digest>`; the prefetch adds what it fetches. */
  held: Set<string>;
};

/** POST …/prefetch of an oci proxy (§11.10): each image the way a pull goes, the platforms of an
 * index, the blobs of each manifest the repo does not hold. A second run is one held result per
 * image and platform. */
export function prefetchImages({ repo, upstream, dockerHub, held }: Fetch, body: unknown): PrefetchResult | Refusal {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return invalid("the body must be a JSON object");
  const b = body as Record<string, unknown>;
  if ("names" in b || "allVersions" in b) return invalid(`${"names" in b ? "names" : "allVersions"}: an oci proxy takes images, not names`);
  const unknown = Object.keys(b).find((k) => k !== "images" && k !== "platforms");
  if (unknown) return invalid(`${unknown}: not a field of a prefetch`);
  const images = b.images;
  if (!Array.isArray(images) || images.length < 1 || images.length > 100 || images.some((i) => typeof i !== "string")) {
    return invalid("images: 1 to 100 references, <path>[:<tag>][@<digest>]");
  }
  if (b.platforms !== undefined && (!Array.isArray(b.platforms) || b.platforms.some((p) => typeof p !== "string"))) {
    return invalid("platforms: a list of <os>/<architecture>[/<variant>]");
  }
  const platforms: string[] = [];
  for (const [i, p] of ((b.platforms as string[] | undefined) ?? []).entries()) {
    const n = normalizePlatform(p);
    if (!n) return invalid(`platforms[${i}]: "${p}" is not <os>/<architecture>[/<variant>]`);
    if (!platforms.includes(n)) platforms.push(n);
  }

  const results: PrefetchItemResult[] = [];
  const has = (digest: string) => held.has(`${repo}@${digest}`);
  const hold = (digest: string) => held.add(`${repo}@${digest}`);

  /** A platform's manifest and the blobs it lists that the repo does not hold. */
  const manifest = (name: string, digest: string, platform?: string) => {
    if (has(digest)) {
      results.push({ name, kind: "manifest", ...(platform ? { platform } : {}), digest, status: "held" });
      return;
    }
    const blobs = ["config", "layer 1", "layer 2", "layer 3"].map((part, i) => {
      const d = digestOf(`blob:${digest}:${part}`);
      return { digest: d, size: i === 0 ? sizeOf(d, 1_200, 6_000) : sizeOf(d, 400_000, 30_000_000) };
    });
    const fetched = blobs.filter((x) => !has(x.digest));
    const own = sizeOf(digest, 900, 1_500);
    results.push({ name, kind: "manifest", ...(platform ? { platform } : {}), digest, status: "fetched", bytes: own + fetched.reduce((n, x) => n + x.size, 0) });
    for (const x of fetched) {
      results.push({ name, kind: "blob", ...(platform ? { platform } : {}), digest: x.digest, status: "fetched", bytes: x.size });
      hold(x.digest);
    }
    hold(digest);
  };

  for (const ref of images as string[]) {
    const parsed = parseImage(ref, dockerHub);
    if (typeof parsed === "string") {
      results.push({ name: ref, status: "failed", httpStatus: 400, message: parsed });
      continue;
    }
    const refused = refusedBy(upstream, parsed.path, true);
    if (refused) {
      results.push({ name: ref, status: "failed", httpStatus: 403, message: `upstream ${upstream.name}: ${repo} does not mirror "${parsed.path}": ${refused}` });
      continue;
    }
    // A digest names one manifest, fetched as it is; a tag names an index of platforms.
    if (parsed.digest) {
      manifest(ref, parsed.digest);
      continue;
    }
    const index = digestOf(`index:${upstream.name}:${parsed.path}:${parsed.tag}`);
    if (!platforms.length) {
      results.push({ name: ref, kind: "index", digest: index, status: "failed", httpStatus: 400, message: `${ref} names an index of ${INDEX_PLATFORMS.join(", ")}: name the platforms to fetch` });
      continue;
    }
    results.push({ name: ref, kind: "index", digest: index, status: has(index) ? "held" : "fetched", ...(has(index) ? {} : { bytes: sizeOf(index, 1_500, 9_000) }) });
    hold(index);
    for (const platform of platforms) {
      if (!INDEX_PLATFORMS.includes(platform)) {
        results.push({ name: ref, kind: "manifest", platform, status: "failed", httpStatus: 404, message: `the index of ${ref} lists no ${platform}` });
        continue;
      }
      manifest(ref, digestOf(`manifest:${index}:${platform}`), platform);
    }
  }
  return { results };
}
