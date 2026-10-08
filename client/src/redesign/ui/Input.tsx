import { useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({
  label,
  mono = true,
  className,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; mono?: boolean }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label htmlFor={inputId} className="flex w-full flex-col gap-2">
      {label ? (
        <span className="text-[13px] font-medium leading-4 text-[var(--rd-text-secondary)]">{label}</span>
      ) : null}
      <input
        id={inputId}
        className={cn(
          "min-h-11 w-full rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] px-3 py-3 text-sm leading-5 text-[var(--rd-text-primary)] outline-none placeholder:text-[var(--rd-text-tertiary)] focus:border-[var(--rd-profit)]",
          mono && "font-mono font-medium",
          className,
        )}
        {...props}
      />
    </label>
  );
}
