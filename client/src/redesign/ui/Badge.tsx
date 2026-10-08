import { cn } from "@/lib/utils";

export type BadgeTone = "Neutral" | "Profit" | "Loss" | "Warning" | "Info" | "AI";

const toneClass: Record<BadgeTone, string> = {
  Neutral: "bg-[var(--rd-bg-surface-hover)] text-[var(--rd-text-secondary)]",
  Profit: "bg-[var(--rd-profit-dim)] text-[var(--rd-profit)]",
  Loss: "bg-[var(--rd-loss-dim)] text-[var(--rd-loss)]",
  Warning: "bg-[var(--rd-warning-dim)] text-[var(--rd-warning)]",
  Info: "bg-[var(--rd-info-dim)] text-[var(--rd-info)]",
  AI: "bg-[var(--rd-ai-dim)] text-[var(--rd-ai)]",
};

export function Badge({
  label,
  tone = "Neutral",
  className,
}: {
  label: string;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--rd-radius-xs)] px-2 py-1 text-[11px] font-semibold uppercase leading-[14px] tracking-[0.08em]",
        toneClass[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
