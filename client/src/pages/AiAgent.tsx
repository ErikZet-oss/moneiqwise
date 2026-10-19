import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell, Bot, LineChart, Search, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMobileRedesign } from "@/hooks/useMobileUi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import AiSkener from "@/pages/AiSkener";
import AiAlerts from "@/pages/AiAlerts";
import AiPaperBot from "@/pages/AiPaperBot";
import AiAgentMobile from "@/pages/redesign/AiAgentMobile";

type TabId = "bot" | "paper" | "alerts" | "skener";

function tabFromPath(path: string): TabId {
  if (path.includes("/paper")) return "paper";
  if (path.includes("/skener")) return "skener";
  if (path.includes("/alerty") || path.includes("/alerts")) return "alerts";
  return "bot";
}

function AiAgentClassic() {
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
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 60_000,
  });

  const unread = unreadPayload?.count ?? 0;
  const badgeLabel = unread > 9 ? "9+" : unread > 0 ? String(unread) : null;

  const tabs: Array<{ id: TabId; label: string; path: string; testId: string; icon: typeof Bot }> = [
    { id: "bot", label: "AI Bot", path: "/ai-agent/bot", testId: "tab-ai-bot", icon: Bot },
    { id: "paper", label: "Paper", path: "/ai-agent/paper", testId: "tab-ai-paper", icon: LineChart },
    { id: "alerts", label: "Alerty", path: "/ai-agent/alerty", testId: "tab-ai-alerts", icon: Bell },
    { id: "skener", label: "Skener", path: "/ai-agent/skener", testId: "tab-ai-skener", icon: Search },
  ];

  return (
    <div className="space-y-3 pb-8">
      <div className="space-y-1 px-0.5">
        <p className="text-[10px] font-semibold uppercase leading-3 tracking-[0.8px] text-tertiary">
          Bot · Paper · Alerty · Skener
        </p>
        <h1 className="text-lg font-semibold tracking-tight md:text-xl">AI Agent</h1>
        <p className="text-xs text-muted-foreground md:text-[13px]">
          Paper trading, Alerty a Skener. Makro + akcie na pozície sú v AI Macro Audit.
        </p>
      </div>

      <div
        className="sticky top-0 z-20 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-border bg-background p-[3px]"
        role="tablist"
        aria-label="AI Agent sekcie"
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[12px] font-medium transition-colors md:text-[13px]",
                active
                  ? "bg-secondary text-foreground shadow-sm"
                  : "text-tertiary hover:text-foreground",
              )}
              onClick={() => setLocation(t.path)}
              data-testid={t.testId}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t.label}</span>
              {t.id === "alerts" && badgeLabel ? (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-md bg-red-500/15 px-1 text-[10px] font-semibold text-red-500 dark:bg-[var(--rd-loss-dim)] dark:!text-[var(--rd-loss)]">
                  {badgeLabel}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="min-w-0">
        {tab === "bot" ? (
          <Card data-testid="card-ai-bot-moved">
            <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:px-5 md:py-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-500 dark:bg-[var(--rd-ai-dim)] dark:!text-[var(--rd-ai)]">
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <CardTitle className="text-base font-semibold md:!text-[17px] md:!leading-[22px]">
                  AI Bot je súčasťou Macro Auditu
                </CardTitle>
                <p className="text-xs text-muted-foreground leading-relaxed md:text-[13px] md:leading-[18px]">
                  Jedno Spustiť v <strong>AI Macro Audit</strong> teraz dá health skóre, makro riziká
                  aj konkrétne akcie BUY/SELL/TRIM/HOLD na každú pozíciu. Samostatný AI Bot brief už
                  nie je potrebný.
                </p>
              </div>
              <Button
                type="button"
                className="h-9 shrink-0 gap-1.5 self-start text-[13px] font-semibold md:self-center"
                onClick={() => setLocation("/ai-macro-audit")}
                data-testid="button-goto-ai-macro-audit"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Otvoriť AI Macro Audit
              </Button>
            </CardContent>
          </Card>
        ) : tab === "paper" ? (
          <AiPaperBot embedded />
        ) : tab === "alerts" ? (
          <AiAlerts embedded />
        ) : (
          <AiSkener embedded />
        )}
      </div>
    </div>
  );
}

export default function AiAgent() {
  const redesign = useMobileRedesign();
  return redesign ? <AiAgentMobile /> : <AiAgentClassic />;
}
