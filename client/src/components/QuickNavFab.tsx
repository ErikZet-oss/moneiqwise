import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import {
  BarChart3,
  Brain,
  Sparkles,
  CalendarClock,
  Eye,
  History,
  Home,
  Layers,
  LineChart,
  PieChart,
  Scale,
  Target,
  TrendingUp,
  Upload,
  Banknote,
  CircleHelp,
  type LucideIcon,
} from "lucide-react";
import { useQuickNavFab } from "@/hooks/useQuickNavFab";
import { useTheme } from "@/hooks/useTheme";
import { getQuickNavSection } from "@/lib/quickNavSections";
import { cn } from "@/lib/utils";

const ICON_BY_PATH: Record<string, LucideIcon> = {
  "/": Home,
  "/overview": Layers,
  "/allocation": PieChart,
  "/grafy": LineChart,
  "/goal": Target,
  "/history": History,
  "/profit": TrendingUp,
  "/dividends": Banknote,
  "/events": CalendarClock,
  "/watchlist": Eye,
  "/ai-agent/bot": Brain,
  "/ai-agent/alerty": Brain,
  "/ai-agent/skener": Brain,
  "/ai-skener": Brain,
  "/ai-macro-audit": Sparkles,
  "/tax": Scale,
  "/options": Target,
  "/import": Upload,
  "/faq": CircleHelp,
};

/** Šírka jedného slotu — panel rastie s počtom položiek. */
const SLOT_WIDTH_REM = 4.75;

function isOnPath(current: string, target: string): boolean {
  if (target === "/") return current === "/";
  if (target === "/ai-agent/bot") {
    return current === "/ai-agent" || current.startsWith("/ai-agent/");
  }
  return current === target || current.startsWith(`${target}/`);
}

export function QuickNavFab() {
  const { enabled, items } = useQuickNavFab();
  const { theme } = useTheme();
  const [location, setLocation] = useLocation();

  if (!enabled || items.length === 0) return null;

  const isDark = theme === "dark";
  const count = items.length;

  const bar = (
    <>
      {/* Soft fade so content doesn't collide with the floating bar */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-40 h-24",
          isDark
            ? "bg-gradient-to-t from-background via-background/80 to-transparent"
            : "bg-gradient-to-t from-background via-background/70 to-transparent",
        )}
      />
      <nav
        aria-label="Rýchla navigácia"
        data-testid="quick-nav-bar"
        style={{
          width: `min(${count * SLOT_WIDTH_REM + 0.75}rem, calc(100vw - 1.5rem))`,
        }}
        className={cn(
          "fixed z-50 left-1/2 -translate-x-1/2",
          "bottom-[max(0.85rem,env(safe-area-inset-bottom,0px))]",
          "rounded-full border px-1.5 py-1.5",
          "backdrop-blur-2xl",
          "pointer-events-auto transition-[width] duration-200 ease-out",
          "ring-1",
          isDark
            ? [
                "bg-[#12151c]/95 text-white",
                "border-white/25 ring-white/10",
                "shadow-[0_10px_40px_-8px_rgba(0,0,0,0.75),0_0_0_1px_rgba(255,255,255,0.06)]",
              ]
            : [
                "bg-white/95 text-zinc-900",
                "border-zinc-300/90 ring-black/5",
                "shadow-[0_12px_36px_-10px_rgba(0,0,0,0.28),0_2px_8px_-2px_rgba(0,0,0,0.12)]",
              ],
        )}
      >
        <ul className="flex items-stretch justify-center gap-0.5">
          {items.map((path) => {
            const section = getQuickNavSection(path);
            if (!section) return null;
            const Icon = ICON_BY_PATH[path] ?? BarChart3;
            const active = isOnPath(location, path);
            return (
              <li
                key={path}
                className="min-w-0"
                style={{ flex: `1 1 ${SLOT_WIDTH_REM}rem`, maxWidth: `${SLOT_WIDTH_REM + 0.5}rem` }}
              >
                <button
                  type="button"
                  data-testid={`quick-nav-item-${path === "/" ? "home" : path.replace(/^\//, "").replace(/\//g, "-")}`}
                  aria-current={active ? "page" : undefined}
                  aria-label={section.label}
                  onClick={() => {
                    if (!active) setLocation(path);
                  }}
                  className={cn(
                    "flex w-full flex-col items-center justify-center gap-0.5",
                    "rounded-full px-1.5 py-1.5",
                    "text-[10px] font-medium leading-tight tracking-tight",
                    "transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    active
                      ? isDark
                        ? "bg-white/18 text-white shadow-sm shadow-black/30"
                        : "bg-zinc-900/10 text-zinc-900 shadow-sm shadow-black/5"
                      : isDark
                        ? "text-white/75 hover:text-white"
                        : "text-zinc-500 hover:text-zinc-800",
                  )}
                >
                  <Icon
                    className="h-[18px] w-[18px] shrink-0"
                    strokeWidth={active ? 2.35 : 2}
                    aria-hidden
                  />
                  <span className="truncate max-w-full">{section.shortLabel}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );

  if (typeof document === "undefined") return bar;
  return createPortal(bar, document.body);
}

/** Výška rezervy pre obsah, keď je spodný bar zapnutý. */
export const QUICK_NAV_CONTENT_PAD =
  "pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))]";
