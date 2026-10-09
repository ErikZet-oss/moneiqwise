import type { ReactNode } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/redesign/ui";

export function RedesignUnlockScreen({
  unlocking,
  error,
  onUnlock,
}: {
  unlocking: boolean;
  error: string | null;
  onUnlock: () => void;
}) {
  return (
    <div className="rd-app-shell flex min-h-dvh items-center justify-center bg-[var(--rd-bg-base)] px-3 text-[var(--rd-text-primary)]">
      <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-[var(--rd-radius-lg)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-5 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-[var(--rd-profit-dim)] text-[var(--rd-profit)]">
          <KeyRound className="size-5" aria-hidden />
        </div>
        <h1 className="rd-type-h1">Odomkni aplikáciu</h1>
        <p className="rd-type-body text-[var(--rd-text-secondary)]">
          Pred pokračovaním over svoju identitu cez passkey (odtlačok, Face ID alebo PIN zariadenia).
        </p>
        <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
          {error ?? "Overenie sa spúšťa automaticky. Ak sa dialóg nezobrazil, použi tlačidlo nižšie."}
        </p>
        <Button className="w-full" onClick={onUnlock} disabled={unlocking} data-testid="button-passkey-unlock">
          {unlocking ? "Overujem..." : "Overiť passkey"}
        </Button>
      </div>
    </div>
  );
}

export function RedesignStatusScreen({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="rd-app-shell flex min-h-dvh items-center justify-center bg-[var(--rd-bg-base)] px-3 text-[var(--rd-text-primary)]">
      <div className="w-full max-w-md space-y-2 rounded-[var(--rd-radius-lg)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] p-5 text-center">
        <h2 className="rd-type-h2">{title}</h2>
        <p className="rd-type-body text-[var(--rd-text-secondary)]">{body}</p>
        {children}
      </div>
    </div>
  );
}
