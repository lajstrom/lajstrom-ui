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
    return [
      {
        title: "Push and pull with docker",
        description: "Images pass through to the backend registry as they are; Lajstrom checks who may push and pull.",
        snippets: [
          { id: "docker-push", title: "Push", caption: "shell", shell: true, code: `${login}\ndocker tag myapp:1.0 ${ref}/myapp:1.0\ndocker push ${ref}/myapp:1.0` },
          { id: "docker-pull", title: "Pull", caption: "shell", shell: true, code: `docker pull ${ref}/myapp:1.0` },
        ],
      },
      {
        title: "Any artifact with oras",
        snippets: [
          {
            id: "oras",
            title: "oras",
            caption: "shell",
            shell: true,
            code: `oras login ${ctx.host} -u "${USER}" -p "${TOKEN}"\noras push ${ref}/configs:v1 ./app.yaml\noras pull ${ref}/configs:v1`,
          },
        ],
      },
    ];
  },
  install(ctx, pkg, version) {
    return [{ id: "pull", title: "docker", caption: "shell", shell: true, code: `docker pull ${ctx.host}/oci/${ctx.repo.name}/${pkg.name}:${version?.version ?? "latest"}` }];
  },
  fileRole: () => "Layer",
  metadataRows: () => [],
};
