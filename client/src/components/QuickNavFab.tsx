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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQuickNavFab } from "@/hooks/useQuickNavFab";
import { getQuickNavSection } from "@/lib/quickNavSections";
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

  if (!enabled) return null;

  const section = getQuickNavSection(path);
  if (!section || isOnPath(location, path)) return null;

  const Icon = ICON_BY_PATH[path] ?? Eye;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          aria-label={`Prejsť na ${section.label}`}
          className={cn(
            "fixed z-40 h-12 w-12 rounded-full shadow-lg",
            "bottom-4 right-4 md:bottom-6 md:right-6",
            "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
          onClick={() => setLocation(path)}
          data-testid="button-quick-nav-fab"
        >
          <Icon className="h-5 w-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left" className="text-xs">
        {section.label}
      </TooltipContent>
    </Tooltip>
  );
}
