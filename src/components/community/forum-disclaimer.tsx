import { Info } from "lucide-react";

import { cn } from "../../lib/utils";

/**
 * Persistent voice-boundary banner (plan §3 / §7): forum content is user opinion,
 * not IPO Hero's sourced analysis. Keep this visible wherever forum posts render.
 */
export function ForumDisclaimer({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-semibold text-foreground">Forum posts are user opinion</span>, not IPO
        Hero analysis. IPO Hero stays the neutral, source-cited substrate — discussion and any
        investment views here belong to their authors.
      </p>
    </div>
  );
}
