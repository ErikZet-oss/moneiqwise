import { Avatar } from "./Avatar";
import { Badge, type BadgeTone } from "./Badge";

export function TransactionRow({
  ticker,
  badge = "Nákup",
  tone = "Profit",
  meta,
  amount,
  unit,
}: {
  ticker: string;
  badge?: string;
  tone?: BadgeTone;
  meta: string;
  amount: string;
  unit?: string;
}) {
  return (
    <div className="flex min-h-11 w-full items-center gap-3 py-3">
      <Avatar ticker={ticker} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-mono text-sm font-medium leading-5 text-[var(--rd-text-primary)]">{ticker}</p>
          <Badge label={badge} tone={tone} />
        </div>
        <p className="truncate text-xs leading-4 text-[var(--rd-text-tertiary)]">{meta}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-sm font-medium leading-5 text-[var(--rd-text-primary)]">{amount}</p>
        {unit ? <p className="font-mono text-[10px] leading-3 text-[var(--rd-text-tertiary)]">{unit}</p> : null}
      </div>
    </div>
  );
}
