import { useSpacexPrice } from "../hooks/use-spacex-price";
import { cn } from "../lib/utils";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * SpaceX (SPCX) IPO offering price, fixed at $135.00/share. Static disclosed
 * figure — not a quote or recommendation.
 */
const IPO_PRICE_USD = 135;

/**
 * Single combined SPCX chrome pill: the fixed IPO offering price alongside the
 * live pre-market mid (Hyperliquid `xyz` DEX). Disclosed/market data only —
 * not a quote, valuation, or recommendation.
 */
export function SpacexPrice({ className }: { className?: string }) {
  const { price, direction, status } = useSpacexPrice();
  const live = status === "live";
  const hasPrice = price != null;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2.5 rounded-full border border-border px-3 py-1 text-sm",
        className,
      )}
      role="status"
      aria-live="off"
      title="SPCX — IPO offering price $135.00/share and live pre-market mid (Hyperliquid xyz DEX). Disclosed and market data, not investment advice."
    >
      <span className="font-semibold tracking-tight">SPCX</span>

      <span className="inline-flex items-baseline gap-1.5">
        <span className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
          IPO
        </span>
        <span className="font-semibold tabular-nums">{usd.format(IPO_PRICE_USD)}</span>
      </span>

      <span aria-hidden="true" className="h-3.5 w-px bg-border" />

      <span className="hidden items-baseline gap-1.5 sm:inline-flex">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 self-center rounded-full",
            live ? "bg-good animate-pulse" : status === "stale" ? "bg-warn" : "bg-muted-foreground",
          )}
        />
        <span className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
          Pre
        </span>
        <span
          className={cn(
            "font-semibold tabular-nums",
            direction === "up" ? "text-good" : direction === "down" ? "text-warn" : "text-foreground",
          )}
        >
          {hasPrice ? usd.format(price) : "—"}
        </span>
      </span>
    </div>
  );
}
