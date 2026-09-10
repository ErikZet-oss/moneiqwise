import { useLocation } from "wouter";
import { Brain, Bot, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import AiSkener from "@/pages/AiSkener";
import AiBot from "@/pages/AiBot";

type TabId = "bot" | "skener";

function tabFromPath(path: string): TabId {
  if (path.includes("/skener")) return "skener";
  return "bot";
}

export default function AiAgent() {
  const [location, setLocation] = useLocation();
  const tab = tabFromPath(location);

  return (
    <div className="mx-auto max-w-3xl space-y-3 pb-8 md:space-y-4">
      <div className="space-y-1 px-0.5">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="text-lg font-semibold tracking-tight md:text-xl">AI Agent</h1>
        </div>
        <p className="text-xs text-muted-foreground md:text-sm">
          Skener na tipy z trhu a Bot na denný audit tvojho portfólia.
        </p>
      </div>

      <div
        className="sticky top-0 z-20 -mx-1 grid grid-cols-2 gap-1 rounded-xl border bg-background/95 p-1 backdrop-blur supports-[backdrop-filter]:bg-background/80"
        role="tablist"
        aria-label="AI Agent sekcie"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "bot"}
          className={cn(
            "flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors md:text-sm",
            tab === "bot"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          onClick={() => setLocation("/ai-agent/bot")}
          data-testid="tab-ai-bot"
        >
          <Bot className="h-3.5 w-3.5 shrink-0" />
          AI Bot
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "skener"}
          className={cn(
            "flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors md:text-sm",
            tab === "skener"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
          onClick={() => setLocation("/ai-agent/skener")}
          data-testid="tab-ai-skener"
        >
          <ScanSearch className="h-3.5 w-3.5 shrink-0" />
          AI Skener
        </button>
      </div>

      <div className="min-w-0">
        {tab === "bot" ? <AiBot embedded /> : <AiSkener embedded />}
      </div>
    </div>
  );
}
