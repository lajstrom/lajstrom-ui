// The npm and rpm modules and the generic one: what the snippets say, checked against the
// server's client documentation (docs/quickstart/npm.md and rpm.md, http-routing.md §3).

import { describe, expect, it } from "vitest";

import type { Repo } from "@/api/types";

import { formatSpec } from ".";
import type { Snippet, SnippetContext } from "./types";

function ctx(format: string, name: string, readNeedsAuth = true): SnippetContext {
  return {
    baseUrl: "https://art.example.com",
    host: "art.example.com",
    repo: { format, name, prefix: `${format}/${name}` } as Repo,
    readNeedsAuth,
  };
}

const code = (snippets: Snippet[], id: string) => snippets.find((s) => s.id === id)?.code ?? "";

describe("npm", () => {
  const npm = formatSpec("npm");

  it("configures npm and pnpm with .npmrc: the registry, and the token by the URL without its scheme", () => {
    const [install, publish] = npm.connect(ctx("npm", "internal"));
    expect(code(install!.snippets, "npmrc")).toBe(
      "registry=https://art.example.com/npm/internal/\n//art.example.com/npm/internal/:_authToken=${LAJSTROM_TOKEN}",
    );
    expect(code(install!.snippets, "scoped")).toBe(
      "@<scope>:registry=https://art.example.com/npm/internal/\n//art.example.com/npm/internal/:_authToken=${LAJSTROM_TOKEN}",
    );
    expect(code(install!.snippets, "login")).toBe("npm login --registry=https://art.example.com/npm/internal/");
    expect(code(publish!.snippets, "publish")).toBe("npm publish --registry=https://art.example.com/npm/internal/");
  });

  it("configures yarn 4 with the registry without its slash, and npmAlwaysAuth only where reads need the token", () => {
    const yarnrc = (auth: boolean) => code(npm.connect(ctx("npm", "internal", auth))[0]!.snippets, "yarnrc");
    expect(yarnrc(true)).toContain('npmRegistryServer: "https://art.example.com/npm/internal"\n');
    expect(yarnrc(true)).toContain('  "https://art.example.com/npm/internal":\n    npmAlwaysAuth: true\n    npmAuthToken: "${LAJSTROM_TOKEN}"');
    expect(yarnrc(false)).not.toContain("npmAlwaysAuth");
  });

  it("installs a scoped package from its scope's registry, and a version with @", () => {
    const snippets = npm.install(ctx("npm", "internal"), { name: "@acme/widgets" }, { version: "1.2.0", tag: "1.2.0", digest: "sha256:0" });
    expect(code(snippets, "npm")).toBe("npm install @acme/widgets@1.2.0");
    expect(code(snippets, "pnpm")).toBe("pnpm add @acme/widgets@1.2.0");
    expect(code(snippets, "yarn")).toBe("yarn add @acme/widgets@1.2.0");
    expect(code(snippets, "npmrc")).toBe(
      "@acme:registry=https://art.example.com/npm/internal/\n//art.example.com/npm/internal/:_authToken=${LAJSTROM_TOKEN}",
    );
    const anonymous = npm.install(ctx("npm", "public", false), { name: "left-pad" });
    expect(code(anonymous, "npm")).toBe("npm install left-pad");
    expect(code(anonymous, "npmrc")).toBe("registry=https://art.example.com/npm/public/");
  });

  it("downloads the tarball from dist.tarball's path, the scope's / as it is", () => {
    const v = { version: "1.2.0", tag: "1.2.0", digest: "sha256:0", files: [] };
    expect(npm.filePath("internal", "@acme/widgets", v, "widgets-1.2.0.tgz")).toBe("/npm/internal/@acme/widgets/-/widgets-1.2.0.tgz");
    expect(npm.fileRole("application/vnd.lajstrom.npm.tarball.v1.tar+gzip", {})).toBe("Package tarball");
  });

  it("reads package.json from the version document of the metadata layer", () => {
    const rows = npm.metadataRows({
      name: "acme-cli",
      version: "1.0.0",
      manifest: {
        name: "acme-cli",
        version: "1.0.0",
        description: "Command-line client",
        license: "UNLICENSED",
        author: { name: "Platform Team", email: "platform@acme.example" },
        repository: { type: "git", url: "git+https://git.acme.example/platform/acme-cli-js.git" },
        bin: { acme: "bin/acme.js" },
        dependencies: { commander: "^12.1.0" },
        engines: { node: ">=20" },
      },
      filename: "acme-cli-1.0.0.tgz",
      integrity: "sha512-abc",
      shasum: "0123",
      hasInstallScript: true,
      hasShrinkwrap: false,
    });
    const row = (label: string) => rows.find((r) => r.label === label)?.value;
    expect(row("Description")).toBe("Command-line client");
    expect(row("Author")).toBe("Platform Team <platform@acme.example>");
    expect(row("Repository")).toBe("https://git.acme.example/platform/acme-cli-js.git");
    expect(row("Dependencies")).toEqual(["commander ^12.1.0"]);
    expect(row("Engines")).toEqual(["node >=20"]);
    expect(row("Commands")).toEqual(["acme"]);
    expect(row("Install script")).toBeDefined();
    expect(row("Shrinkwrap")).toBeUndefined();
    expect(row("Integrity")).toBe("sha512-abc");
  });
});

describe("rpm", () => {
  const rpm = formatSpec("rpm");

  it("adds a repo that needs credentials with the repo's key fetched once, and the credentials in the .repo file", () => {
    const [add] = rpm.connect(ctx("rpm", "el9"));
    const dnf = code(add!.snippets, "dnf");
    expect(dnf).toContain('sudo curl -fsSL -u "$LAJSTROM_USER:$LAJSTROM_TOKEN" -o /etc/pki/rpm-gpg/lajstrom-el9.asc https://art.example.com/rpm/el9/key.asc');
    expect(dnf).toContain(
      [
        "[lajstrom-el9]",
        "name=Lajstrom rpm/el9",
        "baseurl=https://art.example.com/rpm/el9/",
        "username=$LAJSTROM_USER",
        "password=$LAJSTROM_TOKEN",
        "repo_gpgcheck=1",
        "gpgkey=file:///etc/pki/rpm-gpg/lajstrom-el9.asc",
        "gpgcheck=0",
      ].join("\n"),
    );
    expect(code(add!.snippets, "repofile")).toContain("username=<user>\npassword=<token>");
    expect(code(add!.snippets, "zypper")).toContain("'https://art.example.com/rpm/el9/?credentials=lajstrom-el9' lajstrom-el9");
  });

  it("adds an anonymous repo with repomd.xml.key as its gpgkey and no credentials", () => {
    const [add] = rpm.connect(ctx("rpm", "el9", false));
    const repoFile = code(add!.snippets, "repofile");
    expect(repoFile).toBe(
      [
        "[lajstrom-el9]",
        "name=Lajstrom rpm/el9",
        "baseurl=https://art.example.com/rpm/el9/",
        "repo_gpgcheck=1",
        "gpgkey=https://art.example.com/rpm/el9/repodata/repomd.xml.key",
        "gpgcheck=0",
      ].join("\n"),
    );
    expect(code(add!.snippets, "dnf")).not.toContain("curl");
    expect(code(add!.snippets, "zypper")).toBe(
      "sudo zypper addrepo --gpgcheck-allow-unsigned-package 'https://art.example.com/rpm/el9/' lajstrom-el9\nsudo zypper --gpg-auto-import-keys refresh lajstrom-el9",
    );
  });

  it("uploads with a PUT of the file", () => {
    const [, upload] = rpm.connect(ctx("rpm", "el9"));
    expect(code(upload!.snippets, "upload")).toBe('curl -u "$LAJSTROM_USER:$LAJSTROM_TOKEN" -T ./hello-2.12-1.el9.x86_64.rpm https://art.example.com/rpm/el9/upload');
  });

  it("installs a version by its NEVRA, and downloads the file, whose name has no epoch", () => {
    const v = { version: "1:1.24.0-1.el9", variant: "x86_64", tag: "1_3a1.24.0-1.el9__x86_5f64", digest: "sha256:0" };
    const snippets = rpm.install(ctx("rpm", "el9", false), { name: "nginx" }, v);
    expect(code(snippets, "dnf")).toBe("sudo dnf install nginx-1:1.24.0-1.el9.x86_64");
    expect(code(snippets, "curl")).toBe("curl -fLO https://art.example.com/rpm/el9/Packages/nginx-1.24.0-1.el9.x86_64.rpm");
    const source = rpm.install(ctx("rpm", "el9"), { name: "hello" }, { ...v, version: "2.12-1.el9", variant: "src" });
    expect(code(source, "source")).toBe("dnf download --source hello-2.12-1.el9");
    expect(code(source, "dnf")).toBe("");
    expect(rpm.filePath("el9", "hello", { ...v, files: [] }, "hello-2.12-1.el9.src.rpm")).toBe("/rpm/el9/Packages/hello-2.12-1.el9.src.rpm");
  });

  it("names a source package by its file name", () => {
    const role = (title: string) => rpm.fileRole("application/vnd.lajstrom.rpm.package.v1", { "org.opencontainers.image.title": title });
    expect(role("hello-2.12-1.el9.src.rpm")).toBe("Source package");
    expect(role("hello-2.12-1.el9.x86_64.rpm")).toBe("RPM package");
  });

  it("writes the relations of the header as rpm -q does, without rpmlib()", () => {
    const rows = rpm.metadataRows({
      name: "hello",
      epoch: 1,
      version: "2.12",
      release: "1.el9",
      arch: "x86_64",
      summary: "Prints a greeting",
      requires: [
        { name: "glibc", flags: 12, epoch: "", version: "2.34", release: "", pre: false },
        { name: "/bin/sh", flags: 1024, epoch: "", version: "", release: "", pre: true },
        { name: "rpmlib(CompressedFileNames)", flags: 16777226, epoch: "", version: "3.0.4", release: "1", pre: false },
      ],
      provides: [{ name: "hello", flags: 8, epoch: "1", version: "2.12", release: "1.el9", pre: false }],
      files: [{ path: "/usr/bin/hello" }, { path: "/usr/share/doc/hello", type: "dir" }],
    });
    const row = (label: string) => rows.find((r) => r.label === label)?.value;
    expect(row("Version")).toBe("1:2.12-1.el9");
    expect(row("Requires")).toEqual(["glibc >= 2.34", "/bin/sh (pre)"]);
    expect(row("Provides")).toEqual(["hello = 1:2.12-1.el9"]);
    expect(row("Files in package")).toBe("1 file, 1 directory");
    const source = rpm.metadataRows({ arch: "src", requires: [{ name: "gcc", flags: 0, epoch: "", version: "", release: "", pre: false }] });
    expect(source.find((r) => r.label === "Build requires")?.value).toEqual(["gcc"]);
  });
});

describe("a format the UI does not know", () => {
  it("gets the generic module: names, versions and files, no snippets", () => {
    const spec = formatSpec("nuget");
    expect(spec).toMatchObject({ name: "nuget", label: "nuget", mark: "NUG", artifactType: "application/vnd.lajstrom.nuget.v1", variantLabel: null });
    expect(spec.connect(ctx("nuget", "internal"))).toEqual([]);
    expect(spec.install(ctx("nuget", "internal"), { name: "Acme.Core" })).toEqual([]);
    expect(spec.filePath("internal", "Acme.Core", { version: "1.0.0", tag: "1.0.0", digest: "sha256:0", files: [] }, "acme.core.1.0.0.nupkg")).toBeNull();
    expect(spec.fileRole("application/vnd.lajstrom.nuget.package.v1+zip", {})).toBe("Package");
    expect(spec.metadataRows({ id: "Acme.Core", summary: "Core", authors: ["a"] })).toEqual([
      { label: "id", value: "Acme.Core", mono: true },
      { label: "Summary", value: "Core", mono: false },
    ]);
  });

  it("is not a property of Object.prototype", () => {
    expect(formatSpec("toString").label).toBe("toString");
    expect(formatSpec("npm").label).toBe("npm");
    expect(formatSpec("oci").label).toBe("OCI");
  });
});
