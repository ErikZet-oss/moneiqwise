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
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 className="text-[17px] font-semibold leading-6 tracking-[-0.01em] text-[var(--rd-text-primary)]">
        {title}
      </h2>
      {action ? (
        onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="text-[13px] font-medium leading-4 text-[var(--rd-profit)]"
          >
            {action}
          </button>
        ) : (
          <span className="text-[13px] font-medium leading-4 text-[var(--rd-profit)]">{action}</span>
        )
      ) : null}
    </div>
  );
}
