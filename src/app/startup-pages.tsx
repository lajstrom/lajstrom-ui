// The pages of the start-up (src/main.tsx), before the app and its router exist: a quiet
// "starting" while config.json and /-/version are read, and the page that names the problem
// when one of them stops it. They take no providers: plain buttons, no links of the router.

import { FileWarning, FlaskConical, LifeBuoy, LoaderCircle, RefreshCw, ServerCrash } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { build } from "./build";
import { config } from "./config";
import { enterDemo } from "./demo";
import type { Probe } from "./startup";

/** Shown while the start-up waits; only after a moment, so that a quick start shows nothing. */
export function Starting({ url }: { url?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 400);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
      <LoaderCircle className="mr-2 size-4 animate-spin" />
      {url ? (
        <span>
          Connecting to <span className="font-mono text-[12.5px]">{url}</span>…
        </span>
      ) : (
        "Starting…"
      )}
    </div>
  );
}

function StartupError({ icon, title, children, actions }: { icon: ReactNode; title: string; children: ReactNode; actions: ReactNode }) {
  const support = config().branding.supportUrl;
  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-xl rounded-xl border border-border bg-background p-6 shadow-card">
        <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-danger-soft text-danger [&_svg]:size-5">{icon}</div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <div className="mt-2 space-y-3 text-sm text-muted-foreground">{children}</div>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {actions}
          {support ? (
            <Button asChild variant="ghost">
              <a href={support} target="_blank" rel="noreferrer">
                <LifeBuoy />
                Get help
              </a>
            </Button>
          ) : null}
        </div>
        <p className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">
          Lajstrom UI {build.version}
          {build.commit ? ` · ${build.commit}` : ""}
        </p>
      </div>
    </main>
  );
}

/** What went wrong, as the browser saw it: monospace, wrapping. */
function Detail({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-code px-3 py-2 font-mono text-[12.5px] break-words text-foreground">{children}</p>;
}

const reload = () => window.location.reload();

/** config.json is not JSON, has another schema, or a setting of the wrong kind. */
export function ConfigError({ problem, url }: { problem: string; url: string }) {
  return (
    <StartupError
      icon={<FileWarning />}
      title="This UI's configuration has a problem"
      actions={
        <Button onClick={reload}>
          <RefreshCw />
          Reload
        </Button>
      }
    >
      <Detail>{problem}</Detail>
      <p>
        The UI reads <span className="font-mono text-[12.5px] break-all text-foreground">{url}</span>. The image writes it at start
        from its <span className="font-mono text-[12.5px]">LAJSTROM_UI_*</span> variables, or serves a file mounted at{" "}
        <span className="font-mono text-[12.5px]">/etc/lajstrom-ui/config.json</span>. The settings are in the UI's README,
        Configuration. Fix it and reload.
      </p>
    </StartupError>
  );
}

/** GET /-/version did not answer, or not as Lajstrom. */
export function ServerError({ probe, demoOffered }: { probe: Extract<Probe, { ok: false }>; demoOffered: boolean }) {
  return (
    <StartupError
      icon={<ServerCrash />}
      title={`${config().branding.title} cannot reach its server`}
      actions={
        <>
          <Button onClick={reload}>
            <RefreshCw />
            Try again
          </Button>
          {demoOffered ? (
            <Button variant="ghost" onClick={enterDemo}>
              <FlaskConical />
              Open the demo
            </Button>
          ) : null}
        </>
      }
    >
      <Detail>
        GET {probe.url}
        <br />
        {probe.status}
      </Detail>
      <p>
        The UI is here, but the Lajstrom server is not. It may be down or still starting; or{" "}
        <span className="font-mono text-[12.5px]">apiBaseUrl</span> of config.json names the wrong place, or the edge does not route{" "}
        <span className="font-mono text-[12.5px]">/-/</span> and <span className="font-mono text-[12.5px]">/api/</span> to Lajstrom.
      </p>
    </StartupError>
  );
}
