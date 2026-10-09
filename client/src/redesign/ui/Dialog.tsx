import type { ReactNode } from "react";
import { X, CircleHelp } from "lucide-react";

export function Dialog({
  open,
  title,
  body,
  onClose,
  children,
  showHelpIcon = true,
}: {
  open: boolean;
  title: string;
  body?: string;
  onClose: () => void;
  children?: ReactNode;
  showHelpIcon?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 sm:items-center" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rd-dialog-title"
        className="w-full max-w-sm rounded-[var(--rd-radius-lg)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          {showHelpIcon ? <CircleHelp className="size-4 shrink-0 text-[var(--rd-info)]" aria-hidden /> : null}
          <h2 id="rd-dialog-title" className="rd-type-h2 min-w-0 flex-1 text-[var(--rd-text-primary)]">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zavrieť"
            className="inline-flex size-[30px] items-center justify-center text-[var(--rd-text-secondary)]"
          >
            <X className="size-4" />
          </button>
        </div>
        {body ? <p className="rd-type-body text-[var(--rd-text-secondary)]">{body}</p> : null}
        {children}
      </div>
    </div>
  );
}
