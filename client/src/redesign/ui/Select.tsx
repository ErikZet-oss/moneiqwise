import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string };

export function Select({
  label,
  value,
  options,
  onChange,
  placeholder = "Vybrať",
  className,
}: {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  return (
    <div className={cn("relative flex w-full flex-col gap-1.5", className)}>
      {label ? (
        <label htmlFor={id} className="rd-type-label text-[var(--rd-text-secondary)]">
          {label}
        </label>
      ) : null}
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex min-h-[40px] w-full items-center gap-2 rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] px-3 py-2 text-left text-[13px] leading-[18px] text-[var(--rd-text-primary)]"
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? placeholder}</span>
        <ChevronDown className="size-4 shrink-0 text-[var(--rd-text-tertiary)]" aria-hidden />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] py-1 shadow-lg"
        >
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={cn(
                  "flex min-h-[40px] w-full items-center px-3 text-left text-[13px] leading-[18px]",
                  option.value === value
                    ? "text-[var(--rd-profit)]"
                    : "text-[var(--rd-text-primary)]",
                )}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
