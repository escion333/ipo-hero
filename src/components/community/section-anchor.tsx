import { Hash, MessagesSquare } from "lucide-react";

import { cn } from "../../lib/utils";

type SectionAnchorProps = {
  /** Human title of the filing section, or null/undefined for general discussion. */
  title?: string | null;
  /**
   * Where clicking jumps in the reader/workbench. When omitted the anchor renders
   * as a non-interactive tag (e.g. in the create form preview).
   */
  href?: string;
  className?: string;
};

/**
 * The badge tying a thread to its `FilingSection` — the "debate stays close to the
 * source text" nudge from the plan. Falls back to a "General" tag when unscoped.
 */
export function SectionAnchor({ title, href, className }: SectionAnchorProps) {
  const general = !title;
  const Icon = general ? MessagesSquare : Hash;
  const label = general ? "General" : title;
  const base = cn(
    "inline-flex w-fit items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium",
    general ? "text-muted-foreground" : "text-foreground",
    href && "transition-colors hover:border-ring hover:text-primary",
    className,
  );

  if (href && !general) {
    return (
      <a href={href} className={base} title={`Jump to “${title}” in the filing`}>
        <Icon className="size-3" aria-hidden="true" />
        <span className="max-w-[18ch] truncate">{label}</span>
      </a>
    );
  }
  return (
    <span className={base}>
      <Icon className="size-3" aria-hidden="true" />
      <span className="max-w-[18ch] truncate">{label}</span>
    </span>
  );
}
