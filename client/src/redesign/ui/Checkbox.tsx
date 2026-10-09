import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  id?: string;
}) {
  return (
    <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-[13px] leading-[18px] text-[var(--rd-text-primary)]">
      <input
        id={id}
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      <span
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-[var(--rd-radius-xs)] border",
          checked
            ? "border-[var(--rd-profit)] bg-[var(--rd-profit)] text-[var(--rd-text-on-brand)]"
            : "border-[var(--rd-border-strong)] bg-transparent",
        )}
        aria-hidden
      >
        {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
      </span>
      {label}
    </label>
  );
}
