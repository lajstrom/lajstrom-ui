import { str } from "./common";
import type { FormatSpec, MetadataRow } from "./types";

/** The role of a file layer from its media type, application/vnd.lajstrom.<type>.<role>.v1…
 * (manifest-profile.md §2): "package", "tarball". */
function role(mediaType: string): string | null {
  const m = /^application\/vnd\.lajstrom\.[a-z0-9]+\.([a-z0-9-]+)\.v\d/.exec(mediaType);
  return m ? m[1]! : null;
}

/**
 * The module of a format the UI does not know (a server newer than the UI: nuget, cargo, …): its
 * packages, versions and files, from what every format's manifest has (manifest-profile.md
 * §1–4), and no client snippets, which only a module of the format can write.
 */
export function generic(name: string): FormatSpec {
  return {
    name,
    label: name,
    mark: name.slice(0, 3).toUpperCase() || "?",
    markClass: "bg-stone-500/12 text-stone-600 dark:bg-stone-400/15 dark:text-stone-300",
    noun: { one: "package", many: "packages" },
    variantLabel: null,
    artifactType: `application/vnd.lajstrom.${name}.v1`,
    facets: [],
    columns: [],
    connect: () => [],
    install: () => [],
    filePath: () => null,
    fileRole(mediaType) {
      const r = role(mediaType);
      return r ? `${r[0]!.toUpperCase()}${r.slice(1)}` : "File";
    },
    metadataRows(m) {
      if (!m) return [];
      // The top-level strings and numbers of metadata.json; the rest is under "Show metadata.json".
      const rows: MetadataRow[] = [];
      for (const [key, value] of Object.entries(m)) {
        const s = typeof value === "object" ? null : str(value);
        // Summary and Description by those names: the package page takes its line from them.
        const prose = key === "summary" || key === "description";
        const label = prose ? `${key[0]!.toUpperCase()}${key.slice(1)}` : key;
        if (s) rows.push({ label, value: s, mono: !prose && (typeof value !== "string" || /^[\w.:+~-]+$/.test(s)) });
      }
      return rows.slice(0, 12);
    },
  };
}
