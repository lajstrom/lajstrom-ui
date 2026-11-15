import { sha256Hex } from "@/lib/sha256";

import type { ReferrerSpec, VersionSpec } from "./builders";
import { ago } from "./time";

/** A relation of the header as the metadata layer writes it (manifest-profile.md §2, rpm). */
type Relation = { name: string; flags: number; epoch: string; version: string; release: string; pre: boolean };

// rpm's sense flags.
const LESS = 2;
const GREATER = 4;
const EQUAL = 8;
const RPMLIB = 1 << 24;
const SCRIPT_POST = 1 << 10;

/** "glibc >= 2.34" → a relation; a name alone has no version. */
function rel(spec: string, pre = false): Relation {
  const m = /^(\S+)\s*(<=|>=|=|<|>)\s*(?:(\d+):)?([^-\s]+)(?:-(\S+))?$/.exec(spec);
  if (!m) return { name: spec, flags: pre ? SCRIPT_POST : 0, epoch: "", version: "", release: "", pre };
  const flags = { "<": LESS, ">": GREATER, "=": EQUAL, "<=": LESS | EQUAL, ">=": GREATER | EQUAL }[m[2]!]!;
  return { name: m[1]!, flags: flags | (pre ? SCRIPT_POST : 0), epoch: m[3] ?? "", version: m[4]!, release: m[5] ?? "", pre };
}

/** The rpmlib(…) features every rpmbuild of EL9 requires; the repodata leaves them out. */
const RPMLIB_REQUIRES: Relation[] = [
  { name: "rpmlib(CompressedFileNames)", flags: RPMLIB | LESS | EQUAL, epoch: "", version: "3.0.4", release: "1", pre: false },
  { name: "rpmlib(FileDigests)", flags: RPMLIB | LESS | EQUAL, epoch: "", version: "4.6.0", release: "1", pre: false },
  { name: "rpmlib(PayloadFilesHavePrefix)", flags: RPMLIB | LESS | EQUAL, epoch: "", version: "4.0", release: "1", pre: false },
];

type RpmInfo = {
  summary: string;
  description: string;
  license: string;
  url: string;
  vendor?: string;
  packager: string;
  group?: string;
  /** Run-time requirements of a binary package; "!" marks one of the install scripts. */
  requires: string[];
  /** Provides beyond the name and name(arch) of the version. */
  provides?: string[];
  recommends?: string[];
  /** BuildRequires: the requirements of the source package. */
  buildRequires: string[];
  /** Paths of a binary package; a trailing / is a directory. */
  files: string[];
  /** The upstream tarball of the source package. */
  source: string;
  installedSize: number;
};

type RpmBuild = {
  /** [epoch:]version-release, as lajstrom.version spells it. */
  version: string;
  /** arch → size of the .rpm in bytes; "src" is the source package. */
  arches: Record<string, number>;
  at: string;
  by: string;
  referrers?: ReferrerSpec[];
  changelog: string;
};

/** The arch rpm writes into a provide: hello(x86-64). */
const providedArch: Record<string, string> = { x86_64: "x86-64", aarch64: "aarch-64" };

const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** One manifest per (version, arch): the .rpm and the metadata layer read from its header; the
 * variant is the arch, src for the source package (manifest-profile.md §3, rpm). */
function rpmPackage(repo: string, name: string, info: RpmInfo, builds: RpmBuild[]): VersionSpec[] {
  // The changelog of a version holds its entry and those of the builds before it, newest first.
  const history = builds.map((b) => ({
    author: `${info.packager} - ${b.version.replace(/^\d+:/, "")}`,
    date: seconds(b.at) - (seconds(b.at) % 86_400) - 86_400,
    text: b.changelog,
  }));
  return builds.flatMap((b, n) => {
    const m = /^(?:(\d+):)?(.+)-([^-]+)$/.exec(b.version)!;
    const epoch = Number(m[1] ?? 0);
    const [version, release] = [m[2]!, m[3]!];
    const evr = { epoch: m[1] ?? "0", version, release };
    const srpm = `${name}-${version}-${release}.src.rpm`;
    return Object.entries(b.arches).map(([arch, size]): VersionSpec => {
      const source = arch === "src";
      // The file name has no epoch: name-version-release.arch.rpm.
      const filename = `${name}-${version}-${release}.${arch}.rpm`;
      const self = (provide: string): Relation => ({ name: provide, flags: EQUAL, ...evr, pre: false });
      const files = source
        ? [{ path: `${name}.spec` }, { path: info.source }]
        : info.files.map((p) => (p.endsWith("/") ? { path: p.slice(0, -1), type: "dir" } : { path: p }));
      const headerEnd = 4_504 + 96 * files.length + 40 * info.requires.length;
      return {
        format: "rpm",
        repo,
        name,
        version: b.version,
        variant: arch,
        files: [{ name: filename, mediaType: "application/vnd.lajstrom.rpm.package.v1", size }],
        metadata: {
          name,
          epoch,
          version,
          release,
          arch,
          summary: info.summary,
          description: info.description,
          packager: info.packager,
          url: info.url,
          license: info.license,
          vendor: info.vendor ?? "",
          group: info.group ?? "Unspecified",
          buildhost: `build-${arch === "aarch64" ? "arm" : "x86"}-${(n % 3) + 1}.ci.acme.example`,
          sourcerpm: source ? "" : srpm,
          buildtime: seconds(b.at) - 3_600,
          installedSize: source ? size + 1_024 : info.installedSize,
          archiveSize: source ? size + 1_536 : info.installedSize + 4_096,
          headerStart: 4_504,
          headerEnd,
          provides: source ? [] : [self(name), ...(providedArch[arch] ? [self(`${name}(${providedArch[arch]})`)] : []), ...(info.provides ?? []).map((p) => rel(p))],
          requires: source
            ? [...info.buildRequires.map((r) => rel(r)), ...RPMLIB_REQUIRES.slice(0, 1)]
            : [...info.requires.map((r) => (r.startsWith("!") ? rel(r.slice(1), true) : rel(r))), ...RPMLIB_REQUIRES],
          conflicts: [],
          obsoletes: [],
          recommends: source ? [] : (info.recommends ?? []).map((r) => rel(r)),
          suggests: [],
          supplements: [],
          enhances: [],
          files,
          changelogs: history.slice(0, n + 1).reverse(),
          filename,
          size,
          sha256: sha256Hex(`rpm:${repo}/${filename}`),
        },
        createdAt: b.at,
        uploadedBy: b.by,
        referrers: source ? undefined : b.referrers,
      };
    });
  });
}

const PLATFORM = "Platform Team <platform@acme.example>";
const CI = "token:42";

export function rpmVersions(): VersionSpec[] {
  const r = "el9";
  return [
    ...rpmPackage(
      r,
      "hello",
      {
        summary: "Prints a familiar, friendly greeting",
        description:
          "The GNU Hello program produces a familiar, friendly greeting. Yes, this is another implementation of the classic program that prints \"Hello, world!\" when you run it.",
        license: "GPL-3.0-or-later",
        url: "https://www.gnu.org/software/hello/",
        vendor: "Acme",
        packager: PLATFORM,
        group: "Unspecified",
        requires: ["libc.so.6()(64bit)", "libc.so.6(GLIBC_2.34)(64bit)", "!/bin/sh", "!info"],
        buildRequires: ["gcc", "gettext", "make"],
        files: ["/usr/bin/hello", "/usr/share/doc/hello/", "/usr/share/doc/hello/NEWS", "/usr/share/info/hello.info.gz", "/usr/share/man/man1/hello.1.gz"],
        source: "hello-2.12.tar.gz",
        installedSize: 183_517,
      },
      [
        { version: "2.12-1.el9", arches: { x86_64: 77_480, aarch64: 76_902, src: 1_042_201 }, at: ago(40, 2), by: "user:admin", changelog: "- Rebuilt for EL9" },
        {
          version: "2.12.1-1.el9",
          arches: { x86_64: 77_912, aarch64: 77_318, src: 1_046_877 },
          at: ago(7, 5),
          by: "user:admin",
          referrers: ["cosign"],
          changelog: "- Update to 2.12.1",
        },
      ],
    ),
    ...rpmPackage(
      r,
      "acme-agent",
      {
        summary: "Acme host agent: metrics, logs and remote configuration",
        description: "The agent that ships host metrics and logs to the Acme platform and applies its remote configuration.",
        license: "LicenseRef-Acme-Proprietary",
        url: "https://git.acme.example/platform/acme-agent",
        vendor: "Acme",
        packager: PLATFORM,
        requires: ["glibc >= 2.34", "systemd", "!/bin/sh", "!shadow-utils"],
        recommends: ["acme-cli >= 1.7"],
        buildRequires: ["golang >= 1.23", "systemd-rpm-macros"],
        files: ["/etc/acme-agent/", "/etc/acme-agent/agent.yaml", "/usr/bin/acme-agent", "/usr/lib/systemd/system/acme-agent.service", "/var/lib/acme-agent/"],
        source: "acme-agent-2.5.0.tar.gz",
        installedSize: 41_210_880,
      },
      [
        {
          version: "2.5.0-1.el9",
          arches: { x86_64: 14_802_116, aarch64: 13_902_544 },
          at: ago(9, 2),
          by: CI,
          referrers: ["cosign", "spdx"],
          changelog: "- Remote configuration over gRPC\n- Drop the Python helper",
        },
        { version: "2.5.1-1.el9", arches: { x86_64: 14_844_008, aarch64: 13_955_270 }, at: ago(1, 3), by: CI, referrers: ["cosign"], changelog: "- Fix log rotation under SELinux" },
      ],
    ),
    // An epoch, as EL9's own nginx has: the tag escapes its colon, the file name leaves it out.
    ...rpmPackage(
      r,
      "nginx",
      {
        summary: "A high performance web server and reverse proxy server",
        description: "Nginx is a web server and a reverse proxy server for HTTP, SMTP, POP3 and IMAP protocols, with a strong focus on high concurrency, performance and low memory usage.",
        license: "BSD-2-Clause",
        url: "https://nginx.org",
        vendor: "Acme",
        packager: PLATFORM,
        group: "System Environment/Daemons",
        requires: ["libcrypt.so.2()(64bit)", "libpcre2-8.so.0()(64bit)", "libssl.so.3()(64bit)", "nginx-filesystem", "system-logos-httpd", "!systemd"],
        provides: ["webserver"],
        buildRequires: ["gcc", "openssl-devel", "pcre2-devel", "zlib-devel"],
        files: ["/etc/nginx/", "/etc/nginx/nginx.conf", "/usr/sbin/nginx", "/usr/lib/systemd/system/nginx.service", "/usr/share/nginx/html/index.html"],
        source: "nginx-1.24.0.tar.gz",
        installedSize: 1_872_384,
      },
      [
        { version: "1:1.20.1-14.el9", arches: { x86_64: 593_617, aarch64: 571_288 }, at: ago(30, 4), by: "user:admin", changelog: "- Rebuild with the Acme OpenSSL patches" },
        { version: "1:1.24.0-1.el9", arches: { x86_64: 614_903 }, at: ago(3, 1), by: "user:admin", referrers: ["cosign"], changelog: "- Update to 1.24.0" },
      ],
    ),
    ...rpmPackage(
      r,
      "acme-cli",
      {
        summary: "Command-line client for the Acme platform",
        description: "acme talks to the Acme platform: deploys, logs, secrets and the service catalogue.",
        license: "LicenseRef-Acme-Proprietary",
        url: "https://git.acme.example/platform/acme-cli",
        vendor: "Acme",
        packager: PLATFORM,
        requires: ["python3 >= 3.9", "python3-httpx", "python3-click"],
        buildRequires: ["python3-devel", "pyproject-rpm-macros"],
        files: ["/usr/bin/acme", "/usr/lib/python3.9/site-packages/acme_cli/", "/usr/lib/python3.9/site-packages/acme_cli/__init__.py"],
        source: "acme-cli-1.8.0.tar.gz",
        installedSize: 934_912,
      },
      [
        { version: "1.7.2-1.el9", arches: { noarch: 201_448 }, at: ago(33, 1), by: "user:admin", changelog: "- Fix the proxy settings" },
        { version: "1.8.0-1.el9", arches: { noarch: 208_916 }, at: ago(2, 6), by: "user:admin", changelog: "- acme secrets" },
      ],
    ),
    // Perl modules keep their capitals in the name; the OCI path lower-cases them.
    ...rpmPackage(
      r,
      "perl-Acme-Config",
      {
        summary: "Read the configuration of Acme services",
        description: "Acme::Config reads the YAML configuration of Acme services, with defaults from the environment.",
        license: "Artistic-1.0-Perl OR GPL-1.0-or-later",
        url: "https://git.acme.example/platform/perl-acme-config",
        packager: PLATFORM,
        requires: ["perl(:MODULE_COMPAT_5.32.1)", "perl(YAML::Tiny)", "perl(strict)"],
        provides: ["perl(Acme::Config) = 0.42"],
        buildRequires: ["perl-generators", "perl(ExtUtils::MakeMaker)"],
        files: ["/usr/share/perl5/vendor_perl/Acme/", "/usr/share/perl5/vendor_perl/Acme/Config.pm", "/usr/share/man/man3/Acme::Config.3pm.gz"],
        source: "Acme-Config-0.42.tar.gz",
        installedSize: 21_840,
      },
      [{ version: "0.42-3.el9", arches: { noarch: 14_207, src: 19_880 }, at: ago(70, 2), by: "user:admin", changelog: "- Rebuilt for EL9" }],
    ),
  ];
}
