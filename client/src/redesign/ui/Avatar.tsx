import { CompanyLogo } from "@/components/CompanyLogo";
import { cn } from "@/lib/utils";

export function Avatar({
  ticker,
  companyName,
  imageUrl,
  className,
}: {
  ticker: string;
  companyName?: string;
  imageUrl?: string | null;
  className?: string;
}) {
  return (
    <CompanyLogo
      ticker={ticker}
      companyName={companyName}
      imageUrl={imageUrl}
      size="md"
      className={cn(
        "!size-[28px] shrink-0 rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-secondary)] [&_img]:object-contain",
        className,
      )}
    />
  );
}
