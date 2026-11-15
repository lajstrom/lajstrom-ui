import { TOKEN, USER } from "./common";
import type { FormatSpec } from "./types";

// docs/spec/http-routing.md §1: an `oci` repo, oci/<repo>, holds any OCI artifact or image that
// passes through /v2 unchanged; it indexes nothing and has no protocol frontend of its own.
export const oci: FormatSpec = {
  name: "oci",
  label: "OCI",
  mark: "OCI",
  markClass: "bg-cyan-500/12 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300",
  noun: { one: "image", many: "images" },
  variantLabel: null,
  artifactType: "any OCI artifact or image",
  facets: [],
  columns: [],
  connect(ctx) {
    const ref = `${ctx.host}/oci/${ctx.repo.name}`;
    const login = `docker login ${ctx.host} -u "${USER}" -p "${TOKEN}"`;
    // A proxy and a group take no push (proxy-and-group.md §11.9, §12.3): connectFor leaves the
    // pushes out, and a pull names the upstream's repository, or a path the routes send.
    const hosted = (ctx.repo.kind ?? "hosted") === "hosted";
    const image = hosted ? `${ref}/myapp:1.0` : `${ref}/<path>:<tag>`;
    const pullLogin = (tool: string) => (!hosted && ctx.readNeedsAuth ? `${tool} login ${ctx.host} -u "${USER}" -p "${TOKEN}"\n` : "");
    return [
      {
        title: hosted ? "Push and pull with docker" : "Pull with docker",
        description:
          ctx.repo.kind === "proxy"
            ? `A pull of an image the repo does not hold fetches it from the upstream ${ctx.repo.upstream?.name ?? ""} and keeps it in the backend registry; <path> is the upstream's repository, library/nginx on Docker Hub.`
            : ctx.repo.kind === "group"
              ? "One pull address for the members: each path comes from the one member the group's routes send it to."
              : "Images pass through to the backend registry as they are; Lajstrom checks who may push and pull.",
        snippets: [
          { id: "docker-push", title: "Push", caption: "shell", shell: true, publish: true, code: `${login}\ndocker tag myapp:1.0 ${image}\ndocker push ${image}` },
          { id: "docker-pull", title: "Pull", caption: "shell", shell: true, code: `${pullLogin("docker")}docker pull ${image}` },
        ],
      },
      {
        title: "Any artifact with oras",
        snippets: hosted
          ? [
              {
                id: "oras",
                title: "oras",
                caption: "shell",
                shell: true,
                publish: true,
                code: `oras login ${ctx.host} -u "${USER}" -p "${TOKEN}"\noras push ${ref}/configs:v1 ./app.yaml\noras pull ${ref}/configs:v1`,
              },
            ]
          : [{ id: "oras-pull", title: "oras pull", caption: "shell", shell: true, code: `${pullLogin("oras")}oras pull ${image}` }],
      },
    ];
  },
  install(ctx, pkg, version) {
    return [{ id: "pull", title: "docker", caption: "shell", shell: true, code: `docker pull ${ctx.host}/oci/${ctx.repo.name}/${pkg.name}:${version?.version ?? "latest"}` }];
  },
  filePath: () => null,
  fileRole: () => "Layer",
  metadataRows: () => [],
};
