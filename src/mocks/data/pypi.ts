import { sha256Hex } from "@/lib/sha256";

import type { ReferrerSpec, VersionSpec } from "./builders";
import { ago } from "./time";

type Project = {
  summary: string;
  requiresPython: string;
  requiresDist: string[];
  license: string;
  author: string;
  urls: Record<string, string>;
  classifiers?: string[];
};

type Release = {
  version: string;
  /** wheel tag → size; "sdist" → size of the .tar.gz */
  files: Record<string, number>;
  at: string;
  by: string;
  referrers?: ReferrerSpec[];
  /** Not PEP 440: accepted and flagged lajstrom.pypi.nonstandard=true (M1-08). */
  nonstandard?: boolean;
  /** Metadata layer unreadable: reindex keeps the row, flagged (manifest-profile.md §2). */
  degraded?: boolean;
  /** Legacy .zip sdist instead of .tar.gz. */
  zipSdist?: boolean;
};

/** Wheel and sdist file names use the PEP 503 name with "-" replaced by "_" (PEP 427, 625). */
function distName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "_");
}

/** One manifest per file: the variant is the wheel tag or "sdist". */
function project(repo: string, name: string, p: Project, releases: Release[]): VersionSpec[] {
  const normalized = name.toLowerCase().replace(/[-_.]+/g, "-");
  return releases.flatMap((rel) =>
    Object.entries(rel.files).map(([variant, size]): VersionSpec => {
      const sdist = variant === "sdist";
      const filename = sdist
        ? `${distName(name)}-${rel.version}.${rel.zipSdist ? "zip" : "tar.gz"}`
        : `${distName(name)}-${rel.version}-${variant}.whl`;
      const mediaType = sdist
        ? rel.zipSdist
          ? "application/vnd.lajstrom.pypi.sdist.v1+zip"
          : "application/vnd.lajstrom.pypi.sdist.v1.tar+gzip"
        : "application/vnd.lajstrom.pypi.wheel.v1+zip";
      return {
        format: "pypi",
        repo,
        name,
        version: rel.version,
        variant,
        files: [{ name: filename, mediaType, size }],
        metadata: rel.degraded
          ? null
          : {
              metadata_version: "2.4",
              name,
              version: rel.version,
              summary: p.summary,
              requires_python: p.requiresPython,
              requires_dist: p.requiresDist,
              license_expression: p.license,
              author: p.author,
              project_urls: p.urls,
              classifiers: p.classifiers ?? [
                "Programming Language :: Python :: 3",
                "Operating System :: OS Independent",
                "Private :: Do Not Upload",
              ],
              filename,
              sha256: sha256Hex(`pypi:${filename}`),
              packagetype: sdist ? "sdist" : "bdist_wheel",
            },
        attrs: {
          "pypi.normalized": normalized,
          ...(rel.nonstandard ? { "pypi.nonstandard": "true" } : {}),
        },
        createdAt: rel.at,
        uploadedBy: rel.by,
        referrers: rel.referrers,
        degraded: rel.degraded,
      };
    }),
  );
}

const ACME_URLS = (slug: string) => ({
  Source: `https://git.acme.example/${slug}`,
  Changelog: `https://git.acme.example/${slug}/-/blob/main/CHANGELOG.md`,
});

export function pypiVersions(): VersionSpec[] {
  const internal = "internal";
  const payments = "payments";
  const manylinux = [
    "cp311-cp311-manylinux_2_17_x86_64",
    "cp312-cp312-manylinux_2_17_x86_64",
    "cp312-cp312-manylinux_2_17_aarch64",
    "cp312-cp312-macosx_11_0_arm64",
  ];
  return [
    ...project(
      internal,
      "requests",
      {
        summary: "Python HTTP for Humans.",
        requiresPython: ">=3.8",
        requiresDist: [
          "charset-normalizer<4,>=2",
          "idna<4,>=2.5",
          "urllib3<3,>=1.21.1",
          "certifi>=2017.4.17",
          'PySocks!=1.5.7,>=1.5.6; extra == "socks"',
        ],
        license: "Apache-2.0",
        author: "Kenneth Reitz",
        urls: { Documentation: "https://requests.readthedocs.io", Source: "https://github.com/psf/requests" },
        classifiers: [
          "Development Status :: 5 - Production/Stable",
          "Intended Audience :: Developers",
          "License :: OSI Approved :: Apache Software License",
          "Programming Language :: Python :: 3 :: Only",
          "Topic :: Internet :: WWW/HTTP",
        ],
      },
      [
        { version: "2.31.0", files: { "py3-none-any": 62_574, sdist: 110_794 }, at: ago(90, 2), by: "user:carol" },
        {
          version: "2.32.3",
          files: { "py3-none-any": 64_928, sdist: 131_218 },
          at: ago(30, 1),
          by: "user:carol",
          referrers: ["cosign", "spdx"],
        },
      ],
    ),
    ...project(
      internal,
      "acme-billing-client",
      {
        summary: "Typed client for the Acme billing API",
        requiresPython: ">=3.10",
        requiresDist: ["httpx>=0.27", "pydantic>=2.6", "tenacity>=8.2", 'respx>=0.21; extra == "test"'],
        license: "LicenseRef-Acme-Proprietary",
        author: "Billing Team",
        urls: ACME_URLS("billing/acme-billing-client"),
      },
      [
        { version: "1.4.0", files: { "py3-none-any": 48_201, sdist: 39_920 }, at: ago(95, 3), by: "token:21" },
        { version: "1.4.1", files: { "py3-none-any": 48_660, sdist: 40_118 }, at: ago(60, 6), by: "token:21" },
        { version: "1.5.0", files: { "py3-none-any": 51_390, sdist: 42_771 }, at: ago(4, 2), by: "token:21", referrers: ["cosign"] },
      ],
    ),
    ...project(
      internal,
      "ml-feature-store",
      {
        summary: "Feature store client and offline materialisation for Acme ML",
        requiresPython: ">=3.11",
        requiresDist: ["numpy>=1.26", "pyarrow>=15", "pandas>=2.2", "grpcio>=1.62", 'ray[data]>=2.20; extra == "ray"'],
        license: "LicenseRef-Acme-Proprietary",
        author: "ML Platform",
        urls: ACME_URLS("ml/feature-store"),
        classifiers: [
          "Programming Language :: Python :: 3.11",
          "Programming Language :: Python :: 3.12",
          "Programming Language :: Python :: Implementation :: CPython",
          "Operating System :: POSIX :: Linux",
          "Operating System :: MacOS",
        ],
      },
      [
        {
          version: "0.9.2",
          files: Object.fromEntries([...manylinux.slice(0, 3).map((t, i) => [t, 4_402_118 + i * 91_337]), ["sdist", 1_204_557]]),
          at: ago(45, 2),
          by: "user:carol",
        },
        {
          version: "1.0.0",
          files: Object.fromEntries([...manylinux.map((t, i) => [t, 4_710_302 + i * 87_211]), ["sdist", 1_288_430]]),
          at: ago(2, 4),
          by: "user:carol",
          referrers: ["spdx"],
        },
      ],
    ),
    ...project(
      internal,
      "Acme-Telemetry",
      {
        summary: "OpenTelemetry defaults for Acme services",
        requiresPython: ">=3.9",
        requiresDist: ["opentelemetry-sdk>=1.24", "opentelemetry-exporter-otlp>=1.24"],
        license: "Apache-2.0",
        author: "Platform Team",
        urls: ACME_URLS("platform/acme-telemetry"),
      },
      [
        { version: "0.3.0", files: { "py3-none-any": 18_220, sdist: 15_904 }, at: ago(22, 5), by: "user:carol" },
        { version: "0.3.1", files: { "py3-none-any": 18_506 }, at: ago(8, 1), by: "user:carol" },
      ],
    ),
    ...project(
      internal,
      "django-acme-auth",
      {
        summary: "Django authentication backend for Acme SSO",
        requiresPython: ">=3.10",
        requiresDist: ["Django>=4.2", "PyJWT>=2.8", "cryptography>=42"],
        license: "BSD-3-Clause",
        author: "Identity Team",
        urls: ACME_URLS("identity/django-acme-auth"),
      },
      [
        { version: "3.2.0", files: { "py3-none-any": 27_118, sdist: 22_406 }, at: ago(51), by: "user:carol" },
        { version: "3.2.1", files: { "py3-none-any": 27_390, sdist: 22_617 }, at: ago(11, 3), by: "user:carol" },
      ],
    ),
    ...project(
      internal,
      "acme-legacy-tool",
      {
        summary: "Legacy deployment helpers (frozen)",
        requiresPython: ">=3.6",
        requiresDist: [],
        license: "LicenseRef-Acme-Proprietary",
        author: "Ops",
        urls: {},
      },
      [{ version: "2019.3-hotfix", files: { sdist: 88_412 }, at: ago(410), by: "user:admin", nonstandard: true, degraded: true, zipSdist: true }],
    ),
    ...project(
      payments,
      "payments-sdk",
      {
        summary: "Payment orchestration SDK",
        requiresPython: ">=3.11",
        requiresDist: ["httpx>=0.27", "pydantic>=2.6", "acme-telemetry>=0.3"],
        license: "LicenseRef-Acme-Proprietary",
        author: "Payments Team",
        urls: ACME_URLS("payments/payments-sdk"),
      },
      [
        { version: "2.0.0", files: { "py3-none-any": 133_902, sdist: 98_771 }, at: ago(50, 2), by: "token:22" },
        { version: "2.1.0", files: { "py3-none-any": 138_244, sdist: 101_350 }, at: ago(6, 3), by: "token:22", referrers: ["cosign", "cyclonedx"] },
      ],
    ),
    ...project(
      payments,
      "ledger-tools",
      {
        summary: "Reconciliation tools for the payments ledger",
        requiresPython: ">=3.12",
        requiresDist: ["polars>=0.20", "click>=8.1"],
        license: "LicenseRef-Acme-Proprietary",
        author: "Payments Team",
        urls: ACME_URLS("payments/ledger-tools"),
      },
      [{ version: "0.7.1", files: { "cp312-cp312-manylinux_2_28_x86_64": 2_904_116, sdist: 412_090 }, at: ago(12, 2), by: "user:alice" }],
    ),
  ];
}
