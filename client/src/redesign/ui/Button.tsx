import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type RedesignButtonVariant = "Primary" | "Secondary" | "Ghost";

const variantClass: Record<RedesignButtonVariant, string> = {
  Primary:
    "bg-[var(--rd-profit)] text-[var(--rd-text-on-brand)] hover:brightness-110",
  Secondary:
    "border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-primary)] hover:bg-[var(--rd-bg-surface-hover)]",
  Ghost: "bg-transparent text-[var(--rd-profit)] hover:bg-[var(--rd-profit-dim)]",
};

export function Button({
  variant = "Primary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: RedesignButtonVariant }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-[var(--rd-radius-sm)] px-3 py-2 text-[13px] font-semibold leading-[18px] transition disabled:pointer-events-none disabled:opacity-50",
        variantClass[variant],
        className,
      )}
      {...props}
    />
  );
}
