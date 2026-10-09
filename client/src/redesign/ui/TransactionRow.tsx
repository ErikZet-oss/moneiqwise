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
    <div className="flex min-h-[40px] w-full items-center gap-2 py-2.5">
      <Avatar ticker={ticker} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="rd-type-data text-[var(--rd-text-primary)]">{ticker}</p>
          <Badge label={badge} tone={tone} />
        </div>
        <p className="rd-type-body-sm truncate text-[var(--rd-text-tertiary)]">{meta}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="rd-type-data text-[var(--rd-text-primary)]">{amount}</p>
        {unit ? <p className="rd-type-data-micro text-[var(--rd-text-tertiary)]">{unit}</p> : null}
      </div>
    </div>
  );
}
