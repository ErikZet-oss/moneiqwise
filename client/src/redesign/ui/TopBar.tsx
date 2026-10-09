import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function TopBar({
  title,
  overline,
  onOverlineClick,
  className,
  trailing,
}: {
  title: string;
  overline?: string;
  onOverlineClick?: () => void;
  className?: string;
  trailing?: ReactNode;
}) {
  return (
    <header
      className={cn(
        "flex items-center gap-2 bg-[var(--rd-bg-base)] px-[var(--rd-page-gutter)] py-2.5",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {overline ? (
          onOverlineClick ? (
            <button
              type="button"
              onClick={onOverlineClick}
              className="rd-type-overline mb-0.5 inline-flex items-center gap-1 text-[var(--rd-text-tertiary)]"
            >
              {overline}
              <ChevronDown className="size-3" aria-hidden />
            </button>
          ) : (
            <p className="rd-type-overline mb-0.5 text-[var(--rd-text-tertiary)]">{overline}</p>
          )
        ) : null}
        <h1 className="rd-type-h1 truncate text-[var(--rd-text-primary)]">{title}</h1>
      </div>
      {trailing}
    </header>
  );
}
