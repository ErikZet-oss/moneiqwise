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

/** Figma redesign tokens: loss → warning → profit. */
const SCORE_RGB = {
  loss: [240, 102, 126] as const, // --rd-loss #f0667e
  warning: [242, 184, 75] as const, // --rd-warning #f2b84b
  profit: [47, 218, 184] as const, // --rd-profit #2fdab8
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function mixRgb(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): string {
  const tt = Math.max(0, Math.min(1, t));
  const r = Math.round(lerp(a[0], b[0], tt));
  const g = Math.round(lerp(a[1], b[1], tt));
  const bl = Math.round(lerp(a[2], b[2], tt));
  return `rgb(${r} ${g} ${bl})`;
}

/** Score 0–100 → red → amber → green (Figma health-score-bar / score-factor). */
export function scoreToBarColor(score: number): string {
  const t = Math.max(0, Math.min(100, score)) / 100;
  if (t < 0.5) return mixRgb(SCORE_RGB.loss, SCORE_RGB.warning, t * 2);
  return mixRgb(SCORE_RGB.warning, SCORE_RGB.profit, (t - 0.5) * 2);
}

/** Horizontal 6px pill bar — Figma `health-score-bar`. */
export function HealthScoreBar({
  score,
  className,
  interactive = false,
  onClick,
  "aria-label": ariaLabel,
}: {
  score: number | null;
  className?: string;
  interactive?: boolean;
  onClick?: () => void;
  "aria-label"?: string;
}) {
  const value = score == null ? 0 : Math.max(0, Math.min(100, score));
  const fill = score == null ? 0 : value;
  const color = score == null ? "var(--rd-text-tertiary, hsl(0 0% 45%))" : scoreToBarColor(value);
  const trackClass = cn(
    "relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--rd-bg-surface-hover,#272c32)]",
    className,
  );
  const fillEl = (
    <span
      className="absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-500 ease-out"
      style={{ width: `${fill}%`, backgroundColor: color }}
      aria-hidden
    />
  );

  if (interactive || onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className={cn(
          trackClass,
          "cursor-pointer outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--rd-ai,#b48ce0)]",
        )}
        data-testid="health-score-bar"
      >
        {fillEl}
      </button>
    );
  }

  return (
    <div className={trackClass} data-testid="health-score-bar" role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={ariaLabel}>
      {fillEl}
    </div>
  );
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
