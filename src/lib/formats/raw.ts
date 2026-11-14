import { curlAuth, str, TOKEN, USER } from "./common";
import type { FormatSpec } from "./types";

// docs/spec/http-routing.md §3 raw: package = path, version = first 16 hex of the content sha256.
export const raw: FormatSpec = {
  name: "raw",
  label: "Raw",
  mark: "RAW",
  markClass: "bg-slate-500/12 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300",
  noun: { one: "file", many: "files" },
  variantLabel: null,
  artifactType: "application/vnd.lajstrom.raw.v1",
  facets: [],
  columns: [],
  connect(ctx) {
    const base = `${ctx.baseUrl}/raw/${ctx.repo.name}`;
    return [
      {
        title: "Upload and download with curl",
        description: "A PUT creates a new version when the bytes differ; identical bytes are a no-op.",
        snippets: [
          {
            id: "upload",
            title: "Upload",
            caption: "shell",
            shell: true,
            code: `curl -u "${USER}:${TOKEN}" -T ./report.pdf ${base}/reports/2026/report.pdf`,
          },
          {
            id: "download",
            title: "Download",
            caption: "shell",
            shell: true,
            code: `curl ${curlAuth(ctx.readNeedsAuth)}-fLO ${base}/reports/2026/report.pdf`,
            note: "Lajstrom answers with a 307 to the registry's storage when it can; -L follows it.",
          },
          {
            id: "list",
            title: "List",
            caption: "shell",
            shell: true,
            code: `curl ${curlAuth(ctx.readNeedsAuth)}-s ${base}/reports/ | jq '.entries[].path'`,
          },
        ],
      },
      {
        title: "Push with oras",
        description: "The same artifact through the OCI facade; the annotations are the manifest profile's.",
        snippets: [
          {
            id: "oras",
            title: "oras push",
            caption: "shell",
            shell: true,
            code: [
              `# the version of a raw file is the first 16 hex digits of its sha256`,
              `v=$(sha256sum report.pdf | cut -c1-16)`,
              `oras push ${ctx.host}/raw/${ctx.repo.name}/reports/2026/report.pdf:$v \\`,
              `  --artifact-type application/vnd.lajstrom.raw.v1 \\`,
              `  --annotation lajstrom.schema=1 --annotation lajstrom.format=raw \\`,
              `  --annotation lajstrom.repo=${ctx.repo.name} --annotation lajstrom.name=reports/2026/report.pdf \\`,
              `  --annotation lajstrom.raw.path=reports/2026/report.pdf --annotation lajstrom.version=$v \\`,
              `  report.pdf:application/vnd.lajstrom.raw.file.v1`,
            ].join("\n"),
          },
        ],
      },
    ];
  },
  install(ctx, pkg, version) {
    const url = `${ctx.baseUrl}/raw/${ctx.repo.name}/${pkg.name}`;
    const pinned = version ? `"${url}?digest=${version.digest}"` : url;
    return [
      {
        id: "curl",
        title: "curl",
        caption: "shell",
        shell: true,
        code: `curl ${curlAuth(ctx.readNeedsAuth)}-fLO ${version ? pinned : url}`,
        note: version
          ? "?digest= pins this version; without it the path resolves to the newest one."
          : "The path always resolves to the newest version.",
      },
      {
        id: "wget",
        title: "wget",
        caption: "shell",
        shell: true,
        code: ctx.readNeedsAuth
          ? `wget --user "${USER}" --password "${TOKEN}" ${version ? pinned : url}`
          : `wget ${version ? pinned : url}`,
      },
    ];
  },
  filePath(repo, pkg, version) {
    // ?digest= pins the version; without it the path is the newest (http-routing.md §3, raw).
    return `/raw/${repo}/${pkg}?digest=${version.files[0]?.digest ?? version.digest}`;
  },
  fileRole() {
    return "File";
  },
  metadataRows(m) {
    if (!m) return [];
    return [
      { label: "Path", value: str(m.path) ?? "—", mono: true },
      { label: "Content type", value: str(m.contentType) ?? "—", mono: true },
      { label: "SHA-256", value: str(m.sha256) ?? "—", mono: true },
    ];
  },
};
