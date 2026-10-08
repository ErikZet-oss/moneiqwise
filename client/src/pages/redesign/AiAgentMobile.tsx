import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import AiAlerts from "@/pages/AiAlerts";
import AiBot from "@/pages/AiBot";
import AiPaperBot from "@/pages/AiPaperBot";
import AiSkener from "@/pages/AiSkener";
import { Chip, TopBar } from "@/redesign/ui";

type TabId = "bot" | "paper" | "alerts" | "skener";

function tabFromPath(path: string): TabId {
  if (path.includes("/paper")) return "paper";
  if (path.includes("/skener")) return "skener";
  if (path.includes("/alerty") || path.includes("/alerts")) return "alerts";
  return "bot";
}

const TABS: { id: TabId; label: string; href: string; testId: string }[] = [
  { id: "bot", label: "AI Bot", href: "/ai-agent/bot", testId: "tab-ai-bot" },
  { id: "paper", label: "Paper", href: "/ai-agent/paper", testId: "tab-ai-paper" },
  { id: "alerts", label: "Alerty", href: "/ai-agent/alerty", testId: "tab-ai-alerts" },
  { id: "skener", label: "Skener", href: "/ai-agent/skener", testId: "tab-ai-skener" },
];

export default function AiAgentMobile() {
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

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline="Bot · Paper · Alerty · Skener" title="AI Agent" />
      <div className="flex flex-col gap-4 px-4 pb-8 pt-2">
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
          Audit bot, Paper trading, Alerty a Skener tipov z trhu.
        </p>
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="AI Agent sekcie">
          {TABS.map((item) => (
            <Chip
              key={item.id}
              active={tab === item.id}
              role="tab"
              aria-selected={tab === item.id}
              className="shrink-0"
              data-testid={item.testId}
              onClick={() => setLocation(item.href)}
            >
              {item.label}
              {item.id === "alerts" && badgeLabel ? (
                <span className="ml-1 font-mono text-[11px]">{badgeLabel}</span>
              ) : null}
            </Chip>
          ))}
        </div>
        <div className="min-w-0">
          {tab === "bot" ? (
            <AiBot embedded />
          ) : tab === "paper" ? (
            <AiPaperBot embedded />
          ) : tab === "alerts" ? (
            <AiAlerts embedded />
          ) : (
            <AiSkener embedded />
          )}
        </div>
      </div>
    </div>
  );
}
