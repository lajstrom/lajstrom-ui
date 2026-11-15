import type { Pointer } from "@/api/types";

import { Badge } from "./ui/badge";
import { Tooltip } from "./ui/tooltip";

/** The pointers that name a version, npm's dist-tags: latest like the latest badge, the others
 * by their names. */
export function PointerBadges({ pointers }: { pointers: Pointer[] }) {
  return (
    <>
      {pointers.map((p) => (
        <Tooltip key={`${p.kind}:${p.name}`} content={`The ${p.kind} ${p.name} names this version; it can move to another`}>
          <Badge tone={p.name === "latest" ? "primary" : "outline"} className={p.name === "latest" ? undefined : "font-mono"}>
            {p.name}
          </Badge>
        </Tooltip>
      ))}
    </>
  );
}
