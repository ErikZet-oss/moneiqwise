type Props = {
  price: number;
  low52: number;
  high52: number;
  formatLabel: (v: number) => string;
};

export function Range52Bar({ price, low52, high52, formatLabel }: Props) {
  if (!Number.isFinite(low52) || !Number.isFinite(high52) || high52 <= low52 || price <= 0) {
    return <p className="text-[9px] text-muted-foreground">52w rozpätie nedostupné</p>;
  }

  const pct = Math.min(100, Math.max(0, ((price - low52) / (high52 - low52)) * 100));

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1">
        <span className="text-[8px] font-medium uppercase tracking-wide text-muted-foreground shrink-0">
          52w
        </span>
        <div className="flex flex-1 items-center justify-between text-[8px] text-muted-foreground tabular-nums min-w-0">
          <span>{formatLabel(low52)}</span>
          <span className="text-foreground/80 px-0.5">{pct.toFixed(0)}%</span>
          <span>{formatLabel(high52)}</span>
        </div>
      </div>
      <div className="relative h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary/25"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border border-background bg-primary shadow-sm"
          style={{ left: `calc(${pct}% - 4px)` }}
        />
      </div>
    </div>
  );
}
