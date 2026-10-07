import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
import Grafy from "@/pages/Grafy";
import GoalTracker from "@/pages/GoalTracker";
import EventsCalendar from "@/pages/EventsCalendar";
import Watchlist from "@/pages/Watchlist";
import AiAgent from "@/pages/AiAgent";
import AiMacroAudit from "@/pages/AiMacroAudit";
import AssetDetail from "@/pages/AssetDetail";
import TaxSummaryPage from "@/pages/TaxSummaryPage";
import FaqPage from "@/pages/FaqPage";
import AdminRegistrations from "@/pages/AdminRegistrations";
import { MarketQuoteTicker } from "@/components/MarketQuoteTicker";
import { QuickNavFab, QUICK_NAV_CONTENT_PAD } from "@/components/QuickNavFab";
import { DashboardEditHeaderButton } from "@/components/DashboardEditHeaderButton";
import { useQuickNavFab } from "@/hooks/useQuickNavFab";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { startAuthentication } from "@simplewebauthn/browser";
import { KeyRound } from "lucide-react";

type PasskeysPayload = {
  passkeys: Array<{ id: string }>;
};

function QuickNavFabGate() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading || !isAuthenticated) return null;
  return <QuickNavFab />;
}

function RedirectToHistory() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/history");
  }, [setLocation]);
  return null;
}

function RedirectToAiAgentSkener() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/ai-agent/skener");
  }, [setLocation]);
  return null;
}

function RedirectToAiAgentBot() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/ai-agent/bot");
  }, [setLocation]);
  return null;
}

function AppUnlockGate({ children }: { children: ReactNode }) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { toast } = useToast();
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const hadUnauthenticatedState = useRef(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      hadUnauthenticatedState.current = true;
      setIsUnlocked(false);
    }
  }, [isLoading, isAuthenticated]);

  const startupWithActiveSession =
    isAuthenticated && !hadUnauthenticatedState.current;

  const passkeysQuery = useQuery<PasskeysPayload>({
    queryKey: ["/api/auth/passkeys"],
    enabled: startupWithActiveSession,
  });

  const hasPasskeys = (passkeysQuery.data?.passkeys?.length || 0) > 0;
  const shouldRequireUnlock =
    startupWithActiveSession && hasPasskeys && !isUnlocked;

  const handleUnlock = async () => {
    if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
      toast({
        title: "Passkey nie je podporovaný",
        description: "Tento prehliadač alebo zariadenie nepodporuje WebAuthn.",
        variant: "destructive",
      });
      return;
    }

    setIsUnlocking(true);
    try {
      const optionsResponse = await apiRequest(
        "POST",
        "/api/auth/passkeys/options/login",
        { email: user?.email || undefined },
      );
      const optionsPayload = (await optionsResponse.json()) as {
        options?: Parameters<typeof startAuthentication>[0]["optionsJSON"];
      };
      if (!optionsPayload.options) {
        throw new Error("Server nevrátil unlock challenge.");
      }

      const passkeyResponse = await startAuthentication({
        optionsJSON: optionsPayload.options,
      });
      await apiRequest("POST", "/api/auth/passkeys/verify/login", {
        response: passkeyResponse,
        rememberMe: true,
      });

      setIsUnlocked(true);
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      toast({
        title: "Aplikácia odomknutá",
        description: "Overenie passkey prebehlo úspešne.",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Odomknutie passkey zlyhalo.";
      toast({
        title: "Aplikáciu sa nepodarilo odomknúť",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsUnlocking(false);
    }
  };

  if (startupWithActiveSession && passkeysQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Overujem zabezpečenie...</p>
        </div>
      </div>
    );
  }

  if (startupWithActiveSession && passkeysQuery.isError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border bg-card p-5 text-center space-y-3">
          <h2 className="text-base font-semibold">Nepodarilo sa overiť passkeys</h2>
          <p className="text-sm text-muted-foreground">
            Skús obnoviť stránku alebo odhlásiť/prihlásiť sa znova.
          </p>
          <Button
            onClick={() => passkeysQuery.refetch()}
            disabled={passkeysQuery.isFetching}
            data-testid="button-passkey-unlock-retry"
          >
            {passkeysQuery.isFetching ? "Skúšam znova..." : "Skúsiť znova"}
          </Button>
        </div>
      </div>
    );
  }

  if (shouldRequireUnlock) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border bg-card p-5 text-center space-y-3">
          <div className="mx-auto w-fit rounded-full border p-3">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-base font-semibold">Odomkni aplikáciu</h2>
          <p className="text-sm text-muted-foreground">
            Pred pokračovaním over svoju identitu cez passkey (odtlačok, Face ID alebo PIN zariadenia).
          </p>
          <Button
            onClick={handleUnlock}
            disabled={isUnlocking}
            className="w-full"
            data-testid="button-passkey-unlock"
          >
            {isUnlocking ? "Overujem..." : "Odomknúť cez passkey"}
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
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
      <Route path="/grafy" component={Grafy} />
      <Route path="/goal" component={GoalTracker} />
      <Route path="/events" component={EventsCalendar} />
      <Route path="/watchlist" component={Watchlist} />
      <Route path="/ai-agent" component={RedirectToAiAgentBot} />
      <Route path="/ai-agent/bot" component={AiAgent} />
      <Route path="/ai-agent/paper" component={AiAgent} />
      <Route path="/ai-agent/alerty" component={AiAgent} />
      <Route path="/ai-agent/skener" component={AiAgent} />
      <Route path="/ai-skener" component={RedirectToAiAgentSkener} />
      <Route path="/ai-macro-audit" component={AiMacroAudit} />
      <Route path="/settings" component={Settings} />
      <Route path="/admin/registrations" component={AdminRegistrations} />
      <Route path="/faq" component={FaqPage} />
      <Route path="/asset/:ticker" component={AssetDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout() {
  const { isAuthenticated, isLoading } = useAuth();
  const { enabled: quickNavEnabled } = useQuickNavFab();

  if (isLoading || !isAuthenticated) {
    return <Router />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <PortfolioProvider>
      <AppUnlockGate>
        <SidebarProvider style={style as CSSProperties}>
          <div className="flex h-screen w-full flex-col">
            <MarketQuoteTicker />
            <div className="flex min-h-0 flex-1 w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1 overflow-hidden">
                <header className="flex items-center gap-1.5 px-3 py-2 md:gap-2 md:p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <div className="flex-1" />
                  <DashboardEditHeaderButton />
                </header>
                <main
                  className={cn(
                    "flex-1 overflow-auto p-2 md:p-6",
                    quickNavEnabled && QUICK_NAV_CONTENT_PAD,
                  )}
                >
                  <Router />
                </main>
              </div>
            </div>
          </div>
        </SidebarProvider>
      </AppUnlockGate>
    </PortfolioProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthenticatedLayout />
          <QuickNavFabGate />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
