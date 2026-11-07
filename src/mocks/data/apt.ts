import { sha256Hex } from "@/lib/sha256";

import type { ReferrerSpec, VersionSpec } from "./builders";
import { ago } from "./time";

type DebInfo = {
  maintainer: string;
  section: string;
  priority?: string;
  depends?: string;
  homepage?: string;
  description: string;
  installedSize: number;
};

type DebBuild = {
  version: string;
  suite: string;
  component: string;
  /** arch → size of the .deb in bytes */
  arches: Record<string, number>;
  at: string;
  by: string;
  referrers?: ReferrerSpec[];
};

/** One manifest per (package, version, arch); suite and component are upload metadata. */
function deb(repo: string, name: string, info: DebInfo, builds: DebBuild[]): VersionSpec[] {
  return builds.flatMap((b) =>
    Object.entries(b.arches).map(([arch, size]): VersionSpec => {
      // dpkg file name: epoch stripped.
      const fileVersion = b.version.replace(/^\d+:/, "");
      const filename = `${name}_${fileVersion}_${arch}.deb`;
      const control: Record<string, string> = {
        Package: name,
        Version: b.version,
        Architecture: arch,
        Maintainer: info.maintainer,
        "Installed-Size": String(info.installedSize),
        ...(info.depends ? { Depends: info.depends } : {}),
        Section: info.section,
        Priority: info.priority ?? "optional",
        ...(info.homepage ? { Homepage: info.homepage } : {}),
        Description: info.description,
      };
      const md5sums = Object.fromEntries(
        [`usr/share/doc/${name}/copyright`, `usr/share/doc/${name}/changelog.Debian.gz`, `usr/bin/${name}`].map((p) => [
          p,
          sha256Hex(`${filename}:${p}`).slice(0, 32),
        ]),
      );
      return {
        format: "apt",
        repo,
        name,
        version: b.version,
        variant: arch,
        files: [{ name: filename, mediaType: "application/vnd.lajstrom.deb.package.v1", size }],
        metadata: { control, md5sums, size, sha256: sha256Hex(`deb:${filename}`), filename },
        attrs: { "deb.arch": arch, "deb.suite": b.suite, "deb.component": b.component },
        createdAt: b.at,
        uploadedBy: b.by,
        referrers: b.referrers,
      };
    }),
  );
}

const UBUNTU = "Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>";
const PLATFORM = "Platform Team <platform@acme.example>";

export function aptVersions(): VersionSpec[] {
  const r = "ubuntu-internal";
  return [
    ...deb(
      r,
      "nginx",
      {
        maintainer: UBUNTU,
        section: "httpd",
        depends:
          "libc6 (>= 2.34), libcrypt1 (>= 1:4.1.0), libpcre2-8-0 (>= 10.22), libssl3 (>= 3.0.0), zlib1g (>= 1:1.1.4), nginx-common (= 1.18.0-6ubuntu14.4)",
        homepage: "https://nginx.org",
        description: "small, powerful, scalable web/proxy server",
        installedSize: 3466,
      },
      [
        {
          version: "1:1.18.0-6ubuntu14.4",
          suite: "jammy",
          component: "main",
          arches: { amd64: 1258496, arm64: 1187842 },
          at: ago(12, 3),
          by: "user:bob",
          referrers: ["cosign"],
        },
        {
          version: "1:1.24.0-2ubuntu7",
          suite: "noble",
          component: "main",
          arches: { amd64: 1342908, arm64: 1270224 },
          at: ago(3, 6),
          by: "user:bob",
          referrers: ["cosign"],
        },
      ],
    ),
    ...deb(
      r,
      "hello",
      {
        maintainer: "Santiago Vila <sanvila@debian.org>",
        section: "devel",
        homepage: "https://www.gnu.org/software/hello/",
        description: "example package based on GNU hello",
        installedSize: 280,
        depends: "libc6 (>= 2.34)",
      },
      [
        { version: "2.10-2ubuntu4", suite: "jammy", component: "main", arches: { amd64: 54220, arm64: 53860 }, at: ago(20, 2), by: "user:bob" },
        { version: "2.10-3", suite: "noble", component: "main", arches: { amd64: 55102, arm64: 54688 }, at: ago(6, 1), by: "user:bob" },
      ],
    ),
    ...deb(
      r,
      "libstdc++6",
      {
        maintainer: UBUNTU,
        section: "libs",
        priority: "important",
        homepage: "https://gcc.gnu.org/",
        description: "GNU Standard C++ Library v3",
        installedSize: 2710,
        depends: "gcc-12-base (= 12.3.0-1ubuntu1~22.04), libc6 (>= 2.34), libgcc-s1 (>= 4.2)",
      },
      [{ version: "12.3.0-1ubuntu1~22.04", suite: "jammy", component: "main", arches: { amd64: 790238 }, at: ago(30, 4), by: "user:bob" }],
    ),
    ...deb(
      r,
      "acme-agent",
      {
        maintainer: PLATFORM,
        section: "admin",
        depends: "libc6 (>= 2.35), systemd, adduser",
        homepage: "https://git.acme.example/platform/acme-agent",
        description: "Acme host agent: metrics, logs and remote configuration",
        installedSize: 41210,
      },
      [
        { version: "2.4.1", suite: "jammy", component: "main", arches: { amd64: 14_633_402, arm64: 13_991_008 }, at: ago(40, 5), by: "token:15", referrers: ["cosign"] },
        { version: "2.5.0", suite: "noble", component: "main", arches: { amd64: 14_910_276, arm64: 14_204_552 }, at: ago(9, 2), by: "token:15", referrers: ["cosign", "spdx"] },
        { version: "2.5.1~rc1", suite: "noble", component: "testing", arches: { amd64: 14_922_884 }, at: ago(1, 3), by: "token:15", referrers: ["cosign"] },
      ],
    ),
    ...deb(
      r,
      "acme-cli",
      {
        maintainer: PLATFORM,
        section: "utils",
        depends: "python3 (>= 3.10), python3-httpx",
        homepage: "https://git.acme.example/platform/acme-cli",
        description: "Command-line client for the Acme platform",
        installedSize: 912,
      },
      [
        { version: "1.7.2-1", suite: "jammy", component: "main", arches: { all: 201_448 }, at: ago(33), by: "user:bob" },
        { version: "1.8.0-1", suite: "noble", component: "main", arches: { all: 208_916 }, at: ago(2, 1), by: "user:bob" },
      ],
    ),
    ...deb(
      r,
      "lajstrom",
      {
        maintainer: "The Lajstrom Authors <maintainers@lajstrom.dev>",
        section: "net",
        homepage: "https://lajstrom.dev",
        description: "artifact registry on top of any OCI registry",
        installedSize: 38_400,
      },
      [
        {
          version: "0.1.0~rc1-1",
          suite: "noble",
          component: "testing",
          arches: { amd64: 12_884_090, arm64: 11_902_336 },
          at: ago(0, 5, 12),
          by: "user:admin",
          referrers: ["cosign", "spdx", "slsa"],
        },
      ],
    ),
    ...deb(
      r,
      "postgresql-client-16",
      {
        maintainer: "Debian PostgreSQL Maintainers <team+postgresql@tracker.debian.org>",
        section: "database",
        homepage: "https://www.postgresql.org/",
        description: "front-end programs for PostgreSQL 16",
        installedSize: 6_480,
        depends: "libpq5 (>= 16~~), postgresql-client-common (>= 182~), sensible-utils",
      },
      [{ version: "16.4-1.pgdg22.04+1", suite: "jammy", component: "main", arches: { amd64: 1_766_302 }, at: ago(25, 7), by: "user:bob" }],
    ),
    ...deb(
      r,
      "prometheus-node-exporter",
      {
        maintainer: "Debian Go Packaging Team <team+pkg-go@tracker.debian.org>",
        section: "net",
        homepage: "https://github.com/prometheus/node_exporter",
        description: "Prometheus exporter for machine metrics",
        installedSize: 21_002,
        depends: "libc6 (>= 2.34), adduser",
      },
      [{ version: "1.8.2-1", suite: "jammy", component: "main", arches: { amd64: 5_408_118, arm64: 4_977_740 }, at: ago(15, 2), by: "user:bob" }],
    ),
  ];
}
