import { cn } from "@/lib/utils";

type AiMacroScoreGaugeProps = {
  score: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
};

const SIZE = {
  sm: { w: 140, stroke: 10, font: "text-2xl", sub: "text-[10px]" },
  md: { w: 180, stroke: 12, font: "text-3xl", sub: "text-xs" },
  lg: { w: 220, stroke: 14, font: "text-4xl", sub: "text-sm" },
} as const;

/** Segmentovaný polkruhový gauge 0–100 (inšpirovaný getquin / macro factor UI). */
export function AiMacroScoreGauge({
  score,
  size = "md",
  className,
  label = "Health score",
}: AiMacroScoreGaugeProps) {
  const cfg = SIZE[size];
  const segments = 20;
  const value = score == null ? 0 : Math.max(0, Math.min(100, score));
  const filled = score == null ? 0 : Math.round((value / 100) * segments);

  const cx = cfg.w / 2;
  const cy = cfg.w / 2 + 8;
  const r = cfg.w / 2 - cfg.stroke - 4;
  const startAngle = Math.PI;
  const endAngle = 0;
  const gap = 0.04;

  const arcs = Array.from({ length: segments }, (_, i) => {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const a0 = startAngle + (endAngle - startAngle) * t0 + gap / 2;
    const a1 = startAngle + (endAngle - startAngle) * t1 - gap / 2;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    const large = a0 - a1 > Math.PI ? 1 : 0;
    const d = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
    const active = i < filled;
    return { d, active, i };
  });

  return (
    <div className={cn("relative mx-auto", className)} style={{ width: cfg.w, height: cfg.w * 0.62 }}>
      <svg width={cfg.w} height={cfg.w * 0.62} viewBox={`0 0 ${cfg.w} ${cfg.w * 0.62}`} aria-hidden>
        {arcs.map(({ d, active, i }) => (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={active ? "hsl(142 71% 45%)" : "hsl(0 0% 100% / 0.1)"}
            strokeWidth={cfg.stroke}
            strokeLinecap="butt"
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center justify-end pb-0.5">
        <span className={cn("text-muted-foreground", cfg.sub)}>{label}</span>
        <span className={cn("font-semibold tabular-nums tracking-tight text-foreground", cfg.font)}>
          {score == null ? "—" : Math.round(value)}
          <span className="text-muted-foreground text-[0.55em] font-medium"> / 100</span>
        </span>
      </div>
    </div>
  );
}
