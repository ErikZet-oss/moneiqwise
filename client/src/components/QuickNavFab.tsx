import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import {
  BarChart3,
  Brain,
  CalendarClock,
  Eye,
  History,
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
import { Button } from "@/components/ui/button";
import { useQuickNavFab } from "@/hooks/useQuickNavFab";
import { getQuickNavSection } from "@/lib/quickNavSections";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

const ICON_BY_PATH: Record<string, LucideIcon> = {
  "/": BarChart3,
  "/overview": Layers,
  "/allocation": PieChart,
  "/grafy": LineChart,
  "/goal": Target,
  "/history": History,
  "/profit": TrendingUp,
  "/dividends": Banknote,
  "/events": CalendarClock,
  "/watchlist": Eye,
  "/ai-skener": Brain,
  "/tax": Scale,
  "/options": Target,
  "/import": Upload,
  "/faq": CircleHelp,
};

const FAB_POSITION_STYLE: React.CSSProperties = {
  position: "fixed",
  zIndex: 50,
  left: "auto",
  top: "auto",
  right: "calc(1rem + env(safe-area-inset-right, 0px))",
  bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
};

function isOnPath(current: string, target: string): boolean {
  if (target === "/") return current === "/";
  return current === target || current.startsWith(`${target}/`);
}

export function QuickNavFab() {
  const { enabled, path } = useQuickNavFab();
  const [location, setLocation] = useLocation();
  const isMobile = useIsMobile();

  if (!enabled) return null;

  const section = getQuickNavSection(path);
  if (!section || isOnPath(location, path)) return null;

  const Icon = ICON_BY_PATH[path] ?? Eye;

  const button = (
    <Button
      type="button"
      size="icon"
      aria-label={`Prejsť na ${section.label}`}
      title={isMobile ? section.label : undefined}
      style={FAB_POSITION_STYLE}
      className={cn(
        "rounded-full border-0 p-0",
        "h-10 w-10 md:h-11 md:w-11",
        "bg-gradient-to-br from-primary via-primary to-primary/70",
        "text-primary-foreground",
        "shadow-md shadow-primary/25 ring-1 ring-inset ring-white/20",
        "transition-all duration-200 ease-out",
        "hover:from-primary hover:via-primary/95 hover:to-primary/80",
        "hover:shadow-lg hover:shadow-primary/35 hover:brightness-105",
        "active:scale-95",
      )}
      onClick={() => setLocation(path)}
      data-testid="button-quick-nav-fab"
    >
      <Icon className="h-4 w-4 md:h-[18px] md:w-[18px]" strokeWidth={2.25} />
    </Button>
  );

  if (typeof document === "undefined") return button;

  return createPortal(button, document.body);
}
