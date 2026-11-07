import { sha256Hex } from "@/lib/sha256";

import type { ReferrerSpec, VersionSpec } from "./builders";
import { ago } from "./time";

type RawUpload = { size: number; at: string; by: string; referrers?: ReferrerSpec[] };

/** raw: package = path, version = first 16 hex of the content sha256 (http-routing.md §3). */
function file(repo: string, path: string, contentType: string, uploads: RawUpload[]): VersionSpec[] {
  return uploads.map((u, i): VersionSpec => {
    const sha = sha256Hex(`raw-content:${repo}/${path}#${i}`);
    return {
      format: "raw",
      repo,
      name: path,
      version: sha.slice(0, 16),
      // raw is the one format whose layer title may keep directories (manifest-profile.md §1).
      files: [{ name: path, mediaType: "application/vnd.lajstrom.raw.file.v1", size: u.size }],
      metadata: { path, contentType, size: u.size, sha256: sha },
      attrs: { "raw.path": path },
      createdAt: u.at,
      uploadedBy: u.by,
      referrers: u.referrers,
    };
  });
}

const mib = (n: number) => Math.round(n * 1024 * 1024);

export function rawVersions(): VersionSpec[] {
  const a = "assets";
  const s = "scratch";
  const agent = (v: string, os: string, size: number, at: string): VersionSpec[] =>
    file(a, `installers/acme-agent/${v}/acme-agent-${v}-${os}.tar.gz`, "application/gzip", [
      { size, at, by: "token:16", referrers: ["cosign"] },
    ]);
  return [
    ...file(a, "Docs/Readme.MD", "text/markdown", [
      { size: 4_302, at: ago(60, 4), by: "user:bob" },
      { size: 4_811, at: ago(20, 2), by: "user:bob" },
      { size: 5_120, at: ago(1, 2), by: "user:bob" },
    ]),
    ...agent("2.4.1", "linux-amd64", mib(14.0), ago(40, 5)),
    ...file(a, "installers/acme-agent/2.4.1/SHA256SUMS", "text/plain", [{ size: 214, at: ago(40, 5), by: "token:16" }]),
    ...agent("2.5.0", "linux-amd64", mib(14.2), ago(9, 2)),
    ...agent("2.5.0", "linux-arm64", mib(13.6), ago(9, 2)),
    ...agent("2.5.0", "darwin-arm64", mib(12.9), ago(9, 2)),
    ...file(a, "installers/acme-agent/2.5.0/SHA256SUMS", "text/plain", [{ size: 312, at: ago(9, 2), by: "token:16" }]),
    ...file(a, "firmware/router-x1/fw.bin", "application/octet-stream", [
      { size: mib(31.4), at: ago(90, 1), by: "user:bob" },
      { size: mib(31.9), at: ago(33, 3), by: "user:bob" },
      { size: mib(32.0), at: ago(0, 6), by: "user:bob", referrers: ["cosign"] },
    ]),
    ...file(a, "schemas/openapi/billing.yaml", "application/yaml", [
      { size: 48_200, at: ago(48, 3), by: "user:bob" },
      { size: 51_906, at: ago(4, 1), by: "user:bob" },
    ]),
    ...file(a, "schemas/openapi/payments.yaml", "application/yaml", [{ size: 63_118, at: ago(30, 2), by: "user:bob" }]),
    ...file(a, "datasets/geo/cities-2026.csv.gz", "application/gzip", [{ size: 1_975_310_336, at: ago(21, 5), by: "user:admin" }]),
    ...file(a, "scripts/bootstrap.sh", "text/x-shellscript", [
      { size: 1_904, at: ago(70), by: "user:bob" },
      { size: 2_150, at: ago(13, 4), by: "user:bob" },
    ]),
    ...file(s, "tmp/build-4711.log", "text/plain", [{ size: 860_204, at: ago(2, 3), by: "user:bob" }]),
    ...file(s, "tmp/heapdump-2026-11-04.hprof", "application/octet-stream", [{ size: 2_791_309_312, at: ago(2, 1), by: "user:bob" }]),
    ...file(s, "notes.txt", "text/plain", [{ size: 1_140, at: ago(3, 2), by: "user:admin" }]),
  ];
}
