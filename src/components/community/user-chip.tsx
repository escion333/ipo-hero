import { ShieldCheck } from "lucide-react";

import type { CommunityUser } from "../../lib/community/types";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";

function initials(user: CommunityUser): string {
  const source = user.displayName || user.handle;
  const parts = source.trim().split(/\s+/);
  const chars = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2);
  return chars.toUpperCase();
}

function Avatar({ user, className }: { user: CommunityUser; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-secondary text-[10px] font-semibold text-muted-foreground",
        className,
      )}
      aria-hidden="true"
    >
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        initials(user)
      )}
    </span>
  );
}

type UserChipProps = {
  user: CommunityUser;
  /** Show "· @handle" after the display name. */
  showHandle?: boolean;
  className?: string;
};

/** Compact author identity: avatar + display name (+ optional handle, role badge). */
export function UserChip({ user, showHandle = true, className }: UserChipProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <Avatar user={user} />
      <span className="font-medium text-foreground">{user.displayName}</span>
      {showHandle ? <span className="text-muted-foreground">@{user.handle}</span> : null}
      {user.role === "moderator" ? (
        <Badge tone="accent" className="gap-1 px-1.5 py-0 text-[10px]">
          <ShieldCheck className="size-3" aria-hidden="true" /> mod
        </Badge>
      ) : null}
    </span>
  );
}

export { Avatar };
