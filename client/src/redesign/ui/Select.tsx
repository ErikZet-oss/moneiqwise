import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string };

export function Select({
  label,
  value,
  options,
  onChange,
  placeholder = "Vybrať",
  className,
  showCheck = false,
}: {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** Figma listbox: checkmark on selected row (e.g. Kategória on Portfóliá). */
  showCheck?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative flex w-full flex-col gap-1.5", className)}>
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
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-auto rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] p-1 shadow-[0_8px_12px_rgba(0,0,0,0.5)]"
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex min-h-[36px] w-full items-center gap-1.5 rounded-[var(--rd-radius-xs)] px-2 py-1.5 text-left text-[13px] leading-[18px]",
                    selected
                      ? showCheck
                        ? "bg-[var(--rd-bg-surface-hover,#272c32)] text-[var(--rd-text-primary)]"
                        : "text-[var(--rd-profit)]"
                      : "text-[var(--rd-text-primary)]",
                  )}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {showCheck && selected ? (
                    <Check className="size-4 shrink-0 text-[var(--rd-profit)]" aria-hidden />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
