import { cn } from "@/lib/utils";

export function Toggle({
  checked,
  onCheckedChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-[var(--rd-radius-full)] transition disabled:opacity-50",
        checked ? "bg-[var(--rd-profit)]" : "border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-hover)]",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 rounded-full bg-[var(--rd-text-primary)] transition",
          checked ? "translate-x-[18px] bg-[var(--rd-text-on-brand)]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
