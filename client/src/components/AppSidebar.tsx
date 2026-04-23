import { BarChart3, History, LogOut, User, TrendingUp, Settings, Briefcase, ChevronDown, Check, Target, Banknote, Upload, Sun, Moon, Layers, PieChart, Scale, LineChart, CircleHelp } from "lucide-react";
import { useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
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
import { useAuth } from "@/hooks/useAuth";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useTheme } from "@/hooks/useTheme";
import { BrokerLogo } from "@/components/BrokerLogo";
import { apiRequest, PORTFOLIO_QUERY_CACHE_KEY, queryClient } from "@/lib/queryClient";
import type { User as UserType } from "@shared/schema";

const menuItems = [
  {
    title: "Prehľad",
    url: "/",
    icon: BarChart3,
  },
  {
    title: "Všetky portfóliá",
    url: "/overview",
    icon: Layers,
  },
  {
    title: "Rozloženie",
    url: "/allocation",
    icon: PieChart,
  },
  {
    title: "Grafy",
    url: "/grafy",
    icon: LineChart,
  },
  {
    title: "História",
    url: "/history",
    icon: History,
  },
  {
    title: "Zisk",
    url: "/profit",
    icon: TrendingUp,
  },
  {
    title: "Dividendy",
    url: "/dividends",
    icon: Banknote,
  },
  {
    title: "Daňový asistent",
    url: "/tax",
    icon: Scale,
  },
  {
    title: "Opcie",
    url: "/options",
    icon: Target,
  },
  {
    title: "Import XTB",
    url: "/import",
    icon: Upload,
  },
  {
    title: "FAQ",
    url: "/faq",
    icon: CircleHelp,
  },
];

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobileSidebar = () => {
    if (isMobile) setOpenMobile(false);
  };
  const { user } = useAuth();
  const { portfolios, selectedPortfolioId, selectedPortfolio, setSelectedPortfolioId, isAllPortfolios } = usePortfolio();
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

  const getSelectedPortfolioName = () => {
    if (isAllPortfolios) return "Všetky portfóliá";
    return selectedPortfolio?.name || "Vybrať portfólio";
  };

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

  return (
    <Sidebar>
      <SidebarHeader className="p-3 md:p-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 md:h-6 md:w-6 text-primary" />
          <span className="font-bold text-sm md:text-lg">Moneiqwise</span>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] md:text-xs">Portfólio</SidebarGroupLabel>
          <SidebarGroupContent>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button 
                  className="w-full flex items-center gap-2 px-2 md:px-3 py-1.5 md:py-2 rounded-md hover-elevate text-left text-xs md:text-sm"
                  data-testid="button-portfolio-selector"
                >
                  {selectedPortfolio?.brokerCode ? (
                    <BrokerLogo brokerCode={selectedPortfolio.brokerCode} size="xs" />
                  ) : (
                    <Briefcase className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="flex-1 truncate">{getSelectedPortfolioName()}</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
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
                {portfolios.length > 0 && <DropdownMenuSeparator />}
                {portfolios.map((portfolio) => (
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
                      {selectedPortfolioId === portfolio.id && <Check className="h-4 w-4 text-primary" />}
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] md:text-xs">Navigácia</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild
                    isActive={location === item.url}
                    data-testid={`nav-${item.url.replace("/", "") || "dashboard"}`}
                    className="text-xs md:text-sm py-1.5 md:py-2"
                  >
                    <a 
                      href={item.url}
                      onClick={(e) => {
                        e.preventDefault();
                        setLocation(item.url);
                        closeMobileSidebar();
                      }}
                    >
                      <item.icon className="h-4 w-4 md:h-5 md:w-5" />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 md:p-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton 
              asChild
              isActive={location === "/settings"}
              data-testid="nav-settings"
              className="text-xs md:text-sm py-1.5 md:py-2"
            >
              <a 
                href="/settings"
                onClick={(e) => {
                  e.preventDefault();
                  setLocation("/settings");
                  closeMobileSidebar();
                }}
              >
                <Settings className="h-4 w-4 md:h-5 md:w-5" />
                <span>Nastavenia</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={toggleTheme}
              data-testid="button-theme-toggle"
              aria-label={theme === "dark" ? "Prepnúť na svetlý režim" : "Prepnúť na tmavý režim"}
              className="text-xs md:text-sm py-1.5 md:py-2"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 md:h-5 md:w-5" />
              ) : (
                <Moon className="h-4 w-4 md:h-5 md:w-5" />
              )}
              <span>{theme === "dark" ? "Svetlý režim" : "Tmavý režim"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              data-testid="button-logout"
              className="text-xs md:text-sm py-1.5 md:py-2"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4 md:h-5 md:w-5" />
              <span>Odhlásiť sa</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        
        <div className="flex items-center gap-2 md:gap-3 mt-3 md:mt-4 pt-3 md:pt-4 border-t border-sidebar-border">
          <Avatar className="h-7 w-7 md:h-9 md:w-9">
            <AvatarImage 
              src={user?.profileImageUrl || undefined} 
              alt={getDisplayName(user)}
              className="object-cover"
            />
            <AvatarFallback>
              <User className="h-3 w-3 md:h-4 md:w-4" />
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-xs md:text-sm font-medium truncate" data-testid="text-user-name">
              {getDisplayName(user)}
            </p>
            {user?.email && (
              <p className="text-[10px] md:text-xs text-muted-foreground truncate">
                {user.email}
              </p>
            )}
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
