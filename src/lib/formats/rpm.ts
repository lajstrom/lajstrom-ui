import { formatBytes, pluralize } from "@/lib/format";

import { curlAuth, str, TOKEN, USER } from "./common";
import type { FormatSpec, MetadataRow } from "./types";

/** A relation of the metadata layer (manifest-profile.md §2, rpm): the header's sense flags and
 * the parts of its version. */
type Relation = { name?: unknown; flags?: unknown; epoch?: unknown; version?: unknown; release?: unknown; pre?: unknown };

/** rpm's sense flags: LESS 2, GREATER 4, EQUAL 8. */
function comparison(flags: number): string {
  const sense = flags & 0x0e;
  return { 2: "<", 4: ">", 8: "=", 10: "<=", 12: ">=" }[sense] ?? "";
}

/** "glibc >= 2.34", "config(hello) = 2.12-1.el9", "/bin/sh (pre)": a relation as rpm -q --requires
 * writes it. */
function relation(r: Relation): string {
  const name = str(r.name) ?? "?";
  const op = typeof r.flags === "number" ? comparison(r.flags) : "";
  const epoch = str(r.epoch);
  const version = str(r.version);
  const release = str(r.release);
  const evr = version ? `${epoch && epoch !== "0" ? `${epoch}:` : ""}${version}${release ? `-${release}` : ""}` : "";
  return `${name}${op && evr ? ` ${op} ${evr}` : ""}${r.pre === true ? " (pre)" : ""}`;
}

function relations(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  // The rpmlib(…) features rpm itself provides, which the repodata leaves out too.
  return (v as Relation[]).filter((r) => !String(r.name ?? "").startsWith("rpmlib(")).map(relation);
}

/** The file name of a version and arch: no epoch (manifest-profile.md §2, rpm). */
function fileName(name: string, version: string, arch: string): string {
  return `${name}-${version.replace(/^\d+:/, "")}.${arch}.rpm`;
}

const isSource = (arch: string | undefined) => arch === "src" || arch === "nosrc";

// docs/spec/http-routing.md §3 rpm: the repodata of a yum repository for dnf, yum and zypper, one
// repo per distribution release with every architecture in it; repomd.xml signed with the
// repo's key, the packages keeping their own signature.
export const rpm: FormatSpec = {
  name: "rpm",
  label: "RPM",
  mark: "RPM",
  markClass: "bg-violet-500/12 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
  noun: { one: "package", many: "packages" },
  variantLabel: "Architecture",
  artifactType: "application/vnd.lajstrom.rpm.v1",
  facets: [],
  columns: [],
  connect(ctx) {
    const repo = ctx.repo.name;
    const base = `${ctx.baseUrl}/rpm/${repo}/`;
    const id = `lajstrom-${repo}`;
    const keyFile = `/etc/pki/rpm-gpg/${id}.asc`;
    // A repo that needs credentials: dnf would not send them for gpgkey, so the key is fetched
    // once into a file (docs/quickstart/rpm.md).
    const gpgkey = ctx.readNeedsAuth ? `file://${keyFile}` : `${base}repodata/repomd.xml.key`;
    const repoFile = (user: string, password: string) =>
      [
        `[${id}]`,
        `name=Lajstrom rpm/${repo}`,
        `baseurl=${base}`,
        ...(ctx.readNeedsAuth ? [`username=${user}`, `password=${password}`] : []),
        `repo_gpgcheck=1`,
        `gpgkey=${gpgkey}`,
        `gpgcheck=0`,
      ].join("\n");
    return [
      {
        title: "Add the repository",
        description:
          "dnf checks repomd.xml with this repo's own key (repo_gpgcheck); a package keeps the signature of whoever signed it (gpgcheck).",
        snippets: [
          {
            id: "dnf",
            title: "dnf",
            caption: "shell",
            shell: true,
            code: [
              ...(ctx.readNeedsAuth ? [`sudo curl -fsSL ${curlAuth(true)}-o ${keyFile} ${base}key.asc`] : []),
              `sudo tee /etc/yum.repos.d/${id}.repo >/dev/null <<EOF`,
              repoFile(USER, TOKEN),
              `EOF`,
              `sudo dnf makecache --repo ${id}`,
            ].join("\n"),
            note: ctx.readNeedsAuth ? "The shell writes your user and token into the .repo file; keep it readable by root only." : undefined,
          },
          {
            id: "repofile",
            title: ".repo file",
            caption: `/etc/yum.repos.d/${id}.repo`,
            code: repoFile("<user>", "<token>"),
            note: "For packages signed with rpmsign, set gpgcheck=1 and add the packager's key to gpgkey. Without a master key on the server the repo is unsigned: repo_gpgcheck=0.",
          },
          {
            id: "zypper",
            title: "zypper",
            caption: "shell",
            shell: true,
            code: [
              ...(ctx.readNeedsAuth
                ? [
                    `printf 'username=%s\\npassword=%s\\n' "${USER}" "${TOKEN}" | sudo tee /etc/zypp/credentials.d/${id} >/dev/null`,
                    `sudo chmod 0600 /etc/zypp/credentials.d/${id}`,
                  ]
                : []),
              `sudo zypper addrepo --gpgcheck-allow-unsigned-package '${base}${ctx.readNeedsAuth ? `?credentials=${id}` : ""}' ${id}`,
              `sudo zypper --gpg-auto-import-keys refresh ${id}`,
            ].join("\n"),
            note: "zypper fetches repodata/repomd.xml.key beside repomd.xml.asc by itself.",
          },
        ],
      },
      {
        title: "Upload a package",
        description: "A binary or a source rpm: its name, epoch, version, release and arch come from its header.",
        snippets: [
          {
            id: "upload",
            title: "curl",
            caption: "shell",
            shell: true,
            code: `curl -u "${USER}:${TOKEN}" -T ./hello-2.12-1.el9.x86_64.rpm ${base}upload`,
            note: "The same bytes again change nothing; other bytes under the same name, version and arch are a 409, and so is a file name another epoch holds.",
          },
          {
            id: "oras",
            title: "oras push",
            caption: "shell",
            shell: true,
            code: [
              `# on the server: the metadata layer the upload route writes`,
              `lajstrom admin rpm metadata hello-2.12-1.el9.x86_64.rpm > metadata.json`,
              `oras push ${ctx.host}/rpm/${repo}/hello:2.12-1.el9__x86_5f64 \\`,
              `  --artifact-type application/vnd.lajstrom.rpm.v1 \\`,
              `  --annotation lajstrom.schema=1 --annotation lajstrom.format=rpm --annotation lajstrom.repo=${repo} \\`,
              `  --annotation lajstrom.name=hello --annotation lajstrom.version=2.12-1.el9 --annotation lajstrom.variant=x86_64 \\`,
              `  --annotation org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ) \\`,
              `  hello-2.12-1.el9.x86_64.rpm:application/vnd.lajstrom.rpm.package.v1 \\`,
              `  metadata.json:application/vnd.lajstrom.rpm.metadata.v1+json`,
            ].join("\n"),
            note: "The tag is the version and the arch, escaped (x86_64 is x86_5f64); ingest checks the metadata layer against the header.",
          },
        ],
      },
    ];
  },
  install(ctx, pkg, version) {
    if (!version) {
      return [
        { id: "dnf", title: "dnf", caption: "shell", shell: true, code: `sudo dnf install ${pkg.name}` },
        { id: "zypper", title: "zypper", caption: "shell", shell: true, code: `sudo zypper install ${pkg.name}` },
        {
          id: "download",
          title: "dnf download",
          caption: "shell",
          shell: true,
          code: `dnf download ${pkg.name}`,
          note: "Downloads the .rpm for this machine's arch into the current directory without installing it.",
        },
      ];
    }
    const arch = version.variant || str(version.metadata?.arch) || "";
    const nevra = `${pkg.name}-${version.version}${arch ? `.${arch}` : ""}`;
    const file = str(version.metadata?.filename) ?? (arch ? fileName(pkg.name, version.version, arch) : null);
    const curl = file
      ? [
          {
            id: "curl",
            title: "curl",
            caption: "shell",
            shell: true,
            code: `curl ${curlAuth(ctx.readNeedsAuth)}-fLO ${ctx.baseUrl}/rpm/${ctx.repo.name}/Packages/${file}`,
          },
        ]
      : [];
    if (isSource(arch)) {
      return [
        {
          id: "source",
          title: "dnf download",
          caption: "shell",
          shell: true,
          code: `dnf download --source ${pkg.name}-${version.version}`,
          note: "A source package installs nothing; rpmbuild --rebuild makes the binaries of it.",
        },
        ...curl,
      ];
    }
    return [
      { id: "dnf", title: "dnf", caption: "shell", shell: true, code: `sudo dnf install ${nevra}` },
      { id: "zypper", title: "zypper", caption: "shell", shell: true, code: `sudo zypper install ${pkg.name}=${version.version}` },
      {
        id: "download",
        title: "dnf download",
        caption: "shell",
        shell: true,
        code: `dnf download ${nevra}`,
        note: "Downloads the .rpm into the current directory without installing it.",
      },
      ...curl,
    ];
  },
  filePath(repo, _pkg, _version, file) {
    // The location of primary.xml: Packages/<name>-<version>-<release>.<arch>.rpm.
    return `/rpm/${repo}/Packages/${file}`;
  },
  fileRole(mediaType, attrs) {
    if (!mediaType.includes("rpm.package")) return "File";
    return /\.(no)?src\.rpm$/.test(attrs["org.opencontainers.image.title"] ?? "") ? "Source package" : "RPM package";
  },
  metadataRows(m) {
    if (!m) return [];
    const rows: MetadataRow[] = [];
    const push = (label: string, value: string | string[] | null, extra: Partial<MetadataRow> = {}) => {
      if (value && (!Array.isArray(value) || value.length)) rows.push({ label, value, ...extra });
    };
    push("Summary", str(m.summary));
    push("Description", str(m.description));
    const epoch = typeof m.epoch === "number" && m.epoch > 0 ? `${m.epoch}:` : "";
    const version = str(m.version);
    push("Version", version ? `${epoch}${version}-${str(m.release) ?? ""}` : null, { mono: true });
    push("Arch", str(m.arch), { mono: true });
    push("License", str(m.license));
    const url = str(m.url);
    push("URL", url, { href: url ?? undefined });
    push("Vendor", str(m.vendor));
    push("Packager", str(m.packager));
    push("Group", str(m.group) === "Unspecified" ? null : str(m.group));
    push("Build host", str(m.buildhost), { mono: true });
    if (typeof m.buildtime === "number" && m.buildtime > 0) {
      push("Built", new Date(m.buildtime * 1000).toISOString().replace("T", " ").replace(/:\d\d\.\d+Z$/, " UTC"));
    }
    push("Source package", str(m.sourcerpm), { mono: true });
    if (typeof m.installedSize === "number" && m.installedSize > 0) push("Installed size", formatBytes(m.installedSize));
    // A source package requires what its build needs: its spec's BuildRequires.
    push(isSource(str(m.arch) ?? undefined) ? "Build requires" : "Requires", relations(m.requires), { mono: true });
    push("Provides", relations(m.provides), { mono: true });
    push("Conflicts", relations(m.conflicts), { mono: true });
    push("Obsoletes", relations(m.obsoletes), { mono: true });
    push("Recommends", relations(m.recommends), { mono: true });
    push("Suggests", relations(m.suggests), { mono: true });
    push("Supplements", relations(m.supplements), { mono: true });
    push("Enhances", relations(m.enhances), { mono: true });
    if (Array.isArray(m.files) && m.files.length) {
      const dirs = (m.files as { type?: string }[]).filter((f) => f.type === "dir").length;
      push("Files in package", [pluralize(m.files.length - dirs, "file"), ...(dirs ? [pluralize(dirs, "directory", "directories")] : [])].join(", "));
    }
    const change = Array.isArray(m.changelogs) ? (m.changelogs[0] as { author?: unknown; date?: unknown; text?: unknown } | undefined) : undefined;
    if (change) {
      const date = typeof change.date === "number" ? new Date(change.date * 1000).toISOString().slice(0, 10) : "";
      push("Latest change", [`${date} ${str(change.author) ?? ""}`.trim(), ...(str(change.text)?.split("\n") ?? [])]);
    }
    push("File", str(m.filename), { mono: true });
    return rows;
  },
};
