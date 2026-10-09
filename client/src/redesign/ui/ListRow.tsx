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
      <span className="rd-type-body min-w-0 flex-1 truncate text-[var(--rd-text-primary)]">{label}</span>
      {value ? <span className="rd-type-body-sm shrink-0 text-[var(--rd-text-secondary)]">{value}</span> : null}
      {showChevron ? <ChevronRight className="size-3.5 shrink-0 text-[var(--rd-text-tertiary)]" aria-hidden /> : null}
    </>
  );
  const classes = cn("flex min-h-[40px] w-full items-center gap-2 py-2.5 text-left", className);
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}
