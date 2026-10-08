import { cn } from "@/lib/utils";

export type StatTone = "Neutral" | "Up" | "Down";

const valueClass: Record<StatTone, string> = {
  Neutral: "text-[var(--rd-text-primary)]",
  Up: "text-[var(--rd-profit)]",
  Down: "text-[var(--rd-loss)]",
};

export function StatTile({
  label,
  value,
  sub,
  tone = "Neutral",
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-[var(--rd-radius-md)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-3",
        className,
      )}
    >
      <p className="truncate text-[11px] font-semibold uppercase leading-[14px] tracking-[0.08em] text-[var(--rd-text-tertiary)]">
        {label}
      </p>
      <p
        className={cn(
          "truncate font-mono text-[17px] font-medium leading-6 tracking-[-0.01em]",
          valueClass[tone],
        )}
      >
        {value}
      </p>
      {sub ? (
        <p className="truncate font-mono text-xs font-medium leading-4 text-[var(--rd-text-secondary)]">
          {sub}
        </p>
      ) : null}
    </div>
  );
}
