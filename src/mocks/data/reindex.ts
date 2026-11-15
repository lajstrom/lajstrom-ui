// What the seed's last reindex run found in pypi/internal besides its rows: an entry of each list
// of the report (ReindexRun.report in openapi.yaml; docs/operations.md, Reindex), so that the
// demo shows every one. Names, tags and digests follow docs/spec/manifest-profile.md; the entries
// that name a version are built from its rows, so a version deleted in the demo leaves them.

import type { ReindexReport } from "@/api/types";
import { packagePath, tagFor } from "@/lib/profile";
import { sha256Hex } from "@/lib/sha256";

import type { BuiltVersion } from "./builders";

/** The lists of a report that the seed fills, never null. */
export type ReindexFindings = {
  [K in "foreign" | "orphanReferrers" | "orphanJournal" | "drift" | "split" | "repositoryUnknown" | "errors"]: NonNullable<ReindexReport[K]>;
};

const MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const digestOf = (seed: string) => `sha256:${sha256Hex(seed)}`;

/** The request of the management API that deletes a version's rows, the variant alone when it
 * has one, as the server writes it (unknownRepository in internal/index/reindex/prune.go). Go's
 * url.PathEscape leaves a few more bytes than encodeURIComponent (":", "@", "+"); the seed's
 * names and versions here have none. */
function deleteRequest(repoKey: string, v: BuiltVersion): string {
  const call = `DELETE /api/v1/repos/${repoKey}/packages/${encodeURIComponent(v.packageName)}/versions/${encodeURIComponent(v.version)}`;
  return v.variant ? `${call}?variant=${encodeURIComponent(v.variant)}` : call;
}

function pypiInternal(pkgs: Map<string, BuiltVersion[]>): ReindexFindings {
  const rows = (name: string) => pkgs.get(name) ?? [];
  const tags = (list: BuiltVersion[]) => list.map((v) => v.tag).sort();
  const blobs = rows("acme-blobs");
  const latest = rows("ml-feature-store").find((v) => v.version === "1.0.0" && v.variant === "cp312-cp312-manylinux_2_17_x86_64");
  const drifted = rows("requests").find((v) => v.version === "2.31.0" && v.variant === "py3-none-any");
  // The subject of the orphan: the wheel of requests 2.30.0, deleted in the registry's console
  // with its signature left behind under cosign's tag.
  const gone = sha256Hex("pypi/internal requests 2.30.0__py3-none-any");
  return {
    // A container image pushed to the package's OCI repository by mistake: an index, not Lajstrom's.
    foreign: [
      {
        repository: packagePath("pypi", "ml-feature-store"),
        tag: "1.0.0-gpu",
        digest: digestOf("foreign:ml-feature-store:1.0.0-gpu"),
        mediaType: "application/vnd.oci.image.index.v1+json",
      },
    ],
    orphanReferrers: [
      {
        repository: packagePath("pypi", "requests"),
        tag: `sha256-${gone}.sig`,
        digest: digestOf(`cosign:sha256:${gone}`),
        mediaType: MANIFEST,
        subject: `sha256:${gone}`,
      },
    ],
    // The yanks of acme-billing, whose versions were deleted when acme-billing-client replaced
    // it: pypi has no unpublish of a package, so its journal stays (manifest-profile.md §8).
    orphanJournal: [1, 2].map((seq) => ({
      repository: packagePath("pypi", "acme-billing"),
      tag: `_j${String(seq).padStart(8, "0")}`,
      digest: digestOf(`journal:pypi/internal/acme-billing:${seq}`),
      mediaType: MANIFEST,
      artifactType: "application/vnd.lajstrom.pypi.yank.v1",
    })),
    // Re-pointed in the registry, past Lajstrom: the index keeps its digest.
    drift: drifted
      ? [{ package: drifted.packageName, tag: drifted.tag, index: drifted.digest, registry: digestOf(`drift:requests:${drifted.tag}`) }]
      : [],
    // acme-blobs is stored at the form of its name before ADR 0017, and 1.2.0 was pushed to the
    // newest form straight to the registry.
    split: blobs.length
      ? [
          {
            package: "acme-blobs",
            indexed: packagePath("pypi", "acme-blobs"),
            indexedTags: tags(blobs),
            other: "acme-blob_73",
            otherTags: ["py3-none-any", "sdist"].map((variant) => tagFor("1.2.0", variant)).sort(),
          },
        ]
      : [],
    // Acme-Telemetry's OCI repository was deleted in the registry's console: prune keeps the rows.
    repositoryUnknown: rows("Acme-Telemetry").map((v) => ({
      repository: packagePath("pypi", v.packageName),
      package: v.packageName,
      version: v.version,
      variant: v.variant,
      tag: v.tag,
      digest: v.digest,
      delete: deleteRequest("pypi/internal", v),
    })),
    // `oras cp` of a wheel's manifest to the tag latest: the profile's tag check refuses it.
    errors: latest
      ? [
          {
            repository: packagePath("pypi", latest.packageName),
            tag: "latest",
            digest: latest.digest,
            mediaType: MANIFEST,
            artifactType: latest.artifactType,
            error: `format: invalid: the tag of lajstrom.version and lajstrom.variant does not match the tag pushed to: "${latest.tag}", want "latest"`,
          },
        ]
      : [],
  };
}

/** What the last run of the seed found in a repo besides its rows; empty lists for most repos. */
export function reindexFindings(repoKey: string, pkgs: Map<string, BuiltVersion[]>): ReindexFindings {
  if (repoKey === "pypi/internal") return pypiInternal(pkgs);
  return { foreign: [], orphanReferrers: [], orphanJournal: [], drift: [], split: [], repositoryUnknown: [], errors: [] };
}
