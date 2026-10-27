import {
  Bot,
  Briefcase,
  Calendar,
  ChartSpline,
  Check,
  ChevronDown,
  CircleDollarSign,
  CircleHelp,
  Clock,
  FileText,
  Home,
  Layers,
  LineChart,
  LogOut,
  MessageSquare,
  PieChart,
  Settings,
  Sparkles,
  Star,
  Sun,
  Target,
  TrendingUp,
  Upload,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useTheme } from "@/hooks/useTheme";
import { BrokerLogo } from "@/components/BrokerLogo";
import { apiRequest, PORTFOLIO_QUERY_CACHE_KEY, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { User as UserType } from "@shared/schema";

type NavItem = { title: string; url: string; icon: LucideIcon };

/** Groups and order match the mobile „Viac“ page (Figma Web/Sidebar). */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Portfólio",
    items: [
      { title: "Prehľad", url: "/", icon: Home },
      { title: "Všetky portfóliá", url: "/overview", icon: Layers },
      { title: "Rozloženie", url: "/allocation", icon: PieChart },
      { title: "Grafy", url: "/grafy", icon: LineChart },
      { title: "Môj cieľ", url: "/goal", icon: Target },
    ],
  },
  {
    title: "Aktivita",
    items: [
      { title: "História", url: "/history", icon: Clock },
      { title: "Zisk", url: "/profit", icon: TrendingUp },
      { title: "Dividendy", url: "/dividends", icon: CircleDollarSign },
      { title: "Kalendár udalostí", url: "/events", icon: Calendar },
      { title: "Watchlist", url: "/watchlist", icon: Star },
      { title: "Opcie", url: "/options", icon: ChartSpline },
    ],
  },
  {
    title: "AI",
    items: [
      { title: "AI Agent", url: "/ai-agent/bot", icon: Bot },
      { title: "AI Chat", url: "/ai-chat", icon: MessageSquare },
      { title: "AI Macro Audit", url: "/ai-macro-audit", icon: Sparkles },
    ],
  },
  {
    title: "Nástroje",
    items: [
      { title: "Daňový asistent", url: "/tax", icon: FileText },
      { title: "Import brokera", url: "/import", icon: Upload },
      { title: "Nastavenia", url: "/settings", icon: Settings },
      { title: "FAQ", url: "/faq", icon: CircleHelp },
    ],
  },
];

const ADMIN_ITEM: NavItem = { title: "Registrácie", url: "/admin/registrations", icon: UserCheck };

function navTestId(url: string) {
  if (url === "/settings") return "nav-settings";
  if (url === "/admin/registrations") return "nav-admin-registrations";
  return `nav-${url.replace("/", "") || "dashboard"}`;
}

function isNavActive(location: string, url: string) {
  if (url.startsWith("/ai-agent")) {
    return location.startsWith("/ai-agent") || location.startsWith("/ai-skener");
  }
  return location === url;
}

function GroupLabel({ children, first }: { children: string; first?: boolean }) {
  return (
    <p
      className={cn(
        "px-2.5 pb-1 text-[10px] font-semibold uppercase leading-3 tracking-[0.8px] text-[hsl(var(--sidebar-text-tertiary))]",
        first ? "pt-1.5" : "pt-3",
      )}
    >
      {children}
    </p>
  );
}

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };
  const { user } = useAuth();
  const {
    portfolios,
    categories,
    selectedPortfolioId,
    selectedPortfolio,
    selectedCategory,
    setSelectedPortfolioId,
    isAllPortfolios,
    isCategoryScope,
    scopeLabel,
    encodeCategoryScope,
  } = usePortfolio();
  const { theme, toggleTheme } = useTheme();

  const getInitials = (user: UserType | undefined) => {
    if (!user) return "U";
    if (user.firstName && user.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user.email) {
      return user.email[0].toUpperCase();
    }
    return "U";
  };

  const getDisplayName = (user: UserType | undefined) => {
    if (!user) return "Používateľ";
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    if (user.firstName) return user.firstName;
    if (user.email) return user.email;
    return "Používateľ";
  };

  const getSelectedPortfolioName = () => scopeLabel || "Vybrať portfólio";

  const handleLogout = async () => {
    closeMobileSidebar();
    await apiRequest("POST", "/api/logout");
    queryClient.clear();
    try {
      localStorage.removeItem(PORTFOLIO_QUERY_CACHE_KEY);
    } catch {
      // ignore
    }
    window.location.href = "/";
  };

  const groups = user?.isRegistrationAdmin
    ? [...NAV_GROUPS, { title: "Admin", items: [ADMIN_ITEM] }]
    : NAV_GROUPS;

  const renderNavItem = (item: NavItem) => {
    const active = isNavActive(location, item.url);
    const Icon = item.icon;
    return (
      <a
        key={item.url}
        href={item.url}
        onClick={(e) => {
          e.preventDefault();
          setLocation(item.url);
          closeMobileSidebar();
        }}
        data-testid={navTestId(item.url)}
        data-active={active}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 w-full items-center gap-2.5 rounded-lg border px-2.5 text-[13px] leading-[18px] transition-colors",
          active
            ? "border-sidebar-border bg-sidebar-accent font-semibold text-sidebar-foreground"
            : "border-transparent text-[hsl(var(--sidebar-text-secondary))] hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
        )}
      >
        <Icon
          className={cn(
            "size-4 shrink-0",
            active
              ? "text-sidebar-primary"
              : "text-[hsl(var(--sidebar-text-secondary))]",
          )}
          strokeWidth={1.75}
        />
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
      </a>
    );
  };

  return (
    <Sidebar className="absolute h-full">
      <SidebarHeader className="gap-0 p-0">
        <div className="flex items-center gap-2.5 px-4 pb-3 pt-[18px]">
          <p className="min-w-0 flex-1 text-lg font-bold leading-[22px] tracking-[-0.18px] text-sidebar-foreground">
            Mone<span className="text-sidebar-primary">IQ</span>Wise
          </p>
          <SidebarTrigger
            className="h-7 w-7 rounded-lg text-[hsl(var(--sidebar-text-tertiary))] hover:text-sidebar-foreground [&_svg]:size-4"
            data-testid="button-sidebar-toggle"
          />
        </div>
        <div className="px-3 pb-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent px-2.5 py-2 text-left hover:bg-sidebar-accent/80"
                data-testid="button-portfolio-selector"
              >
                {selectedPortfolio?.brokerCode ? (
                  <BrokerLogo brokerCode={selectedPortfolio.brokerCode} size="xs" />
                ) : selectedCategory ? (
                  <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-sidebar">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: selectedCategory.color }}
                    />
                  </span>
                ) : (
                  <span className="flex size-[22px] shrink-0 items-center justify-center rounded-md bg-[var(--rd-profit-dim,hsl(var(--sidebar-primary)/0.15))] text-sidebar-primary">
                    <Layers className="size-[13px]" strokeWidth={2} />
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-[18px] text-sidebar-foreground">
                  {getSelectedPortfolioName()}
                </span>
                <ChevronDown className="size-3 shrink-0 text-[hsl(var(--sidebar-text-tertiary))]" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[216px] max-h-[70vh] overflow-y-auto">
              <DropdownMenuItem
                onClick={() => {
                  setSelectedPortfolioId("all");
                  closeMobileSidebar();
                }}
                data-testid="select-portfolio-all"
              >
                <div className="flex items-center gap-2 w-full">
                  <Briefcase className="h-4 w-4" />
                  <span className="flex-1">Všetky portfóliá</span>
                  {isAllPortfolios && <Check className="h-4 w-4 text-primary" />}
                </div>
              </DropdownMenuItem>
              {categories.map((category) => {
                const scope = encodeCategoryScope(category.id);
                const inCat = portfolios.filter((p) => p.categoryId === category.id);
                return (
                  <div key={category.id}>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        setSelectedPortfolioId(scope);
                        closeMobileSidebar();
                      }}
                      data-testid={`select-category-${category.id}`}
                    >
                      <div className="flex items-center gap-2 w-full">
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: category.color }}
                        />
                        <span className="flex-1 truncate font-medium">{category.name}</span>
                        {(isCategoryScope && selectedPortfolioId === scope) && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                    </DropdownMenuItem>
                    {inCat.map((portfolio) => (
                      <DropdownMenuItem
                        key={portfolio.id}
                        onClick={() => {
                          setSelectedPortfolioId(portfolio.id);
                          closeMobileSidebar();
                        }}
                        data-testid={`select-portfolio-${portfolio.id}`}
                        className="pl-6"
                      >
                        <div className="flex items-center gap-2 w-full">
                          {portfolio.brokerCode ? (
                            <BrokerLogo brokerCode={portfolio.brokerCode} size="xs" />
                          ) : (
                            <Briefcase className="h-4 w-4" />
                          )}
                          <span className="flex-1 truncate">{portfolio.name}</span>
                          {selectedPortfolioId === portfolio.id && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </div>
                );
              })}
              {portfolios.filter((p) => !p.categoryId).length > 0 && (
                <>
                  {categories.length > 0 && <DropdownMenuSeparator />}
                  {portfolios
                    .filter((p) => !p.categoryId)
                    .map((portfolio) => (
                      <DropdownMenuItem
                        key={portfolio.id}
                        onClick={() => {
                          setSelectedPortfolioId(portfolio.id);
                          closeMobileSidebar();
                        }}
                        data-testid={`select-portfolio-${portfolio.id}`}
                      >
                        <div className="flex items-center gap-2 w-full">
                          {portfolio.brokerCode ? (
                            <BrokerLogo brokerCode={portfolio.brokerCode} size="xs" />
                          ) : (
                            <Briefcase className="h-4 w-4" />
                          )}
                          <span className="flex-1 truncate">{portfolio.name}</span>
                          {selectedPortfolioId === portfolio.id && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                        </div>
                      </DropdownMenuItem>
                    ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 [scrollbar-color:hsl(var(--sidebar-border))_transparent] [scrollbar-width:thin]">
        <nav className="flex flex-col gap-0.5 px-4 pb-3 pt-1" aria-label="Hlavná navigácia">
          {groups.map((group, index) => (
            <div key={group.title} className="contents">
              <GroupLabel first={index === 0}>{group.title}</GroupLabel>
              {group.items.map(renderNavItem)}
            </div>
          ))}
        </nav>
      </SidebarContent>

      <SidebarFooter className="gap-0.5 border-t border-sidebar-border px-4 pb-3.5 pt-2.5">
        <div
          className="flex items-center gap-2.5 px-2.5 py-[7px]"
          data-testid="button-theme-toggle"
        >
          <Sun className="size-4 shrink-0 text-[hsl(var(--sidebar-text-secondary))]" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 text-[13px] leading-[18px] text-[hsl(var(--sidebar-text-secondary))]">
            Svetlý režim
          </span>
          <Switch
            checked={theme === "light"}
            onCheckedChange={toggleTheme}
            aria-label={theme === "dark" ? "Prepnúť na svetlý režim" : "Prepnúť na tmavý režim"}
          />
        </div>
        <button
          type="button"
          data-testid="button-logout"
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] leading-[18px] text-[hsl(var(--sidebar-text-secondary))] hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          onClick={handleLogout}
        >
          <LogOut className="size-4 shrink-0 text-[hsl(var(--sidebar-text-secondary))]" strokeWidth={1.75} />
          <span>Odhlásiť sa</span>
        </button>

        <div className="flex items-center gap-2.5 px-2.5 pb-1 pt-2.5">
          <Avatar className="size-[30px]">
            <AvatarImage
              src={user?.profileImageUrl || undefined}
              alt={getDisplayName(user)}
              className="object-cover"
            />
            <AvatarFallback className="bg-[#14263a] text-[11px] font-medium leading-[14px] text-[#6bb0f5]">
              {getInitials(user)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-[13px] font-semibold leading-[18px] text-sidebar-foreground"
              data-testid="text-user-name"
            >
              {getDisplayName(user)}
            </p>
            {user?.email && (
              <p className="truncate text-[11px] leading-[14px] text-[hsl(var(--sidebar-text-tertiary))]">
                {user.email}
              </p>
            )}
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
