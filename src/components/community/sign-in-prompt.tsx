import { useState } from "react";
import { Mail } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { XLogo } from "./x-logo";

type SignInPromptProps = {
  /** Headline tailored to what the user just tried to do (reply, vote, post). */
  title?: string;
  description?: string;
  onSignInWithX?: () => void;
  /** Email/OTP fallback. Receives a validated, trimmed address. */
  onSignInWithEmail?: (email: string) => void;
  /** Compact variant for inline write-gates (e.g. under a reply box). */
  inline?: boolean;
  className?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The auth gate logged-out users hit when they try to write (decision A.2). Reads
 * stay public; this only ever replaces *write* controls. Both handlers are
 * optional so the surface renders inertly in previews.
 */
export function SignInPrompt({
  title = "Sign in to join the discussion",
  description = "Browsing is open to everyone. Posting, replying, and voting need a quick sign-in.",
  onSignInWithX,
  onSignInWithEmail,
  inline = false,
  className,
}: SignInPromptProps) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const valid = EMAIL_RE.test(email.trim());

  const submitEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSignInWithEmail?.(email.trim());
    setSent(true);
  };

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
        <XLogo className="size-4" /> Sign in with X
      </Button>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      {sent ? (
        <p className="flex items-center gap-2 text-sm text-good">
          <Mail className="size-4" aria-hidden="true" /> Check your inbox for a sign-in link.
        </p>
      ) : (
        <form onSubmit={submitEmail} className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email address"
          />
          <Button type="submit" variant="outline" disabled={!valid} className="shrink-0">
            <Mail className="size-4" /> Email me a link
          </Button>
        </form>
      )}
    </div>
  );
}
