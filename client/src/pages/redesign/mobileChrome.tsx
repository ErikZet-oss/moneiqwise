import { useState, type ReactNode } from "react";
import { CircleHelp, Layers, RefreshCw } from "lucide-react";
import { BrokerLogo } from "@/components/BrokerLogo";
import { usePortfolio } from "@/hooks/usePortfolio";
import { Dialog } from "@/redesign/ui";
import { cn } from "@/lib/utils";

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 px-[var(--rd-page-gutter)] pb-4 pt-1.5", className)}>
      {children}
    </div>
  );
}

export function KvRow({
  label,
  value,
  tone = "neutral",
}: {
  label: ReactNode;
  value: string;
  tone?: "neutral" | "up" | "down";
}) {
  const valueClass =
    tone === "up"
      ? "text-[var(--rd-profit)]"
      : tone === "down"
        ? "text-[var(--rd-loss)]"
        : "text-[var(--rd-text-primary)]";
  return (
    <div className="flex items-center gap-2">
      <div className="rd-type-body-sm min-w-0 flex-1 text-[var(--rd-text-secondary)]">{label}</div>
      <p className={cn("rd-type-data-sm shrink-0", valueClass)}>{value}</p>
    </div>
  );
}

export function toneOf(value: number): "neutral" | "up" | "down" {
  if (!Number.isFinite(value) || value === 0) return "neutral";
  return value > 0 ? "up" : "down";
}

export function signedMoney(formatCurrency: (n: number) => string, value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatCurrency(Math.abs(value))}`;
}

export function signedPct(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(digits)}%`;
}

export function IconButton({
  label,
  onClick,
  spinning,
  children,
}: {
  label: string;
  onClick?: () => void;
  spinning?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-primary)]"
    >
      {children ?? <RefreshCw className={cn("size-3.5", spinning && "animate-spin")} />}
    </button>
  );
}

export function HelpButton({
  title,
  body,
  compact = false,
}: {
  title: string;
  body: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={title}
        onClick={() => setOpen(true)}
        className={
          compact
            ? "inline-flex size-4 shrink-0 items-center justify-center text-[var(--rd-text-tertiary)]"
            : "inline-flex size-[30px] shrink-0 items-center justify-center text-[var(--rd-text-tertiary)]"
        }
      >
        <CircleHelp className="size-3.5" />
      </button>
      <Dialog open={open} title={title} body={body} onClose={() => setOpen(false)} />
    </>
  );
}

export function PortfolioSwitcher({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { portfolios, selectedPortfolioId, setSelectedPortfolioId } = usePortfolio();
  const pick = (id: string) => {
    setSelectedPortfolioId(id);
    onClose();
  };
  return (
    <Dialog open={open} title="Portfólio" body="Výber je zdieľaný s ostatnými obrazovkami." onClose={onClose}>
      <div className="mt-3 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => pick("all")}
          className={cn(
            "flex min-h-[40px] items-center gap-2 rounded-[var(--rd-radius-sm)] px-2 text-left text-sm",
            selectedPortfolioId === "all" ? "text-[var(--rd-profit)]" : "text-[var(--rd-text-primary)]",
          )}
        >
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-secondary)]">
            <Layers className="size-3.5" aria-hidden />
          </span>
          Všetky portfóliá
        </button>
        {portfolios.map((portfolio) => (
          <button
            key={portfolio.id}
            type="button"
            onClick={() => pick(portfolio.id)}
            className={cn(
              "flex min-h-[40px] items-center gap-2 rounded-[var(--rd-radius-sm)] px-2 text-left text-sm",
              selectedPortfolioId === portfolio.id ? "text-[var(--rd-profit)]" : "text-[var(--rd-text-primary)]",
            )}
          >
            {portfolio.brokerCode ? (
              <BrokerLogo brokerCode={portfolio.brokerCode} size="xs" />
            ) : (
              <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-secondary)]">
                <Layers className="size-3" aria-hidden />
              </span>
            )}
            {portfolio.name}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

export const CHART_COLORS = [
  "var(--rd-chart-1)",
  "var(--rd-chart-2)",
  "var(--rd-chart-3)",
  "var(--rd-chart-4)",
  "var(--rd-chart-5)",
  "var(--rd-chart-6)",
];
