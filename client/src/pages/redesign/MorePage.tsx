import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  Banknote,
  Brain,
  CalendarClock,
  ChevronRight,
  CircleHelp,
  Eye,
  History,
  Info,
  Layers,
  LineChart,
  LogOut,
  PieChart,
  Scale,
  Settings,
  Sparkles,
  Sun,
  Target,
  TrendingUp,
  Upload,
  UserCog,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useTheme } from "@/hooks/useTheme";
import { apiRequest, PORTFOLIO_QUERY_CACHE_KEY, queryClient } from "@/lib/queryClient";
import { Button, Card, Select, Toggle, TopBar } from "@/redesign/ui";
import { MobileUiToggle } from "@/redesign/MobileUiToggle";

type NavItem = {
  href: string;
  title: string;
  subtitle: string;
  icon: typeof Layers;
};

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Portfólio",
    items: [
      { href: "/overview", title: "Všetky portfóliá", subtitle: "Súhrn výkonnosti", icon: Layers },
      { href: "/allocation", title: "Rozloženie", subtitle: "Akcie, sektory, krajiny, typ", icon: PieChart },
      { href: "/grafy", title: "Grafy", subtitle: "Hodnota a výkon vs. S&P 500", icon: LineChart },
      { href: "/goal", title: "Môj cieľ", subtitle: "Simulácia a plán", icon: Target },
    ],
  },
  {
    title: "Aktivita",
    items: [
      { href: "/history", title: "História", subtitle: "Transakcie a export", icon: History },
      { href: "/profit", title: "Zisk", subtitle: "Realizovaný zisk a výkonnosť", icon: TrendingUp },
      { href: "/dividends", title: "Dividendy", subtitle: "Kalendár a yield", icon: Banknote },
      { href: "/events", title: "Kalendár udalostí", subtitle: "Earnings, dividendy, makro", icon: CalendarClock },
      { href: "/watchlist", title: "Watchlist", subtitle: "Sledované tituly", icon: Eye },
      { href: "/options", title: "Opcie", subtitle: "Opčné obchody", icon: Target },
    ],
  },
  {
    title: "AI",
    items: [
      { href: "/ai-agent/bot", title: "AI Agent", subtitle: "Bot, paper, alerty, skener", icon: Brain },
      { href: "/ai-macro-audit", title: "AI Macro Audit", subtitle: "Health score a makro riziká", icon: Sparkles },
    ],
  },
  {
    title: "Nástroje",
    items: [
      { href: "/tax", title: "Daňový asistent", subtitle: "Ročné súčty", icon: Scale },
      { href: "/import", title: "Import brokera", subtitle: "XTB, eToro", icon: Upload },
      { href: "/settings", title: "Nastavenia", subtitle: "Passkeys, mena, portfóliá", icon: Settings },
      { href: "/faq", title: "FAQ", subtitle: "Ako Moneiqwise funguje", icon: CircleHelp },
    ],
  },
];

export default function MorePage() {
  const [, setLocation] = useLocation();
  const { user, isDemo } = useAuth();
  const { portfolios, selectedPortfolioId, setSelectedPortfolioId, isAllPortfolios, selectedPortfolio } = usePortfolio();
  const { theme, toggleTheme } = useTheme();
  const [exiting, setExiting] = useState(false);

  const portfolioName = isAllPortfolios ? "Všetky portfóliá" : selectedPortfolio?.name || "Vybrať portfólio";
  const accountLine = [user?.firstName, user?.email].filter(Boolean).join(" · ") || "Účet";

  const exitDemo = async () => {
    setExiting(true);
    try {
      await fetch("/api/demo/exit", { method: "POST", credentials: "include" });
      queryClient.setQueryData(["/api/auth/user"], null);
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    } finally {
      setExiting(false);
    }
  };

  const logout = async () => {
    await apiRequest("POST", "/api/logout");
    queryClient.clear();
    try {
      localStorage.removeItem(PORTFOLIO_QUERY_CACHE_KEY);
    } catch {
      // ignore
    }
    window.location.href = "/";
  };

  const toolItems = user?.isRegistrationAdmin
    ? [
        ...GROUPS[3]!.items,
        {
          href: "/admin/registrations",
          title: "Registrácie",
          subtitle: "Schvaľovanie účtov",
          icon: UserCog,
        },
      ]
    : GROUPS[3]!.items;

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar title="Viac" overline={portfolioName} />
      <div className="flex flex-col gap-4 px-4 pb-6">
        {isDemo ? (
          <Card className="gap-4 border-[var(--rd-info-dim)] bg-[var(--rd-info-dim)]/40" data-testid="banner-demo-mode">
            <div className="flex gap-3">
              <Info className="mt-0.5 size-[18px] shrink-0 text-[var(--rd-info)]" aria-hidden />
              <div>
                <p className="text-sm font-semibold leading-5">Demo režim</p>
                <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
                  Toto nie je ostrý login. Bežný login je na úvodnej stránke po ukončení dema.
                </p>
              </div>
            </div>
            <Button variant="Secondary" className="w-full" disabled={exiting} onClick={() => void exitDemo()} data-testid="button-exit-demo">
              {exiting ? "Ukončujem…" : "Ukončiť demo"}
            </Button>
          </Card>
        ) : null}

        <Select
          label="Aktívne portfólio"
          value={selectedPortfolioId || "all"}
          onChange={(id) => setSelectedPortfolioId(id)}
          options={[
            { value: "all", label: "Všetky portfóliá" },
            ...portfolios.map((portfolio) => ({ value: portfolio.id, label: portfolio.name })),
          ]}
        />

        {GROUPS.slice(0, 3).map((group) => (
          <NavGroup key={group.title} title={group.title} items={group.items} onNavigate={setLocation} />
        ))}
        <NavGroup title="Nástroje" items={toolItems} onNavigate={setLocation} />

        <section className="flex flex-col gap-2">
          <h2 className="text-[13px] font-medium leading-4 text-[var(--rd-text-tertiary)]">Účet</h2>
          <Card className="gap-0 px-4 py-1">
            <div className="flex min-h-[62px] items-center gap-3 border-b border-[var(--rd-border-subtle)] py-3">
              <IconBubble icon={<Sun className="size-[18px]" />} />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-5">Svetlý režim</p>
                <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">Prepnúť tému aplikácie</p>
              </div>
              <Toggle checked={theme === "light"} onCheckedChange={() => toggleTheme()} label="Prepnúť na svetlý režim" />
            </div>
            <div className="flex min-h-[62px] items-center gap-3 border-b border-[var(--rd-border-subtle)] py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-5">Vzhľad</p>
                <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">Klasický alebo nový mobil</p>
              </div>
              <MobileUiToggle />
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex min-h-[62px] w-full items-center gap-3 py-3 text-left"
              data-testid="button-logout"
            >
              <IconBubble icon={<LogOut className="size-[18px]" />} />
              <div className="min-w-0">
                <p className="text-sm leading-5">Odhlásiť sa</p>
                <p className="truncate text-xs leading-4 text-[var(--rd-text-tertiary)]">{accountLine}</p>
              </div>
            </button>
          </Card>
        </section>
      </div>
    </div>
  );
}

function NavGroup({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  onNavigate: (href: string) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-medium leading-4 text-[var(--rd-text-tertiary)]">{title}</h2>
      <Card className="gap-0 px-4 py-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.href}
              type="button"
              onClick={() => onNavigate(item.href)}
              className="flex min-h-[62px] w-full items-center gap-3 border-b border-[var(--rd-border-subtle)] py-3 text-left last:border-b-0"
            >
              <IconBubble icon={<Icon className="size-[18px]" />} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-5">{item.title}</span>
                <span className="block text-xs leading-4 text-[var(--rd-text-tertiary)]">{item.subtitle}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-[var(--rd-text-tertiary)]" aria-hidden />
            </button>
          );
        })}
      </Card>
    </section>
  );
}

function IconBubble({ icon }: { icon: ReactNode }) {
  return (
    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[var(--rd-radius-sm)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-secondary)]">
      {icon}
    </span>
  );
}
