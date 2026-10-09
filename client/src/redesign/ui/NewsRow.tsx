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
    <div className="flex w-full flex-col gap-1.5 py-2.5">
      <div className="flex items-center gap-2">
        <Badge label={ticker} tone={tone} />
        <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">{meta}</p>
      </div>
      <p className="rd-type-body-strong text-[var(--rd-text-primary)]">{headline}</p>
    </div>
  );
}
