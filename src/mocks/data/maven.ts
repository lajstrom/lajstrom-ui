import { sha256Hex } from "@/lib/sha256";

import type { FileSpec, ReferrerSpec, VersionSpec } from "./builders";
import { ago } from "./time";

type Pom = {
  name: string;
  description?: string;
  parent?: { groupId: string; artifactId: string; version: string };
  dependencies?: { groupId: string; artifactId: string; version: string; scope?: string }[];
  license?: string;
};

type MavenRelease = {
  version: string;
  /** "" is the main artifact; other keys are classifiers. Values: size in bytes. */
  artifacts: Record<string, number>;
  pomSize: number;
  at: string;
  by: string;
  referrers?: ReferrerSpec[];
};

/** One manifest per version (maven has no variant): all files of the deploy session. */
function artifact(
  repo: string,
  coords: string,
  packaging: "jar" | "pom" | "war",
  pom: Pom,
  releases: MavenRelease[],
): VersionSpec[] {
  const [groupId = "", artifactId = ""] = coords.split(":");
  return releases.map((rel): VersionSpec => {
    const ext = packaging === "pom" ? null : packaging;
    const files: FileSpec[] = [];
    if (ext) {
      for (const [classifier, size] of Object.entries(rel.artifacts)) {
        const extension = classifier === "sources" || classifier === "javadoc" ? "jar" : ext;
        files.push({
          name: `${artifactId}-${rel.version}${classifier ? `-${classifier}` : ""}.${extension}`,
          mediaType: "application/vnd.lajstrom.maven.artifact.v1",
          size,
          attrs: {
            "lajstrom.maven.extension": extension,
            ...(classifier ? { "lajstrom.maven.classifier": classifier } : {}),
          },
        });
      }
    }
    files.push({
      name: `${artifactId}-${rel.version}.pom`,
      mediaType: "application/vnd.lajstrom.maven.pom.v1+xml",
      size: rel.pomSize,
    });
    return {
      format: "maven",
      repo,
      name: coords,
      version: rel.version,
      files,
      metadata: {
        groupId,
        artifactId,
        version: rel.version,
        packaging,
        files: files.map((f) => ({
          name: f.name,
          extension: f.attrs?.["lajstrom.maven.extension"] ?? "pom",
          classifier: f.attrs?.["lajstrom.maven.classifier"] ?? "",
          sha1: sha256Hex(`sha1:${f.name}`).slice(0, 40),
          md5: sha256Hex(`md5:${f.name}`).slice(0, 32),
          sha256: sha256Hex(`maven:${f.name}`),
          size: f.size,
        })),
        pom,
      },
      attrs: { "maven.groupId": groupId, "maven.artifactId": artifactId, "maven.packaging": packaging },
      createdAt: rel.at,
      uploadedBy: rel.by,
      referrers: rel.referrers,
    };
  });
}

const PARENT = { groupId: "com.acme", artifactId: "acme-parent", version: "8" };

export function mavenVersions(): VersionSpec[] {
  const releases = "releases";
  const payments = "payments";
  return [
    ...artifact(
      releases,
      "com.example:lib-core",
      "jar",
      {
        name: "Example Core Library",
        description: "Core utilities shared across example services",
        parent: PARENT,
        license: "Apache-2.0",
        dependencies: [
          { groupId: "org.slf4j", artifactId: "slf4j-api", version: "2.0.13" },
          { groupId: "com.fasterxml.jackson.core", artifactId: "jackson-databind", version: "2.17.1" },
          { groupId: "org.junit.jupiter", artifactId: "junit-jupiter", version: "5.10.2", scope: "test" },
        ],
      },
      [
        { version: "1.1.0", artifacts: { "": 184_220, sources: 120_031, javadoc: 402_118 }, pomSize: 3_904, at: ago(70, 2), by: "user:carol" },
        {
          version: "1.2.0",
          artifacts: { "": 191_532, sources: 124_906, javadoc: 418_440 },
          pomSize: 4_012,
          at: ago(14, 5),
          by: "user:carol",
          referrers: ["cosign"],
        },
      ],
    ),
    ...artifact(
      releases,
      "com.acme:acme-parent",
      "pom",
      { name: "Acme parent POM", description: "Shared plugin and dependency management for Acme builds", license: "Apache-2.0" },
      [
        { version: "7", artifacts: {}, pomSize: 21_402, at: ago(200), by: "user:admin" },
        { version: "8", artifacts: {}, pomSize: 22_918, at: ago(40, 3), by: "user:carol" },
      ],
    ),
    ...artifact(
      releases,
      "com.acme.platform:platform-bom",
      "pom",
      { name: "Acme platform BOM", description: "Versions of every platform library, tested together", parent: PARENT },
      [
        { version: "2026.10.0", artifacts: {}, pomSize: 9_311, at: ago(35, 1), by: "user:carol" },
        { version: "2026.11.0", artifacts: {}, pomSize: 9_604, at: ago(5, 2), by: "user:carol" },
      ],
    ),
    ...artifact(
      releases,
      "com.acme.platform:observability-starter",
      "jar",
      {
        name: "Acme observability starter",
        description: "Spring Boot auto-configuration for metrics, traces and structured logs",
        parent: PARENT,
        dependencies: [
          { groupId: "io.micrometer", artifactId: "micrometer-core", version: "1.13.0" },
          { groupId: "io.opentelemetry", artifactId: "opentelemetry-api", version: "1.38.0" },
          { groupId: "org.springframework.boot", artifactId: "spring-boot-autoconfigure", version: "3.3.0", scope: "provided" },
        ],
      },
      [
        { version: "3.4.0", artifacts: { "": 88_420, sources: 61_090 }, pomSize: 5_120, at: ago(28, 2), by: "user:carol" },
        {
          version: "3.4.1",
          artifacts: { "": 89_016, sources: 61_402 },
          pomSize: 5_120,
          at: ago(3, 1),
          by: "user:carol",
          referrers: ["cosign", "cyclonedx"],
        },
      ],
    ),
    ...artifact(
      releases,
      "com.acme.tools:schema-cli",
      "jar",
      {
        name: "Schema CLI",
        description: "Validates and diffs OpenAPI and Avro schemas",
        parent: PARENT,
        dependencies: [{ groupId: "info.picocli", artifactId: "picocli", version: "4.7.6" }],
      },
      [{ version: "1.0.0", artifacts: { "": 64_118, shaded: 9_884_206 }, pomSize: 3_380, at: ago(10, 6), by: "user:carol" }],
    ),
    ...artifact(
      releases,
      "org.example:demo-webapp",
      "war",
      { name: "Demo web application", description: "Sample servlet application for the platform docs" },
      [{ version: "0.9.0", artifacts: { "": 18_402_990 }, pomSize: 6_201, at: ago(16, 4), by: "user:admin" }],
    ),
    ...artifact(
      payments,
      "com.acme.payments:payments-api",
      "jar",
      {
        name: "Payments API",
        description: "Public contracts of the payments service: DTOs, clients, error codes",
        parent: PARENT,
        dependencies: [
          { groupId: "com.example", artifactId: "lib-core", version: "1.2.0" },
          { groupId: "jakarta.validation", artifactId: "jakarta.validation-api", version: "3.1.0" },
        ],
      },
      [
        { version: "3.7.0", artifacts: { "": 211_004, sources: 150_212, javadoc: 512_660 }, pomSize: 4_402, at: ago(55, 2), by: "token:12" },
        { version: "3.7.1", artifacts: { "": 211_880, sources: 150_590, javadoc: 513_004 }, pomSize: 4_402, at: ago(30, 7), by: "token:12" },
        {
          version: "3.8.0",
          artifacts: { "": 219_446, sources: 155_731, javadoc: 530_118 },
          pomSize: 4_488,
          at: ago(2, 2),
          by: "token:12",
          referrers: ["cosign", "cyclonedx", "slsa"],
        },
      ],
    ),
    ...artifact(
      payments,
      "com.acme.payments:ledger-client",
      "jar",
      { name: "Ledger client", description: "gRPC client for the ledger service", parent: PARENT },
      [{ version: "1.0.4", artifacts: { "": 98_224, sources: 70_316 }, pomSize: 3_990, at: ago(19, 3), by: "user:alice" }],
    ),
  ];
}
