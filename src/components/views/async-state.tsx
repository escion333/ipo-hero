import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";

import { cn } from "../../lib/utils";

export type AsyncStatus = "idle" | "loading" | "success" | "error" | "empty";

type AsyncStateProps = {
  status: AsyncStatus;
  children: ReactNode;
  error?: ReactNode;
  empty?: ReactNode;
  loadingLabel?: string;
  className?: string;
};

/**
 * Renders children only on success; otherwise shows a status block for
 * idle/loading/error/empty. Encodes the four-state pattern from the standard.
 */
export function AsyncState({
  status,
  children,
  error,
  empty,
  loadingLabel = "Loading…",
  className,
}: AsyncStateProps) {
  if (status === "success") return <>{children}</>;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-6 py-12 text-center",
        className,
      )}
    >
      {status === "loading" || status === "idle" ? (
        <>
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{loadingLabel}</p>
        </>
      ) : status === "error" ? (
        <>
          <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
          <div className="text-sm text-foreground">{error ?? "Something went wrong."}</div>
        </>
      ) : (
        <>
          <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
          <div className="text-sm text-muted-foreground">{empty ?? "Nothing to show yet."}</div>
        </>
      )}
    </div>
  );
}
