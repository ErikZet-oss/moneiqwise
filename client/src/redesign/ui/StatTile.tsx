import type { ReactNode } from "react";
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
  sub?: ReactNode;
  tone?: StatTone;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-[var(--rd-radius-md)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-2 [background-image:var(--rd-bg-surface-gradient)]",
        className,
      )}
    >
      <p className="rd-type-overline truncate text-[var(--rd-text-tertiary)]">{label}</p>
      <p className={cn("rd-type-data-lg truncate tracking-[-0.15px]", valueClass[tone])}>{value}</p>
      {sub ? (
        <div className="rd-type-data-sm truncate text-[var(--rd-text-secondary)]">{sub}</div>
      ) : null}
    </div>
  );
}
