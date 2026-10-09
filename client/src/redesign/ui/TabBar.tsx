import {
  Banknote,
  Brain,
  CalendarClock,
  CircleHelp,
  Clock,
  Eye,
  Home,
  Layers,
  LineChart,
  Menu,
  PieChart,
  Scale,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useLocation } from "wouter";
import { useQuickNavFab } from "@/hooks/useQuickNavFab";
import {
  DEFAULT_QUICK_NAV_ITEMS,
  getQuickNavSection,
} from "@/lib/quickNavSections";
import { cn } from "@/lib/utils";

const ICON_BY_PATH: Record<string, LucideIcon> = {
  "/": Home,
  "/overview": Layers,
  "/allocation": PieChart,
  "/grafy": LineChart,
  "/goal": Target,
  "/history": Clock,
  "/profit": TrendingUp,
  "/dividends": Banknote,
  "/events": CalendarClock,
  "/watchlist": Eye,
  "/ai-agent/bot": Brain,
  "/ai-macro-audit": Sparkles,
  "/tax": Scale,
  "/options": Target,
  "/import": Upload,
  "/faq": CircleHelp,
};

const FALLBACK_ITEMS = ["/", "/overview", "/history", "/ai-agent/bot"] as const;

function isOnPath(current: string, target: string): boolean {
  if (target === "/") return current === "/";
  if (target === "/ai-agent/bot") {
    return current === "/ai-agent" || current.startsWith("/ai-agent/");
  }
  if (target === "/more") {
    return (
      current === "/more" ||
      current === "/settings" ||
      current.startsWith("/settings/")
    );
  }
  return current === target || current.startsWith(`${target}/`);
}

function tabLabel(path: string): string {
  if (path === "/more") return "Viac";
  return getQuickNavSection(path)?.shortLabel ?? getQuickNavSection(path)?.label ?? path;
}

function tabIcon(path: string): LucideIcon {
  if (path === "/more") return Menu;
  return ICON_BY_PATH[path] ?? Home;
}

export function activeRedesignTab(location: string): string {
  if (location === "/") return "/";
  if (location === "/more" || location === "/settings" || location.startsWith("/settings/")) {
    return "/more";
  }
  if (location === "/ai-agent" || location.startsWith("/ai-agent/")) return "/ai-agent/bot";
  return location;
}

/** @deprecated kept for callers expecting RedesignTabId union */
export type RedesignTabId = "prehľad" | "portfólio" | "história" | "ai" | "viac";

export function TabBar() {
  const [location, setLocation] = useLocation();
  const { enabled, items } = useQuickNavFab();

  const slotPaths = enabled
    ? items.length > 0
      ? items
      : [...DEFAULT_QUICK_NAV_ITEMS]
    : [...FALLBACK_ITEMS];

  const tabs = [...slotPaths.slice(0, 4).map((path) => ({ path })), { path: "/more" }];

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] px-1.5 pt-1.5 pb-[max(16px,env(safe-area-inset-bottom))]"
      data-testid="redesign-tab-bar"
      aria-label="Hlavná navigácia"
    >
      {tabs.map((tab) => {
        const Icon = tabIcon(tab.path);
        const isActive = isOnPath(location, tab.path);
        const label = tabLabel(tab.path);
        return (
          <button
            key={tab.path}
            type="button"
            onClick={() => setLocation(tab.path)}
            className="flex min-h-[40px] min-w-0 flex-1 flex-col items-center gap-0.5 py-1"
            aria-current={isActive ? "page" : undefined}
            data-testid={`tab-${tab.path === "/" ? "home" : tab.path.slice(1).replace(/\//g, "-")}`}
          >
            <Icon
              className={cn("size-[18px]", isActive ? "text-[var(--rd-profit)]" : "text-[var(--rd-text-tertiary)]")}
              strokeWidth={1.75}
            />
            <span
              className={cn(
                "max-w-full truncate px-0.5 text-[11px] font-medium leading-[14px] tracking-normal",
                isActive ? "text-[var(--rd-text-primary)]" : "text-[var(--rd-text-tertiary)]",
              )}
            >
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
