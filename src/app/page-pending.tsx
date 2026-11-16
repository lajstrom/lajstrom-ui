import { LoaderCircle } from "lucide-react";

/**
 * In the shell's main area while the next page's chunk loads, when that takes longer than the
 * router waits for it (src/app/router.tsx). The header and the footer stay where they are.
 */
export function PagePending() {
  return (
    <div role="status" className="flex items-center justify-center py-24 text-sm text-muted-foreground">
      <LoaderCircle className="mr-2 size-4 animate-spin" />
      Loading…
    </div>
  );
}
