import { Info } from "lucide-react";

import { cn } from "../../lib/utils";

/**
 * Persistent voice-boundary banner (plan §3 / §7): forum content is user opinion,
 * not IPO Hero's sourced analysis. Keep this visible wherever forum posts render.
 */
export function ForumDisclaimer({ className }: { className?: string }) {
  return (
    <p
      role="note"
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <Info className="size-3.5 shrink-0" aria-hidden="true" />
      Opinions here are readers&rsquo; own, not IPO Hero&rsquo;s analysis.
    </p>
  );
}
