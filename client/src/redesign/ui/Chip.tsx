import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Chip({
  active = false,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-[var(--rd-radius-full)] px-3 py-2 text-[13px] font-medium leading-4",
        active
          ? "border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-hover)] text-[var(--rd-text-primary)]"
          : "text-[var(--rd-text-tertiary)]",
        className,
      )}
      {...props}
    />
  );
}
