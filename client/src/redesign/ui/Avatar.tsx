import { cn } from "@/lib/utils";

export function Avatar({
  ticker,
  className,
}: {
  ticker: string;
  className?: string;
}) {
  const letters = ticker.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "—";
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] font-mono text-xs font-medium leading-4 text-[var(--rd-text-secondary)]",
        className,
      )}
      aria-hidden
    >
      {letters}
    </span>
  );
}
