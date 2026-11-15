import { useEffect, useRef, useState } from "react";

import { getSession } from "@/api/session";
import { config } from "@/app/config";
import { demoMode } from "@/app/demo";
import { PageHeader } from "@/components/common";
import { Card } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/misc";

/**
 * /api/v1 in Swagger UI. Against a server, from the server's own description,
 * GET /api/v1/openapi.yaml, and "Try it out" sends real requests as the signed-in user. In the
 * demo, from public/openapi.yaml: the server's description with what the UI proposes, answered
 * by the same mock as the UI, so the requests and answers show in the browser's developer tools.
 */
export function ApiDocsPage() {
  const demo = demoMode().active;
  const spec = demo ? `${import.meta.env.BASE_URL}openapi.yaml` : `${config().apiBaseUrl}/api/v1/openapi.yaml`;
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    // Swagger UI is about 450 KiB gzipped: its own chunk, loaded on this page only.
    Promise.all([import("swagger-ui-dist/swagger-ui-es-bundle.js"), import("swagger-ui-dist/swagger-ui.css")])
      .then(([{ default: SwaggerUIBundle }]) => {
        if (cancelled || !host.current) return;
        SwaggerUIBundle({
          domNode: host.current,
          url: spec,
          // Against a server, a request is sent only after "Try it out" on its operation.
          tryItOutEnabled: demo,
          showExtensions: true,
          deepLinking: false,
          displayRequestDuration: true,
          defaultModelsExpandDepth: 0,
          docExpansion: "list",
          filter: true,
          // As the user who is signed in, unless "Authorize" set other credentials; the token goes
          // to the origin of the description only, which is the API's.
          requestInterceptor: (req) => {
            const session = getSession();
            const toApi = new URL(req.url, location.href).origin === new URL(spec, location.href).origin;
            if (session && toApi && !req.headers.Authorization) req.headers.Authorization = `Bearer ${session.token}`;
            return req;
          },
        });
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [demo, spec]);

  return (
    <>
      <PageHeader
        title="API"
        description={
          demo ? (
            <>
              /api/v1 of the server, and what the UI needs that the server does not have yet, marked proposed. "Try it
              out" is answered by the demo, as the signed-in user; the requests show in the developer tools. The spec:{" "}
              <a className="text-primary hover:underline" href={spec}>
                openapi.yaml
              </a>
              .
            </>
          ) : (
            <>
              /api/v1 of this server, from its own description. "Try it out" sends real requests, as the signed-in user.
              The spec:{" "}
              <a className="text-primary hover:underline" href={spec}>
                openapi.yaml
              </a>
              .
            </>
          )
        }
      />
      {state === "failed" ? (
        <Card>
          <EmptyState title="Swagger UI did not load">Reload the page to try again.</EmptyState>
        </Card>
      ) : null}
      {state === "loading" ? <Skeleton className="h-96" /> : null}
      {/* Swagger UI has no dark theme: it keeps its own light card. */}
      <div ref={host} className="api-docs overflow-hidden rounded-lg border border-border bg-white text-black" />
    </>
  );
}
