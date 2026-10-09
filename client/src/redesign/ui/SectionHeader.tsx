import { cn } from "@/lib/utils";

export function SectionHeader({
  title,
  action,
  onAction,
  className,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <h2 className="rd-type-h2 text-[var(--rd-text-primary)]">{title}</h2>
      {action ? (
        onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="rd-type-label text-[var(--rd-profit)]"
          >
            {action}
          </button>
        ) : (
          <span className="rd-type-label text-[var(--rd-profit)]">{action}</span>
        )
      ) : null}
    </div>
  );
}
