import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { XLogo } from "./x-logo";

type SignInPromptProps = {
  /** Headline tailored to what the user just tried to do (reply, vote, post). */
  title?: string;
  description?: string;
  onSignInWithX?: () => void;
  /** Compact variant for inline write-gates (e.g. under a reply box). */
  inline?: boolean;
  className?: string;
};

/**
 * The auth gate logged-out users hit when they try to write (decision A.2). Reads
 * stay public; this only ever replaces *write* controls. Sign-in is X-only — the
 * handler is optional so the surface renders inertly in previews.
 */
export function SignInPrompt({
  title = "Sign in to join the discussion",
  description = "Browsing is open to everyone. Posting, replying, and voting need a quick sign-in.",
  onSignInWithX,
  inline = false,
  className,
}: SignInPromptProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-panel",
        inline && "p-3",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <p className={cn("font-semibold", inline ? "text-sm" : "text-base")}>{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      <Button type="button" onClick={onSignInWithX} className="w-full">
        <XLogo className="size-4" /> Sign in
      </Button>
    </div>
  );
}
