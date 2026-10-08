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
        "flex items-center gap-3 bg-[var(--rd-bg-base)] px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        {overline ? (
          onOverlineClick ? (
            <button
              type="button"
              onClick={onOverlineClick}
              className="mb-0.5 inline-flex items-center gap-1 text-[11px] font-semibold uppercase leading-[14px] tracking-[0.08em] text-[var(--rd-text-tertiary)]"
            >
              {overline}
              <ChevronDown className="size-3" aria-hidden />
            </button>
          ) : (
            <p className="mb-0.5 text-[11px] font-semibold uppercase leading-[14px] tracking-[0.08em] text-[var(--rd-text-tertiary)]">
              {overline}
            </p>
          )
        ) : null}
        <h1 className="truncate text-[22px] font-bold leading-7 tracking-[-0.01em] text-[var(--rd-text-primary)]">
          {title}
        </h1>
      </div>
      {trailing}
    </header>
  );
}
