import { npmScope } from "@/lib/profile";

import { str, strList } from "./common";
import type { FormatSpec, MetadataRow, SnippetContext } from "./types";

/** npm and yarn expand ${VAR} in .npmrc and .yarnrc.yml, so the files can be committed. */
const ENV_TOKEN = "${LAJSTROM_TOKEN}";

/** The registry URL of the repo, with its trailing slash, as npm wants it. */
function registryOf(ctx: SnippetContext): string {
  return `${ctx.baseUrl}/npm/${ctx.repo.name}/`;
}

/** The _authToken line of .npmrc: npm keys credentials by the registry URL without its scheme. */
function authLine(registry: string): string {
  return `${registry.replace(/^https?:/, "")}:_authToken=${ENV_TOKEN}`;
}

/** A person of package.json: "Name <mail> (url)" or {name, email, url}. */
function person(v: unknown): string | null {
  if (typeof v === "string") return v || null;
  if (v && typeof v === "object") {
    const p = v as Record<string, unknown>;
    const name = str(p.name);
    const email = str(p.email);
    return name ? (email ? `${name} <${email}>` : name) : email;
  }
  return null;
}

/** A dependency map as lines: "react ^18.2.0". */
function deps(v: unknown): string[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).map(([k, range]) => `${k} ${typeof range === "string" ? range : JSON.stringify(range)}`);
}

/** The URL of package.json's repository: a string, or {type, url}; git+https becomes https. */
function repositoryUrl(v: unknown): string | null {
  const url = typeof v === "string" ? v : v && typeof v === "object" ? str((v as Record<string, unknown>).url) : null;
  return url ? url.replace(/^git\+/, "") : null;
}

// docs/spec/http-routing.md §3 npm: the registry API of npm 10 and 11, pnpm and yarn 4; a scoped
// name is one package, @scope/name; dist-tags and deprecations are the package's journal
// (manifest-profile.md §8), its pointers in the API.
export const npm: FormatSpec = {
  name: "npm",
  label: "npm",
  mark: "NPM",
  markClass: "bg-[#cb3837]/10 text-[#b52f2f] dark:bg-[#f87171]/15 dark:text-[#fca5a5]",
  noun: { one: "package", many: "packages" },
  variantLabel: null,
  artifactType: "application/vnd.lajstrom.npm.v1",
  facets: [],
  columns: [],
  connect(ctx) {
    const registry = registryOf(ctx);
    // yarn names a registry without the trailing slash.
    const yarnRegistry = registry.replace(/\/$/, "");
    return [
      {
        title: "Install from this repo",
        description: ctx.readNeedsAuth
          ? "npm sends the token as a bearer: a personal access token, or a deploy token of this repo."
          : "This repo is readable without credentials; publishing needs the token.",
        snippets: [
          {
            id: "npmrc",
            title: ".npmrc (npm, pnpm)",
            caption: ".npmrc",
            code: `registry=${registry}\n${authLine(registry)}`,
            note: `npm and pnpm read ${ENV_TOKEN} from the environment, so the file can be committed.`,
          },
          {
            id: "scoped",
            title: "One scope only",
            caption: ".npmrc",
            code: `@<scope>:registry=${registry}\n${authLine(registry)}`,
            note: "The packages of @<scope> come from this repo, every other one from the default registry.",
          },
          {
            id: "login",
            title: "npm login",
            caption: "shell",
            shell: true,
            code: `npm login --registry=${registry}`,
            note: "Asks for your user name and password, and keeps the personal access token Lajstrom answers with as _authToken.",
          },
          {
            id: "yarnrc",
            title: "yarn 4",
            caption: ".yarnrc.yml",
            code: [
              `npmRegistryServer: "${yarnRegistry}"`,
              `npmRegistries:`,
              `  "${yarnRegistry}":`,
              ...(ctx.readNeedsAuth ? [`    npmAlwaysAuth: true`] : []),
              `    npmAuthToken: "${ENV_TOKEN}"`,
              `npmPreapprovedPackages: ["@<scope>/*"]`,
            ].join("\n"),
            note: "yarn holds back a version published in the last day; npmPreapprovedPackages lifts that for your own scopes.",
          },
        ],
      },
      {
        title: "Publish",
        description: "One version per publish, immutable once it is there; dist-tags move, versions never do.",
        snippets: [
          {
            id: "publish",
            title: "npm publish",
            caption: "shell",
            shell: true,
            code: `npm publish --registry=${registry}`,
            note: "With the token in .npmrc. --tag beta publishes without moving latest; --provenance is refused.",
          },
          {
            id: "publishconfig",
            title: "publishConfig",
            caption: "package.json",
            code: `"publishConfig": {\n  "registry": "${registry}"\n}`,
            note: "npm, pnpm and yarn publish there without a flag.",
          },
          {
            id: "disttag",
            title: "dist-tags",
            caption: "shell",
            shell: true,
            code: [
              `npm dist-tag add <package>@<version> beta --registry=${registry}`,
              `npm dist-tag ls <package> --registry=${registry}`,
            ].join("\n"),
            note: "Each change is an entry of the package's journal in the registry. latest moves; it is never removed.",
          },
        ],
      },
    ];
  },
  install(ctx, pkg, version) {
    const registry = registryOf(ctx);
    const spec = version ? `${pkg.name}@${version.version}` : pkg.name;
    const [scope] = npmScope(pkg.name);
    const where = scope ? `@${scope} on this repo` : "this repo as the registry";
    return [
      { id: "npm", title: "npm", caption: "shell", shell: true, code: `npm install ${spec}`, note: `With ${where} in .npmrc.` },
      { id: "pnpm", title: "pnpm", caption: "shell", shell: true, code: `pnpm add ${spec}` },
      { id: "yarn", title: "yarn", caption: "shell", shell: true, code: `yarn add ${spec}` },
      {
        id: "npmrc",
        title: ".npmrc",
        caption: ".npmrc",
        code: [`${scope ? `@${scope}:` : ""}registry=${registry}`, ...(ctx.readNeedsAuth ? [authLine(registry)] : [])].join("\n"),
      },
    ];
  },
  filePath(repo, pkg, _version, file) {
    // dist.tarball: the scope's / as it is (http-routing.md §3, npm).
    return `/npm/${repo}/${pkg}/-/${file}`;
  },
  fileRole(mediaType) {
    if (mediaType.includes("npm.tarball")) return "Package tarball";
    return "File";
  },
  metadataRows(m) {
    if (!m) return [];
    const doc = (m.manifest && typeof m.manifest === "object" ? m.manifest : {}) as Record<string, unknown>;
    const rows: MetadataRow[] = [];
    const push = (label: string, value: string | string[] | null, extra: Partial<MetadataRow> = {}) => {
      if (value && (!Array.isArray(value) || value.length)) rows.push({ label, value, ...extra });
    };
    push("Description", str(doc.description));
    push("License", str(doc.license));
    push("Author", person(doc.author));
    const homepage = str(doc.homepage);
    push("Homepage", homepage, { href: homepage ?? undefined });
    const repository = repositoryUrl(doc.repository);
    push("Repository", repository, { href: repository?.startsWith("https://") ? repository : undefined });
    push("Keywords", strList(doc.keywords).join(", ") || null);
    push("Dependencies", deps(doc.dependencies), { mono: true });
    push("Peer dependencies", deps(doc.peerDependencies), { mono: true });
    push("Optional dependencies", deps(doc.optionalDependencies), { mono: true });
    push("Engines", deps(doc.engines), { mono: true });
    const bin = typeof doc.bin === "string" ? [npmScope(str(m.name) ?? "")[1]] : doc.bin && typeof doc.bin === "object" ? Object.keys(doc.bin) : [];
    push("Commands", bin, { mono: true });
    if (m.hasInstallScript === true) push("Install script", "yes: npm runs it on install");
    if (m.hasShrinkwrap === true) push("Shrinkwrap", "npm-shrinkwrap.json pins its dependencies");
    push("Integrity", str(m.integrity), { mono: true });
    push("Shasum", str(m.shasum), { mono: true });
    push("File", str(m.filename), { mono: true });
    return rows;
  },
};
