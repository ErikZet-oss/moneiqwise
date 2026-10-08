import { cn } from "@/lib/utils";

export type DeltaTrend = "Up" | "Down" | "Flat";

const trendClass: Record<DeltaTrend, string> = {
  Up: "bg-[var(--rd-profit-dim)] text-[var(--rd-profit)]",
  Down: "bg-[var(--rd-loss-dim)] text-[var(--rd-loss)]",
  Flat: "bg-[var(--rd-bg-surface-hover)] text-[var(--rd-text-secondary)]",
};

export function Delta({
  value,
  trend = "Flat",
  className,
}: {
  value: string;
  trend?: DeltaTrend;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--rd-radius-xs)] px-2 py-0.5 font-mono text-xs font-medium leading-4",
        trendClass[trend],
        className,
      )}
    >
      {value}
    </span>
  );
}

export function trendFromNumber(value: number): DeltaTrend {
  if (!Number.isFinite(value) || value === 0) return "Flat";
  return value > 0 ? "Up" : "Down";
}
