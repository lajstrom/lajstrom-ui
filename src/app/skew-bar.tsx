import { TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { build } from "./build";
import { serverAtStart } from "./startup";

const DISMISSED = "lajstrom.skew.dismissed";

function dismissedFor(key: string): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSED) === key;
  } catch {
    return false;
  }
}

/** Under the header: the server is older or newer than the API this UI was built for. The UI
 * goes on; dismissed, the bar stays away until the next start in this tab. */
export function SkewBar() {
  const at = serverAtStart();
  const key = at ? `${at.server.version}@${at.server.commit}/${build.contract.serverCommit}` : "";
  const [hidden, setHidden] = useState(() => dismissedFor(key));
  if (!at || hidden || (at.skew !== "older" && at.skew !== "newer")) return null;
  const builtFor = build.contract.serverVersion || build.contract.serverCommit.slice(0, 7);
  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISSED, key);
    } catch {
      // No storage: hidden until the page is loaded again.
    }
    setHidden(true);
  };
  return (
    <div role="status" className="border-t border-warning/25 bg-warning-soft">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1 text-xs sm:px-6">
        <TriangleAlert className="size-3.5 shrink-0 text-warning" />
        <span className="min-w-0 flex-1">
          The server, Lajstrom {at.server.version}, is {at.skew} than the API this UI was built for ({builtFor}).{" "}
          {at.skew === "older"
            ? "Screens that need what it does not have yet may say so, or fail."
            : "Its API may have changed, and some screens may fail; a newer release of the UI may match it."}
        </span>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
