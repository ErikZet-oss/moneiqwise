import type { ReactNode } from "react";
import { LineChart } from "lucide-react";
import { Button, type RedesignButtonVariant } from "./Button";

export function EmptyState({
  title = "Zatiaľ žiadne dáta",
  body = "Popis prázdneho stavu a čo má používateľ urobiť ďalej.",
  actionLabel,
  onAction,
  actionVariant = "Secondary",
  icon,
}: {
  title?: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: RedesignButtonVariant;
  icon?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-3 rounded-[var(--rd-radius-md)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-6 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-secondary)]">
        {icon ?? <LineChart className="size-5" aria-hidden />}
      </div>
      <p className="text-[15px] font-semibold leading-5 text-[var(--rd-text-primary)]">{title}</p>
      <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">{body}</p>
      {actionLabel && onAction ? (
        <Button variant={actionVariant} onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
