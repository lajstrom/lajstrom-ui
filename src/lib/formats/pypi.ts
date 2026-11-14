import { normalizePypi } from "@/lib/profile";

import { str, strList, TOKEN, USER } from "./common";
import type { FormatSpec, MetadataRow } from "./types";

// docs/spec/http-routing.md §3 pypi: PEP 503, 691, 658 and the legacy upload API (twine).
export const pypi: FormatSpec = {
  name: "pypi",
  label: "PyPI",
  mark: "PY",
  markClass: "bg-[#3572a5]/12 text-[#2b5f8c] dark:bg-[#5b9bd5]/15 dark:text-[#8dbbe8]",
  noun: { one: "project", many: "projects" },
  variantLabel: "Wheel tag",
  artifactType: "application/vnd.lajstrom.pypi.v1",
  facets: [],
  columns: [{ key: "requiresPython", label: "Python" }],
  connect(ctx) {
    const index = `${ctx.baseUrl}/pypi/${ctx.repo.name}/simple/`;
    const authIndex = ctx.readNeedsAuth
      ? index.replace("://", `://${USER}:${TOKEN}@`)
      : index;
    return [
      {
        title: "Install",
        description: ctx.readNeedsAuth
          ? "Credentials: a user and a personal access token, or a deploy token."
          : "This repo is readable without credentials.",
        snippets: [
          { id: "pip", title: "pip", caption: "shell", shell: true, code: `pip install --index-url ${authIndex} <project>` },
          { id: "uv", title: "uv", caption: "shell", shell: true, code: `uv pip install --index-url ${authIndex} <project>` },
          {
            id: "pipconf",
            title: "pip.conf",
            caption: "~/.config/pip/pip.conf",
            code: `[global]\nindex-url = ${authIndex}`,
          },
          {
            id: "pyproject",
            title: "pyproject.toml (uv)",
            caption: "pyproject.toml",
            code: `[[tool.uv.index]]\nname = "${ctx.repo.name}"\nurl = "${index}"\ndefault = true`,
            note: ctx.readNeedsAuth
              ? `Credentials: UV_INDEX_${ctx.repo.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_USERNAME and …_PASSWORD.`
              : undefined,
          },
        ],
      },
      {
        title: "Publish",
        description: "One file is one manifest: the wheel tag or sdist is the variant.",
        snippets: [
          {
            id: "twine",
            title: "twine",
            caption: "shell",
            shell: true,
            code: `twine upload --repository-url ${ctx.baseUrl}/pypi/${ctx.repo.name}/ \\\n  -u "${USER}" -p "${TOKEN}" dist/*`,
          },
          {
            id: "pypirc",
            title: ".pypirc",
            caption: "~/.pypirc",
            code: `[distutils]\nindex-servers = ${ctx.repo.name}\n\n[${ctx.repo.name}]\nrepository = ${ctx.baseUrl}/pypi/${ctx.repo.name}/\nusername = <user>\npassword = <token>`,
          },
          {
            id: "uvpublish",
            title: "uv publish",
            caption: "shell",
            shell: true,
            code: `uv publish --publish-url ${ctx.baseUrl}/pypi/${ctx.repo.name}/ \\\n  -u "${USER}" -p "${TOKEN}"`,
          },
        ],
      },
    ];
  },
  install(ctx, pkg, version) {
    const index = `${ctx.baseUrl}/pypi/${ctx.repo.name}/simple/`;
    const authIndex = ctx.readNeedsAuth ? index.replace("://", `://${USER}:${TOKEN}@`) : index;
    const spec = version ? `${normalizePypi(pkg.name)}==${version.version}` : normalizePypi(pkg.name);
    return [
      { id: "pip", title: "pip", caption: "shell", shell: true, code: `pip install --index-url ${authIndex} ${spec}` },
      { id: "uv", title: "uv", caption: "shell", shell: true, code: `uv add --index ${index} ${spec}` },
      {
        id: "requirements",
        title: "requirements.txt",
        caption: "requirements.txt",
        code: `--index-url ${authIndex}\n${spec}`,
      },
    ];
  },
  filePath(repo, pkg, version, file) {
    return `/pypi/${repo}/files/${normalizePypi(pkg)}/${version.version}/${file}`;
  },
  fileRole(mediaType) {
    if (mediaType.includes("pypi.wheel")) return "Wheel";
    if (mediaType.includes("pypi.sdist")) return "Source distribution";
    return "File";
  },
  metadataRows(m) {
    if (!m) return [];
    const rows: MetadataRow[] = [];
    const push = (label: string, v: unknown, mono = false) => {
      const s = Array.isArray(v) ? strList(v) : str(v);
      if (s && (!Array.isArray(s) || s.length)) rows.push({ label, value: s, mono });
    };
    push("Summary", m.summary);
    push("Requires Python", m.requires_python, true);
    push("License", m.license_expression ?? m.license);
    push("Author", m.author ?? m.author_email);
    push("Home page", m.home_page);
    if (m.project_urls && typeof m.project_urls === "object") {
      for (const [k, v] of Object.entries(m.project_urls as Record<string, string>)) {
        rows.push({ label: k, value: v, href: v });
      }
    }
    push("Requires", m.requires_dist, true);
    push("Classifiers", m.classifiers);
    push("Package type", m.packagetype, true);
    push("File", m.filename, true);
    return rows;
  },
};
