import { FlaskConical } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getSession } from "@/api/session";
import { demoMode, enterDemo } from "@/app/demo";
import { PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Skeleton } from "@/components/ui/misc";

/**
 * The API of the demo in Swagger UI, from public/openapi.yaml. "Try it out" goes through the same
 * mock as the UI, as the signed-in demo user, so the requests and answers show in the browser's
 * developer tools. Demo only: against a server, the page offers the demo.
 */
export function ApiDocsPage() {
  const demo = demoMode().active;
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    if (!demo) return;
    let cancelled = false;
    // Swagger UI is about 450 KiB gzipped: its own chunk, loaded on this page only.
    Promise.all([import("swagger-ui-dist/swagger-ui-es-bundle.js"), import("swagger-ui-dist/swagger-ui.css")])
      .then(([{ default: SwaggerUIBundle }]) => {
        if (cancelled || !host.current) return;
        SwaggerUIBundle({
          domNode: host.current,
          url: `${import.meta.env.BASE_URL}openapi.yaml`,
          tryItOutEnabled: true,
          deepLinking: false,
          displayRequestDuration: true,
          defaultModelsExpandDepth: 0,
          docExpansion: "list",
          filter: true,
          // As the demo user who is signed in, unless "Authorize" set other credentials.
          requestInterceptor: (req) => {
            const session = getSession();
            if (session && !req.headers.Authorization) req.headers.Authorization = `Bearer ${session.token}`;
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
  }, [demo]);

  if (!demo) {
    return (
      <>
        <PageHeader title="API" />
        <Card>
          <EmptyState
            icon={<FlaskConical />}
            title="The API page is part of the demo"
            action={
              <Button onClick={enterDemo}>
                <FlaskConical />
                Open the demo
              </Button>
            }
          >
            There, every operation of /api/v1 can be tried against generated data, answered in your browser.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="API"
        description={
          <>
            /api/v1 as the UI uses it: what the server has, and what it does not have yet, marked proposed. "Try it out" is
            answered by the demo, as the signed-in user; the requests show in the developer tools. The spec:{" "}
            <a className="text-primary hover:underline" href={`${import.meta.env.BASE_URL}openapi.yaml`}>
              openapi.yaml
            </a>
            .
          </>
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
