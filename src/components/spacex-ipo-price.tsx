import { cn } from "../lib/utils";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * SpaceX (SPCX) IPO offering price, fixed at $135.00/share, listing on Nasdaq as
 * SPCX. Static disclosed figure — not a quote, valuation, or recommendation.
 */
const IPO_PRICE_USD = 135;

export function SpacexIpoPrice({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-secondary/60 px-3 py-1 text-sm",
        className,
      )}
      role="status"
      title="SPCX IPO offering price · fixed $135.00/share · disclosed figure, not investment advice"
      aria-label={`SPCX IPO offering price ${usd.format(IPO_PRICE_USD)}`}
    >
      <span className="font-semibold tracking-tight text-muted-foreground">SPCX</span>
      <span className="hidden text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground sm:inline">
        IPO price
      </span>
      <span className="font-semibold tabular-nums text-foreground">{usd.format(IPO_PRICE_USD)}</span>
    </div>
  );
}
