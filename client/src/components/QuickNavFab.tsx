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
      className={cn(
        "fixed z-50 h-12 w-12 rounded-full shadow-lg left-auto",
        "bottom-[max(1rem,env(safe-area-inset-bottom))]",
        "right-[max(1rem,env(safe-area-inset-right))]",
        "md:bottom-[max(1.5rem,env(safe-area-inset-bottom))]",
        "md:right-[max(1.5rem,env(safe-area-inset-right))]",
        "bg-primary text-primary-foreground hover:bg-primary/90",
      )}
      onClick={() => setLocation(path)}
      data-testid="button-quick-nav-fab"
    >
      <Icon className="h-5 w-5" />
    </Button>
  );

  if (typeof document === "undefined") return button;

  return createPortal(button, document.body);
}
