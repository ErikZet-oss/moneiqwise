import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell, Brain, Bot, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import AiSkener from "@/pages/AiSkener";
import AiBot from "@/pages/AiBot";
import AiAlerts from "@/pages/AiAlerts";

type TabId = "bot" | "alerts" | "skener";

function tabFromPath(path: string): TabId {
  if (path.includes("/skener")) return "skener";
  if (path.includes("/alerty") || path.includes("/alerts")) return "alerts";
  return "bot";
}

export default function AiAgent() {
  const [location, setLocation] = useLocation();
  const tab = tabFromPath(location);

  const { data: unreadPayload } = useQuery<{ count: number }>({
    queryKey: ["/api/ai-bot/alerts/unread-count"],
    queryFn: async () => {
      const res = await fetch("/api/ai-bot/alerts/unread-count", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("unread");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const unread = unreadPayload?.count ?? 0;
  const badgeLabel = unread > 9 ? "9+" : unread > 0 ? String(unread) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-3 pb-8 md:space-y-4">
      <div className="space-y-1 px-0.5">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight md:text-xl">AI Agent</h1>
        </div>
        <p className="text-xs text-muted-foreground md:text-sm">
          Bot na denný audit, Alerty na pohyby a novinky, Skener na tipy z trhu.
        </p>
      </div>

      <div
        className="sticky top-0 z-20 -mx-1 grid grid-cols-3 gap-1 rounded-xl border bg-background/95 p-1 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        role="tablist"
        aria-label="AI Agent sekcie"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "bot"}
          className={cn(
            "flex h-10 items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition-colors sm:gap-1.5 sm:text-xs md:text-sm",
            tab === "bot"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          onClick={() => setLocation("/ai-agent/bot")}
          data-testid="tab-ai-bot"
        >
          <Bot className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">AI Bot</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "alerts"}
          className={cn(
            "relative flex h-10 items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition-colors sm:gap-1.5 sm:text-xs md:text-sm",
            tab === "alerts"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          onClick={() => setLocation("/ai-agent/alerty")}
          data-testid="tab-ai-alerts"
        >
          <Bell className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Alerty</span>
          {badgeLabel ? (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold",
                tab === "alerts"
                  ? "bg-primary-foreground text-primary"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {badgeLabel}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "skener"}
          className={cn(
            "flex h-10 items-center justify-center gap-1 rounded-lg text-[11px] font-medium transition-colors sm:gap-1.5 sm:text-xs md:text-sm",
            tab === "skener"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          onClick={() => setLocation("/ai-agent/skener")}
          data-testid="tab-ai-skener"
        >
          <ScanSearch className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">AI Skener</span>
        </button>
      </div>

      <div className="min-w-0">
        {tab === "bot" ? (
          <AiBot embedded />
        ) : tab === "alerts" ? (
          <AiAlerts embedded />
        ) : (
          <AiSkener embedded />
        )}
      </div>
    </div>
  );
}
