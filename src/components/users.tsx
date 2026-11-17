// What a user's row and page say of it: enabled, disabled or inactive, and its last activity
// (docs/spec/rbac.md §1, Inactive users); whether its password is locked or must be changed
// (Local passwords).

import type { User } from "@/api/types";
import { RelativeTime } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format";

/** Disabled, inactive or active, and then whether its password is locked or must be changed. An
 * inactive user is enabled and unseen for longer than auth.disableInactiveUsersAfter: its next
 * authentication disables it. */
export function UserStatus({ user }: { user: User }) {
  if (!user.lockedUntil && !user.mustChange) return <UserState user={user} />;
  return (
    <span className="inline-flex flex-wrap gap-1">
      <UserState user={user} />
      {user.lockedUntil ? (
        <Tooltip
          content={`10 wrong passwords in a row locked its password until ${formatDateTime(user.lockedUntil)} (auth.lockout.duration); its tokens and OIDC logins keep working. An admin's unlock or new password ends the lock.`}
        >
          <Badge tone="warning">locked</Badge>
        </Tooltip>
      ) : null}
      {user.mustChange ? (
        <Tooltip content="Its password works for its own change only: the next sign-in asks for a new one">
          <Badge tone="outline">must change password</Badge>
        </Tooltip>
      ) : null}
    </span>
  );
}

function UserState({ user }: { user: User }) {
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
