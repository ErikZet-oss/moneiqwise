import { Badge, type BadgeTone } from "./Badge";

export function NewsRow({
  ticker,
  tone = "Neutral",
  meta,
  headline,
}: {
  ticker: string;
  tone?: BadgeTone;
  meta: string;
  headline: string;
}) {
  return (
    <div className="flex w-full flex-col gap-2 py-3">
      <div className="flex items-center gap-2">
        <Badge label={ticker} tone={tone} />
        <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">{meta}</p>
      </div>
      <p className="text-sm font-semibold leading-5 text-[var(--rd-text-primary)]">{headline}</p>
    </div>
  );
}
