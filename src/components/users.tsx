// What a user's row and page say of it: enabled, disabled or inactive, and its last activity
// (docs/spec/rbac.md §1, Inactive users).

import type { User } from "@/api/types";
import { RelativeTime } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";

/** Disabled, inactive or active. An inactive user is enabled and unseen for longer than
 * auth.disableInactiveUsersAfter: its next authentication disables it. */
export function UserStatus({ user }: { user: User }) {
  if (user.disabled) return <Badge tone="danger">disabled</Badge>;
  if (user.inactive) {
    return (
      <Tooltip content="Not seen for longer than the server allows (auth.disableInactiveUsersAfter): its next sign-in, token or OIDC login is refused and disables it, unless it is the last enabled admin">
        <Badge tone="warning">inactive</Badge>
      </Tooltip>
    );
  }
  return <Badge tone="success">active</Badge>;
}

/** The user's last activity: its last authentication, or its enabling; never before either. */
export function LastSeen({ user }: { user: User }) {
  return user.lastSeenAt ? <RelativeTime iso={user.lastSeenAt} /> : <span className="text-muted-foreground">never</span>;
}
