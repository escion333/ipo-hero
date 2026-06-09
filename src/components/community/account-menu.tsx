import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";

import type { CommunityUser } from "../../lib/community/types";
import { cn } from "../../lib/utils";
import { ThemeToggle } from "../theme/theme-toggle";
import { Button } from "../ui/button";
import { SignInPrompt } from "./sign-in-prompt";
import { Avatar } from "./user-chip";
import { XLogo } from "./x-logo";

type AccountMenuProps = {
  /** Null = signed out. Ignored while `loading`. */
  user: CommunityUser | null;
  /** Session is still resolving — render a placeholder instead of a sign-in CTA. */
  loading?: boolean;
  /** Community auth is configured. When false, only the theme control is shown. */
  enabled?: boolean;
  onSignInWithX?: () => void;
  onSignOut?: () => void;
  className?: string;
};

/** Theme switcher row shared by every popover state, and shown standalone when
 * there's no account to manage so the control is always reachable. */
function ThemeRow() {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">Theme</span>
      <ThemeToggle />
    </div>
  );
}

/**
 * Persistent account + theme control for the sticky nav chrome. Signed-out →
 * "Sign in" popover (reuses SignInPrompt) with theme; signed-in → identity
 * button + sign-out popover with theme; loading → inert placeholder (prevents
 * the flash-of-signed-out before the session resolves). When auth isn't
 * configured it collapses to just the theme toggle, so the control is never lost.
 */
export function AccountMenu({
  user,
  loading = false,
  enabled = true,
  onSignInWithX,
  onSignOut,
  className,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // No community auth to manage — keep the theme control reachable on its own.
  if (!enabled && !user) {
    return <ThemeToggle />;
  }

  if (loading) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <div
          className="h-8 w-20 animate-pulse rounded-full border border-border bg-secondary/60"
          aria-hidden="true"
        />
        <ThemeToggle />
      </div>
    );
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      {user ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-full border border-border bg-secondary/60 py-1 pl-1 pr-2 text-sm font-medium transition-colors hover:bg-secondary"
        >
          <Avatar user={user} />
          <span className="truncate">{user.displayName}</span>
          <XLogo className="size-3.5 shrink-0 text-muted-foreground" />
          <ChevronDown
            className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      ) : (
        <Button
          type="button"
          size="sm"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="rounded-full"
        >
          Sign in
        </Button>
      )}

      {open ? (
        <div
          role={user ? "menu" : "dialog"}
          aria-label={user ? "Account" : "Sign in"}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-72 max-w-[calc(100vw-2rem)]"
        >
          {user ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-panel">
              <div className="flex items-center gap-2">
                <Avatar user={user} className="size-8 text-xs" />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">{user.displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">@{user.handle}</span>
                </div>
              </div>
              <div className="h-px bg-border" />
              <ThemeRow />
              <div className="h-px bg-border" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onSignOut?.();
                }}
                className="justify-start"
              >
                <LogOut className="size-4" aria-hidden="true" /> Sign out
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-panel">
              <SignInPrompt
                inline
                title="Sign in to IPO Hero"
                description="Browsing is open to everyone. Posting, replying, and voting need a quick sign-in."
                onSignInWithX={onSignInWithX}
                className="border-0 bg-transparent p-0 shadow-none"
              />
              <div className="h-px bg-border" />
              <ThemeRow />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
