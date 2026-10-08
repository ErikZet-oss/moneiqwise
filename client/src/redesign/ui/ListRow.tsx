import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function ListRow({
  label,
  value,
  icon,
  onClick,
  showChevron = true,
  className,
}: {
  label: string;
  value?: string;
  icon?: ReactNode;
  onClick?: () => void;
  showChevron?: boolean;
  className?: string;
}) {
  const content = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate text-sm leading-5 text-[var(--rd-text-primary)]">{label}</span>
      {value ? <span className="shrink-0 text-xs leading-4 text-[var(--rd-text-secondary)]">{value}</span> : null}
      {showChevron ? <ChevronRight className="size-4 shrink-0 text-[var(--rd-text-tertiary)]" aria-hidden /> : null}
    </>
  );
  const classes = cn("flex min-h-11 w-full items-center gap-3 py-4 text-left", className);
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}
