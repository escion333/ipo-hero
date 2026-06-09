import { useSpacexPrice } from "../hooks/use-spacex-price";
import { cn } from "../lib/utils";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Compact nav-bar ticker for the live SPCX mid price (Hyperliquid `xyz` DEX).
 * Market data only — not a quote, valuation, or recommendation.
 */
export function SpacexPriceTicker({ className }: { className?: string }) {
  const { price, direction, status } = useSpacexPrice();
  const live = status === "live";
  const hasPrice = price != null;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-sm",
        className,
      )}
      role="status"
      aria-live="off"
      title="SPCX live pre-market mid price · Hyperliquid xyz DEX · market data, not investment advice"
      aria-label={
        hasPrice
          ? `SPCX pre-market price ${usd.format(price)}`
          : "SPCX pre-market price unavailable"
      }
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-2 shrink-0 rounded-full",
          live ? "bg-good animate-pulse" : status === "stale" ? "bg-warn" : "bg-muted-foreground",
        )}
      />
      <span className="font-semibold tracking-tight text-muted-foreground">SPCX</span>
      <span className="hidden text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground sm:inline">
        Pre-market
      </span>
      <span
        className={cn(
          "font-semibold tabular-nums",
          direction === "up" ? "text-good" : direction === "down" ? "text-warn" : "text-foreground",
        )}
      >
        {hasPrice ? usd.format(price) : "—"}
      </span>
    </div>
  );
}
