import { Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";

export function NotFound() {
  return (
    <EmptyState
      icon={<Compass />}
      title="Page not found"
      action={
        <Button asChild>
          <Link to="/">Back to repositories</Link>
        </Button>
      }
    >
      Nothing lives at this address. Repositories are at /ui/&lt;format&gt;/&lt;repo&gt;.
    </EmptyState>
  );
}
