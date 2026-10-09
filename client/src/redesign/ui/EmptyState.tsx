import type { ReactNode } from "react";
import { LineChart } from "lucide-react";
import { Button, type RedesignButtonVariant } from "./Button";

export function EmptyState({
  title = "Zatiaľ žiadne dáta",
  body,
  actionLabel,
  onAction,
  actionVariant = "Secondary",
  icon,
  children,
}: {
  title?: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: RedesignButtonVariant;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-1.5 rounded-[var(--rd-radius-md)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-4 text-center [background-image:var(--rd-bg-surface-gradient)]">
      <div className="flex size-11 items-center justify-center rounded-full bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-secondary)]">
        {icon ?? <LineChart className="size-5" aria-hidden />}
      </div>
      <p className="rd-type-h3 text-[var(--rd-text-primary)]">{title}</p>
      {body ? <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">{body}</p> : null}
      {actionLabel && onAction ? (
        <Button variant={actionVariant} onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
      {children}
    </div>
  );
}
