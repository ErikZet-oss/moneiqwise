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
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--rd-radius-sm)] px-4 py-3 text-sm font-semibold leading-5 transition disabled:pointer-events-none disabled:opacity-50",
        variantClass[variant],
        className,
      )}
      {...props}
    />
  );
}
