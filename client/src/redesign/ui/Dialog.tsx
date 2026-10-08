import type { ReactNode } from "react";
import { X, CircleHelp } from "lucide-react";

export function Dialog({
  open,
  title,
  body,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  body?: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 sm:items-center" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rd-dialog-title"
        className="w-full max-w-sm rounded-[var(--rd-radius-lg)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <CircleHelp className="size-[18px] shrink-0 text-[var(--rd-info)]" aria-hidden />
          <h2 id="rd-dialog-title" className="min-w-0 flex-1 text-[15px] font-semibold leading-5 text-[var(--rd-text-primary)]">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Zavrieť" className="inline-flex size-9 items-center justify-center text-[var(--rd-text-secondary)]">
            <X className="size-[18px]" />
          </button>
        </div>
        {body ? <p className="text-sm leading-5 text-[var(--rd-text-secondary)]">{body}</p> : null}
        {children}
      </div>
    </div>
  );
}
