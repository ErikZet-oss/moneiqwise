import { useId } from "react";
import { cn } from "@/lib/utils";

type AiMacroScoreGaugeProps = {
  score: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
};

const SIZE = {
  sm: { w: 168, stroke: 14, font: "text-2xl", sub: "text-[10px]" },
  md: { w: 200, stroke: 16, font: "text-3xl", sub: "text-xs" },
  lg: { w: 240, stroke: 18, font: "text-4xl", sub: "text-sm" },
} as const;

/** Score 0–100 → red → amber → green (matches profit/loss greens in light theme). */
export function scoreToBarColor(score: number): string {
  const t = Math.max(0, Math.min(100, score)) / 100;
  // Hue: 0 (red) → 38 (amber) → 142 (green)
  const hue = t < 0.5 ? t * 2 * 38 : 38 + (t - 0.5) * 2 * (142 - 38);
  const sat = 78 - t * 8;
  const light = 52 - t * 6;
  return `hsl(${hue.toFixed(1)} ${sat.toFixed(0)}% ${light.toFixed(0)}%)`;
}

function polar(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy - r * Math.sin(angleRad),
  };
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
) {
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const sweep = startAngle - endAngle;
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
}

/** Smooth semicircle gauge — polished like the allocation donut, color by score. */
export function AiMacroScoreGauge({
  score,
  size = "md",
  className,
  label = "Health score",
}: AiMacroScoreGaugeProps) {
  const uid = useId().replace(/:/g, "");
  const cfg = SIZE[size];
  const value = score == null ? 0 : Math.max(0, Math.min(100, score));
  const progress = score == null ? 0 : value / 100;
  const barColor = score == null ? "hsl(0 0% 45%)" : scoreToBarColor(value);
  const barColorSoft =
    score == null ? "hsl(0 0% 35%)" : scoreToBarColor(Math.max(0, value - 12));

  const w = cfg.w;
  const h = cfg.w * 0.58;
  const cx = w / 2;
  const cy = h - 4;
  const r = w / 2 - cfg.stroke / 2 - 6;
  const startAngle = Math.PI;
  const endAngle = 0;
  const progressAngle = startAngle + (endAngle - startAngle) * progress;

  const trackPath = describeArc(cx, cy, r, startAngle, endAngle);
  const valuePath =
    progress > 0.001
      ? describeArc(cx, cy, r, startAngle, progressAngle)
      : "";

  const gradId = `macroGaugeGrad-${uid}`;
  const glowId = `macroGaugeGlow-${uid}`;

  return (
    <div
      className={cn("relative mx-auto", className)}
      style={{ width: w, height: h }}
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={barColorSoft} stopOpacity={0.85} />
            <stop offset="100%" stopColor={barColor} stopOpacity={1} />
          </linearGradient>
          <filter id={glowId} x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Track */}
        <path
          d={trackPath}
          fill="none"
          stroke="hsl(0 0% 100% / 0.1)"
          strokeWidth={cfg.stroke}
          strokeLinecap="round"
        />

        {/* Progress */}
        {valuePath ? (
          <path
            d={valuePath}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={cfg.stroke}
            strokeLinecap="round"
            filter={`url(#${glowId})`}
          />
        ) : null}
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center justify-end pb-0.5">
        <span className={cn("text-muted-foreground", cfg.sub)}>{label}</span>
        <span
          className={cn(
            "font-semibold tabular-nums tracking-tight text-foreground",
            cfg.font,
          )}
        >
          {score == null ? "—" : Math.round(value)}
          <span className="text-muted-foreground text-[0.55em] font-medium">
            {" "}
            / 100
          </span>
        </span>
      </div>
    </div>
  );
}
