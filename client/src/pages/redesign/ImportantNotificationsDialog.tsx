import { X } from "lucide-react";
import {
  formatNotificationDate,
  type PortfolioNotificationItem,
} from "@/lib/importantNotifications";
import { Badge, Button } from "@/redesign/ui";

export function ImportantNotificationsDialog({
  open,
  onClose,
  notifications,
}: {
  open: boolean;
  onClose: () => void;
  notifications: PortfolioNotificationItem[];
}) {
  if (!open) return null;
  const count = notifications.length;
  const countLabel = count > 99 ? "99+" : String(count);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3 sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rd-notifications-title"
        className="flex w-full max-w-sm max-h-[min(80vh,560px)] flex-col gap-2 rounded-[var(--rd-radius-lg)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] p-3 shadow-[0_8px_12px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
        data-testid="dialog-important-notifications"
      >
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <h2 id="rd-notifications-title" className="rd-type-h2 text-[var(--rd-text-primary)]">
              Dôležité notifikácie
            </h2>
            {count > 0 ? <Badge label={countLabel} tone="Loss" /> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zavrieť"
            className="inline-flex size-[18px] shrink-0 items-center justify-center text-[var(--rd-text-secondary)]"
          >
            <X className="size-[18px]" />
          </button>
        </div>

        {count === 0 ? (
          <p className="py-4 text-[11px] leading-[14px] text-[var(--rd-text-tertiary)]">
            Zatiaľ žiadne nové dôležité notifikácie.
          </p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {notifications.map((n, index) => (
              <li key={n.id}>
                {index > 0 ? <div className="h-px w-full bg-[var(--rd-border-subtle)]" /> : null}
                <div className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold leading-[18px] text-[var(--rd-text-primary)]">
                      {n.title}
                    </p>
                    <p className="text-[11px] font-normal leading-[14px] text-[var(--rd-text-tertiary)]">
                      {n.subtitle}
                    </p>
                    <p className="text-[10px] font-medium leading-[12px] text-[var(--rd-text-tertiary)]">
                      {formatNotificationDate(n.dateIso)}
                    </p>
                  </div>
                  {n.infoUrl ? (
                    <Button
                      variant="Secondary"
                      className="min-h-0 shrink-0 px-3 py-2"
                      onClick={() => window.open(n.infoUrl, "_blank", "noopener,noreferrer")}
                      data-testid={`button-notification-detail-${n.id}`}
                    >
                      Detail
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
