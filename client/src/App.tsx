import { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import { PortfolioProvider } from "@/hooks/usePortfolio";
import { ThemeProvider } from "@/hooks/useTheme";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import Overview from "@/pages/Overview";
import History from "@/pages/History";
import Profit from "@/pages/Profit";
import Dividends from "@/pages/Dividends";
import Options from "@/pages/Options";
import Settings from "@/pages/Settings";
import Import from "@/pages/Import";
import Allocation from "@/pages/Allocation";
import AssetDetail from "@/pages/AssetDetail";
import TaxSummaryPage from "@/pages/TaxSummaryPage";

function RedirectToHistory() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/history");
  }, [setLocation]);
  return null;
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Načítavam...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Landing />;
  }

  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/overview" component={Overview} />
      <Route path="/transactions" component={RedirectToHistory} />
      <Route path="/history" component={History} />
      <Route path="/profit" component={Profit} />
      <Route path="/dividends" component={Dividends} />
      <Route path="/tax" component={TaxSummaryPage} />
      <Route path="/options" component={Options} />
      <Route path="/import" component={Import} />
      <Route path="/allocation" component={Allocation} />
      <Route path="/settings" component={Settings} />
      <Route path="/asset/:ticker" component={AssetDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading || !isAuthenticated) {
    return <Router />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <PortfolioProvider>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full">
          <AppSidebar />
          <div className="flex flex-col flex-1 overflow-hidden">
            <header className="flex items-center gap-2 p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <div className="flex-1" />
            </header>
            <main className="flex-1 overflow-auto p-6">
              <Router />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </PortfolioProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthenticatedLayout />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
