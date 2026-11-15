import { useQuery } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react";
import { useState } from "react";

import { infoQuery } from "@/api/queries";
import { RelativeTime } from "@/components/common";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogActions, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Properties, Property } from "@/components/ui/misc";

import { build } from "./build";
import { config } from "./config";
import { demoMode } from "./demo";
import type { ServerVersion } from "./skew";
import { serverAtStart, skewText } from "./startup";

const SERVER_REPO = "https://github.com/lajstrom/lajstrom";
const UI_REPO = "https://github.com/lajstrom/lajstrom-ui";

/** The server version the bundle was built for: a release, git describe, or the short commit. */
function contractVersion(): string {
  return build.contract.serverVersion || build.contract.serverCommit.slice(0, 7);
}

function apiUrl(): string {
  return `${config().apiBaseUrl || window.location.origin}/api/${build.contract.api}`;
}

/** The versions as plain text, for a support request. */
function versionsText(info: ServerVersion | undefined, demo: boolean): string {
  const at = (commit: string, date: string) => [commit, date].filter(Boolean).join(", ");
  const ui = at(build.commit, build.date);
  const server = info ? `Lajstrom ${info.version}${at(info.commit, info.date) ? ` (${at(info.commit, info.date)})` : ""}` : "Lajstrom: unknown";
  return [
    `Lajstrom UI ${build.version}${ui ? ` (${ui})` : ""}`,
    `built for /api/${build.contract.api} of lajstrom/lajstrom@${build.contract.serverCommit.slice(0, 7)}${build.contract.serverVersion ? ` (${build.contract.serverVersion})` : ""}`,
    demo ? `${server}, the demo's mock` : server,
    ...(serverAtStart() ? [`against this UI: ${skewText(serverAtStart()!.skew)}`] : []),
    `API ${demo ? "answered in this browser" : apiUrl()}`,
  ].join("\n");
}

/** The versions of the UI and of the server, and the server API the UI was built for. */
function AboutContent() {
  const info = useQuery(infoQuery);
  const demo = demoMode().active;
  const c = build.contract;
  const started = serverAtStart();
  const support = config().branding.supportUrl;
  // The server as the start-up found it (GET /-/version), or as /api/v1/info says in the demo.
  const server = started?.server ?? info.data;
  return (
    <DialogContent title="About" description="The web UI of Lajstrom, an artifact registry on top of OCI registries.">
      <h3 className="mb-2 text-sm font-semibold">Web UI</h3>
      <Properties>
        <Property label="Version">
          {build.commit ? (
            <a href={`${UI_REPO}/commit/${build.commit}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              {build.version} · {build.commit}
            </a>
          ) : (
            build.version
          )}
        </Property>
        {build.date ? (
          <Property label="Committed">
            <RelativeTime iso={build.date} />
          </Property>
        ) : null}
        <Property label="Built for">
          <a
            href={`${SERVER_REPO}/blob/${c.serverCommit}/internal/api/openapi.yaml`}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            /api/{c.api} of Lajstrom {contractVersion()}
          </a>
        </Property>
      </Properties>

      <h3 className="mt-5 mb-2 text-sm font-semibold">Server</h3>
      <Properties>
        <Property label="Lajstrom">
          {server ? (
            <>
              {server.version}
              {server.commit ? ` · ${server.commit}` : ""}
              {demo ? <span className="text-muted-foreground"> (the demo's mock)</span> : null}
            </>
          ) : info.isError ? (
            <span className="text-muted-foreground">unknown: /api/{c.api}/info did not answer</span>
          ) : (
            "…"
          )}
        </Property>
        {server?.date ? (
          <Property label="Built">
            <RelativeTime iso={server.date} />
          </Property>
        ) : null}
        <Property label="API">
          {demo ? <span className="text-muted-foreground">answered in this browser</span> : <span className="font-mono text-[12.5px] break-all">{apiUrl()}</span>}
        </Property>
        {started ? <Property label="Against this UI">{skewText(started.skew)}</Property> : null}
      </Properties>

      {support ? (
        <p className="mt-5 flex items-center gap-1.5 text-sm">
          <LifeBuoy className="size-4 text-muted-foreground" />
          Help with {config().branding.title}:{" "}
          <a href={support} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">
            {support.replace(/^mailto:/, "")}
          </a>
        </p>
      ) : null}

      <DialogActions className="items-center">
        <span className="mr-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <CopyButton value={versionsText(server, demo)} label="versions" />
          Copy for a support request
        </span>
        <DialogClose asChild>
          <Button variant="secondary">Close</Button>
        </DialogClose>
      </DialogActions>
    </DialogContent>
  );
}

/** "About" in the footer. */
export function AboutButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="cursor-pointer underline-offset-2 hover:text-foreground hover:underline">
          About
        </button>
      </DialogTrigger>
      {open ? <AboutContent /> : null}
    </Dialog>
  );
}
