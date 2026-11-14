import { str } from "./common";
import type { FormatSpec, MetadataRow } from "./types";

function coords(name: string): { groupId: string; artifactId: string } {
  const [groupId = "", artifactId = ""] = name.split(":");
  return { groupId, artifactId };
}

// docs/spec/http-routing.md §3 maven: Maven 2 layout, releases only in the MVP; a deploy is a
// publication session committed by maven-metadata.xml.
export const maven: FormatSpec = {
  name: "maven",
  label: "Maven",
  mark: "MVN",
  markClass: "bg-[#e76f00]/12 text-[#b45309] dark:bg-[#f0883e]/15 dark:text-[#f5a66b]",
  noun: { one: "artifact", many: "artifacts" },
  variantLabel: null,
  artifactType: "application/vnd.lajstrom.maven.v1",
  facets: [{ key: "maven.packaging", label: "Packaging" }],
  columns: [{ key: "maven.packaging", label: "Packaging" }],
  connect(ctx) {
    const url = `${ctx.baseUrl}/maven/${ctx.repo.name}`;
    const id = `lajstrom-${ctx.repo.name}`;
    return [
      {
        title: "Resolve dependencies",
        description: ctx.readNeedsAuth
          ? "Put the credentials in settings.xml under the same <id> as the repository."
          : "This repo is readable without credentials.",
        snippets: [
          {
            id: "pom",
            title: "pom.xml",
            caption: "pom.xml",
            code: [
              `<repositories>`,
              `  <repository>`,
              `    <id>${id}</id>`,
              `    <url>${url}</url>`,
              `    <snapshots><enabled>false</enabled></snapshots>`,
              `  </repository>`,
              `</repositories>`,
            ].join("\n"),
          },
          {
            id: "gradle",
            title: "Gradle (Kotlin)",
            caption: "build.gradle.kts",
            code: [
              `repositories {`,
              `    maven {`,
              `        url = uri("${url}")`,
              ...(ctx.readNeedsAuth
                ? [
                    `        credentials {`,
                    `            username = providers.environmentVariable("LAJSTROM_USER").get()`,
                    `            password = providers.environmentVariable("LAJSTROM_TOKEN").get()`,
                    `        }`,
                  ]
                : []),
              `    }`,
              `}`,
            ].join("\n"),
          },
          {
            id: "settings",
            title: "settings.xml",
            caption: "~/.m2/settings.xml",
            code: [
              `<settings>`,
              `  <servers>`,
              `    <server>`,
              `      <id>${id}</id>`,
              `      <username>\${env.LAJSTROM_USER}</username>`,
              `      <password>\${env.LAJSTROM_TOKEN}</password>`,
              `    </server>`,
              `  </servers>`,
              `</settings>`,
            ].join("\n"),
          },
        ],
      },
      {
        title: "Deploy",
        description:
          "mvn deploy uploads file by file; the PUT of maven-metadata.xml commits the version as one manifest.",
        snippets: [
          {
            id: "dm",
            title: "pom.xml",
            caption: "pom.xml",
            code: [
              `<distributionManagement>`,
              `  <repository>`,
              `    <id>${id}</id>`,
              `    <url>${url}</url>`,
              `  </repository>`,
              `</distributionManagement>`,
            ].join("\n"),
          },
          { id: "deploy", title: "mvn", caption: "shell", shell: true, code: `mvn deploy` },
          {
            id: "gradle-publish",
            title: "Gradle",
            caption: "build.gradle.kts",
            code: [
              `publishing {`,
              `    repositories {`,
              `        maven {`,
              `            name = "${ctx.repo.name}"`,
              `            url = uri("${url}")`,
              `            credentials(PasswordCredentials::class)`,
              `        }`,
              `    }`,
              `}`,
            ].join("\n"),
            note: `Gradle reads ${ctx.repo.name}Username and ${ctx.repo.name}Password from gradle.properties.`,
          },
        ],
      },
    ];
  },
  install(_ctx, pkg, version) {
    const { groupId, artifactId } = coords(pkg.name);
    const v = version?.version ?? pkg.latestVersion ?? "<version>";
    const packaging = version?.attrs?.["lajstrom.maven.packaging"] ?? pkg.attrs?.["maven.packaging"];
    const typeLine = packaging && packaging !== "jar" ? [`  <type>${packaging}</type>`] : [];
    return [
      {
        id: "maven",
        title: "Maven",
        caption: "pom.xml",
        code: [
          `<dependency>`,
          `  <groupId>${groupId}</groupId>`,
          `  <artifactId>${artifactId}</artifactId>`,
          `  <version>${v}</version>`,
          ...typeLine,
          `</dependency>`,
        ].join("\n"),
      },
      { id: "gradle", title: "Gradle", caption: "build.gradle.kts", code: `implementation("${groupId}:${artifactId}:${v}")` },
      {
        id: "get",
        title: "mvn dependency:get",
        caption: "shell",
        shell: true,
        code: `mvn dependency:get -Dartifact=${groupId}:${artifactId}:${v}`,
      },
    ];
  },
  filePath(repo, pkg, version, file) {
    const { groupId, artifactId } = coords(pkg);
    return `/maven/${repo}/${groupId.replaceAll(".", "/")}/${artifactId}/${version.version}/${file}`;
  },
  fileRole(mediaType, attrs) {
    if (mediaType.includes("maven.pom")) return "POM";
    const classifier = attrs["lajstrom.maven.classifier"];
    const ext = attrs["lajstrom.maven.extension"] ?? "jar";
    if (classifier === "sources") return "Sources jar";
    if (classifier === "javadoc") return "Javadoc jar";
    if (classifier) return `${ext} (${classifier})`;
    return ext === "jar" ? "Jar" : ext.toUpperCase();
  },
  metadataRows(m) {
    if (!m) return [];
    const rows: MetadataRow[] = [];
    const push = (label: string, v: unknown, mono = false) => {
      const s = str(v);
      if (s) rows.push({ label, value: s, mono });
    };
    push("Group", m.groupId, true);
    push("Artifact", m.artifactId, true);
    push("Version", m.version, true);
    push("Packaging", m.packaging, true);
    const pom = (m.pom ?? {}) as Record<string, unknown>;
    push("Name", pom.name);
    push("Description", pom.description);
    if (pom.parent && typeof pom.parent === "object") {
      const p = pom.parent as Record<string, string>;
      rows.push({ label: "Parent", value: `${p.groupId}:${p.artifactId}:${p.version}`, mono: true });
    }
    push("License", pom.license);
    if (Array.isArray(pom.dependencies) && pom.dependencies.length) {
      rows.push({
        label: "Dependencies",
        mono: true,
        value: (pom.dependencies as Record<string, string>[]).map(
          (d) => `${d.groupId}:${d.artifactId}:${d.version}${d.scope && d.scope !== "compile" ? ` (${d.scope})` : ""}`,
        ),
      });
    }
    return rows;
  },
};
