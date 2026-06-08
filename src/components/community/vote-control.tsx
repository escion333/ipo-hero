import { ChevronDown, ChevronUp } from "lucide-react";

import type { VoteValue } from "../../lib/community/types";
import { cn } from "../../lib/utils";
import { compactCount } from "./format";

type VoteControlProps = {
  score: number;
  /** The current user's vote on this target, or null if none / logged out. */
  myVote?: VoteValue | null;
  /**
   * Called with the *intended* value. Clicking an active arrow re-sends the same
   * value (the parent decides whether that toggles the vote off). Optional so the
   * control can render read-only for logged-out users.
   */
  onVote?: (value: VoteValue) => void;
  /** Logged-out / locked threads: arrows render but don't act. */
  disabled?: boolean;
  orientation?: "vertical" | "horizontal";
  className?: string;
};

export function VoteControl({
  score,
  myVote = null,
  onVote,
  disabled = false,
  orientation = "vertical",
  className,
}: VoteControlProps) {
  const inert = disabled || !onVote;
  const arrow = (value: VoteValue) => {
    const active = myVote === value;
    const Icon = value === 1 ? ChevronUp : ChevronDown;
    return (
      <button
        type="button"
        aria-label={value === 1 ? "Upvote" : "Downvote"}
        aria-pressed={active}
        disabled={inert}
        onClick={() => onVote?.(value)}
        className={cn(
          "flex size-6 items-center justify-center rounded transition-colors",
          "hover:bg-accent hover:text-accent-foreground",
          "disabled:pointer-events-none disabled:opacity-60",
          active && value === 1 && "text-good",
          active && value === -1 && "text-destructive",
          !active && "text-muted-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    );
  };

  return (
    <div
      className={cn(
        "flex items-center gap-0.5",
        orientation === "vertical" && "flex-col",
        className,
      )}
    >
      {arrow(1)}
      <span
        className={cn(
          "min-w-[2ch] text-center text-sm font-semibold tabular-nums",
          myVote === 1 && "text-good",
          myVote === -1 && "text-destructive",
          !myVote && "text-foreground",
        )}
      >
        {compactCount(score)}
      </span>
      {arrow(-1)}
    </div>
  );
}
