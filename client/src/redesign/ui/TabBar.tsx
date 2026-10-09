import { Clock, Home, Menu, PieChart, Sparkles } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

export type RedesignTabId = "prehľad" | "portfólio" | "história" | "ai" | "viac";

const TABS: { id: RedesignTabId; label: string; href: string; icon: typeof Home }[] = [
  { id: "prehľad", label: "Prehľad", href: "/", icon: Home },
  { id: "portfólio", label: "Portfólio", href: "/overview", icon: PieChart },
  { id: "história", label: "História", href: "/history", icon: Clock },
  { id: "ai", label: "AI", href: "/ai-agent/bot", icon: Sparkles },
  { id: "viac", label: "Viac", href: "/more", icon: Menu },
];

export function activeRedesignTab(location: string): RedesignTabId {
  if (location === "/") return "prehľad";
  if (location === "/overview") return "portfólio";
  if (location === "/history") return "história";
  if (location === "/ai-agent" || location.startsWith("/ai-agent/")) return "ai";
  return "viac";
}

export function TabBar() {
  const [location, setLocation] = useLocation();
  const active = activeRedesignTab(location);

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] px-1.5 pt-1.5 pb-[max(16px,env(safe-area-inset-bottom))]"
      data-testid="redesign-tab-bar"
      aria-label="Hlavná navigácia"
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setLocation(tab.href)}
            className="flex min-h-[40px] flex-1 flex-col items-center gap-0.5 py-1"
            aria-current={isActive ? "page" : undefined}
            data-testid={`tab-${tab.id}`}
          >
            <Icon
              className={cn("size-[18px]", isActive ? "text-[var(--rd-profit)]" : "text-[var(--rd-text-tertiary)]")}
              strokeWidth={1.75}
            />
            <span
              className={cn(
                "text-[11px] font-medium leading-[14px] tracking-normal",
                isActive ? "text-[var(--rd-text-primary)]" : "text-[var(--rd-text-tertiary)]",
              )}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
