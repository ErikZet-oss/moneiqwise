import { cn } from "@/lib/utils";

export function Radio({
  checked,
  label,
  name,
  value,
  onChange,
}: {
  checked: boolean;
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-h-[40px] items-center gap-2 text-[13px] leading-[18px] text-[var(--rd-text-primary)]">
      <input
        type="radio"
        className="sr-only"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-full border",
          checked ? "border-[var(--rd-profit)]" : "border-[var(--rd-border-strong)]",
        )}
        aria-hidden
      >
        {checked ? <span className="size-2.5 rounded-full bg-[var(--rd-profit)]" /> : null}
      </span>
      {label}
    </label>
  );
}

export function RadioGroup({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div role="radiogroup" className="flex flex-col">
      {options.map((option) => (
        <Radio
          key={option.value}
          name={name}
          value={option.value}
          label={option.label}
          checked={value === option.value}
          onChange={onChange}
        />
      ))}
    </div>
  );
}
