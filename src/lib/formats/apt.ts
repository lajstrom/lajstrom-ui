import { str, TOKEN, USER } from "./common";
import type { FormatSpec, MetadataRow } from "./types";

// docs/spec/http-routing.md §3 apt: signed Release/InRelease per repo, suites and components are
// upload metadata, the pool is resolved by file name.
export const apt: FormatSpec = {
  name: "apt",
  label: "APT",
  mark: "DEB",
  markClass: "bg-[#c2185b]/10 text-[#ad1457] dark:bg-[#f06292]/15 dark:text-[#f48fb1]",
  noun: { one: "package", many: "packages" },
  variantLabel: "Architecture",
  artifactType: "application/vnd.lajstrom.deb.v1",
  facets: [
    { key: "deb.suite", label: "Suite" },
    { key: "deb.component", label: "Component" },
    { key: "deb.arch", label: "Architecture" },
  ],
  columns: [
    { key: "deb.suite", label: "Suite" },
    { key: "deb.component", label: "Component" },
  ],
  connect(ctx) {
    const repo = ctx.repo.name;
    const base = `${ctx.baseUrl}/apt/${repo}`;
    const host = new URL(ctx.baseUrl).host;
    const suites = ctx.facets?.["deb.suite"]?.map((f) => f.value) ?? [];
    const suite = suites[0] ?? "jammy";
    const components = ctx.facets?.["deb.component"]?.map((f) => f.value).join(" ") || "main";
    return [
      {
        title: "Add the repository",
        description: "The index is signed with this repo's own GPG key; apt checks it with signed-by.",
        snippets: [
          {
            id: "sources",
            title: "sources.list",
            caption: "shell",
            shell: true,
            code: [
              `sudo install -d -m 0755 /etc/apt/keyrings`,
              `curl -fsSL ${base}/key.asc | sudo tee /etc/apt/keyrings/${repo}.asc >/dev/null`,
              `echo "deb [signed-by=/etc/apt/keyrings/${repo}.asc] ${base} ${suite} ${components}" \\`,
              `  | sudo tee /etc/apt/sources.list.d/${repo}.list`,
              `sudo apt-get update`,
            ].join("\n"),
          },
          {
            id: "deb822",
            title: "deb822 (.sources)",
            caption: `/etc/apt/sources.list.d/${repo}.sources`,
            code: [
              `Types: deb`,
              `URIs: ${base}`,
              `Suites: ${suites.length ? suites.join(" ") : suite}`,
              `Components: ${components}`,
              `Signed-By: /etc/apt/keyrings/${repo}.asc`,
            ].join("\n"),
          },
          ...(ctx.readNeedsAuth
            ? [
                {
                  id: "auth",
                  title: "auth.conf",
                  caption: `/etc/apt/auth.conf.d/${repo}.conf`,
                  code: `machine ${host}/apt/${repo}\nlogin <user>\npassword <token>`,
                  note: "apt reads credentials from auth.conf.d; keep the file mode 0600.",
                },
              ]
            : []),
        ],
      },
      {
        title: "Publish a .deb",
        description: "Suite and component are properties of the upload, not separate repos.",
        snippets: [
          {
            id: "upload",
            title: "curl",
            caption: "shell",
            shell: true,
            code: `curl -u "${USER}:${TOKEN}" -T ./hello_2.10-3_amd64.deb \\\n  "${base}/upload?suite=${suite}&component=main"`,
          },
        ],
      },
    ];
  },
  install(_ctx, pkg, version) {
    const spec = version ? `${pkg.name}=${version.version}` : pkg.name;
    return [
      { id: "apt", title: "apt-get", caption: "shell", shell: true, code: `sudo apt-get install ${spec}` },
      {
        id: "download",
        title: "apt download",
        caption: "shell",
        shell: true,
        code: `apt-get download ${spec}`,
        note: "Downloads the .deb into the current directory without installing it.",
      },
    ];
  },
  filePath(repo, pkg, version, file) {
    // The pool lays files out by source package: the control file's Source, else the name;
    // its first letter, or four for a lib* source (http-routing.md §3, apt).
    const control = version.metadata?.control as Record<string, string> | undefined;
    const source = control?.Source?.split(" ")[0] || pkg;
    const component = version.attrs?.["lajstrom.deb.component"] ?? "main";
    const p = source.startsWith("lib") && source.length > 3 ? source.slice(0, 4) : source.slice(0, 1);
    return `/apt/${repo}/pool/${component}/${p}/${source}/${file}`;
  },
  fileRole(mediaType) {
    if (mediaType.includes("deb.package")) return "Debian package";
    return "File";
  },
  metadataRows(m) {
    if (!m) return [];
    const control = (m.control ?? {}) as Record<string, unknown>;
    const rows: MetadataRow[] = [];
    const order = [
      "Package",
      "Version",
      "Architecture",
      "Maintainer",
      "Installed-Size",
      "Depends",
      "Pre-Depends",
      "Recommends",
      "Suggests",
      "Conflicts",
      "Provides",
      "Section",
      "Priority",
      "Homepage",
      "Description",
    ];
    for (const key of order) {
      const v = str(control[key]);
      if (!v) continue;
      if (["Depends", "Pre-Depends", "Recommends", "Suggests", "Conflicts", "Provides"].includes(key)) {
        rows.push({ label: key, value: v.split(/,\s*/), mono: true });
      } else {
        rows.push({
          label: key,
          value: key === "Installed-Size" ? `${v} KiB` : v,
          mono: ["Package", "Version", "Architecture"].includes(key),
          href: key === "Homepage" ? v : undefined,
        });
      }
    }
    const md5 = m.md5sums && typeof m.md5sums === "object" ? Object.keys(m.md5sums as object).length : 0;
    if (md5) rows.push({ label: "Files in package", value: `${md5} (md5sums)` });
    return rows;
  },
};
