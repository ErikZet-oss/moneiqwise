import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import {
  BarChart3,
  Brain,
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
  "/tax": Scale,
  "/options": Target,
  "/import": Upload,
  "/faq": CircleHelp,
};

function isOnPath(current: string, target: string): boolean {
  if (target === "/") return current === "/";
  if (target === "/ai-agent/bot") {
    return current === "/ai-agent" || current.startsWith("/ai-agent/");
  }
  return current === target || current.startsWith(`${target}/`);
}

export function QuickNavFab() {
  const { enabled, items, appearance } = useQuickNavFab();
  const [location, setLocation] = useLocation();

  if (!enabled || items.length === 0) return null;

  const isDark = appearance === "dark";

  const bar = (
    <nav
      aria-label="Rýchla navigácia"
      data-testid="quick-nav-bar"
      className={cn(
        "fixed z-50 left-1/2 -translate-x-1/2",
        "bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))]",
        "w-[min(22.5rem,calc(100vw-1.5rem))]",
        "rounded-full border px-1.5 py-1.5",
        "backdrop-blur-xl shadow-lg",
        "pointer-events-auto",
        isDark
          ? "bg-[#1c1f26]/92 border-white/12 shadow-black/40 text-white"
          : "bg-white/90 border-black/8 shadow-black/10 text-zinc-900",
      )}
    >
      <ul className="flex items-stretch justify-between gap-0.5">
        {items.map((path) => {
          const section = getQuickNavSection(path);
          if (!section) return null;
          const Icon = ICON_BY_PATH[path] ?? BarChart3;
          const active = isOnPath(location, path);
          return (
            <li key={path} className="min-w-0 flex-1">
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
                      ? "bg-white/14 text-white"
                      : "bg-zinc-900/8 text-zinc-900"
                    : isDark
                      ? "text-white/70 hover:text-white/90"
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
  );

  if (typeof document === "undefined") return bar;
  return createPortal(bar, document.body);
}

/** Výška rezervy pre obsah, keď je spodný bar zapnutý. */
export const QUICK_NAV_CONTENT_PAD =
  "pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))]";
