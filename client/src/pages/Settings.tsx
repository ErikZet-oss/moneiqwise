import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { Loader2, Eye, EyeOff, CheckCircle2, XCircle, Key, ExternalLink, Coins, Calculator, RefreshCw, Briefcase, Plus, Pencil, Trash2, LineChart, Newspaper, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BrokerLogo, BrokerSelectItem, BROKER_CATALOG } from "@/components/BrokerLogo";
import { BROKER_CODES, type Currency, type BrokerCode } from "@shared/schema";

interface ApiSettings {
  alphaVantageKey: string | null;
  finnhubKey: string | null;
  preferredCurrency: Currency;
}

interface ExchangeRate {
  eurToUsd: number;
  usdToEur: number;
}

export default function Settings() {
  const { toast } = useToast();
  const { allPortfolios, createPortfolio, updatePortfolio, deletePortfolio, setPortfolioHidden } = usePortfolio();
  const { showChart, showTooltip, hideAmounts, showNews, setShowChart, setShowTooltip, setHideAmounts, setShowNews } = useChartSettings();
  const [showAlphaVantage, setShowAlphaVantage] = useState(false);
  const [showFinnhub, setShowFinnhub] = useState(false);
  const [alphaVantageKey, setAlphaVantageKey] = useState("");
  const [finnhubKey, setFinnhubKey] = useState("");
  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [newPortfolioBroker, setNewPortfolioBroker] = useState<BrokerCode | undefined>(undefined);
  const [editingPortfolio, setEditingPortfolio] = useState<{ id: string; name: string; brokerCode: BrokerCode | null } | null>(null);
  const [deletePortfolioId, setDeletePortfolioId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingHiddenId, setTogglingHiddenId] = useState<string | null>(null);
  const [wipeDialogOpen, setWipeDialogOpen] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState("");

  const { data: settings, isLoading } = useQuery<ApiSettings>({
    queryKey: ["/api/settings"],
  });

  const { data: exchangeRate } = useQuery<ExchangeRate>({
    queryKey: ["/api/exchange-rate"],
    staleTime: 60 * 60 * 1000,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: { alphaVantageKey?: string; finnhubKey?: string; preferredCurrency?: Currency }) => {
      return apiRequest("POST", "/api/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      toast({
        title: "Uložené",
        description: "Nastavenia boli úspešne uložené.",
      });
      setAlphaVantageKey("");
      setFinnhubKey("");
    },
    onError: () => {
      toast({
        title: "Chyba",
        description: "Nepodarilo sa uložiť nastavenia.",
        variant: "destructive",
      });
    },
  });

  const handleSaveAlphaVantage = () => {
    if (!alphaVantageKey.trim()) return;
    updateSettingsMutation.mutate({ alphaVantageKey: alphaVantageKey.trim() });
  };

  const handleSaveFinnhub = () => {
    if (!finnhubKey.trim()) return;
    updateSettingsMutation.mutate({ finnhubKey: finnhubKey.trim() });
  };

  const handleRemoveAlphaVantage = () => {
    updateSettingsMutation.mutate({ alphaVantageKey: "" });
  };

  const handleRemoveFinnhub = () => {
    updateSettingsMutation.mutate({ finnhubKey: "" });
  };

  const handleCurrencyChange = (currency: Currency) => {
    updateSettingsMutation.mutate({ preferredCurrency: currency });
  };

  const wipeAllDataMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/user/transactions/all", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirm: "VYMAZAT VSETKO" }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Nepodarilo sa vymazať dáta");
      }
      return response.json() as Promise<{
        transactionsDeleted: number;
        holdingsDeleted: number;
        optionTradesDeleted: number;
      }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Všetko vymazané",
        description: `Vymazaných ${data.transactionsDeleted} transakcií, ${data.holdingsDeleted} holdingov, ${data.optionTradesDeleted} opčných obchodov.`,
      });
      // After a nuclear wipe we can't just invalidate specific keys — too many
      // pages subscribe to derived data (aggregates, quotes, realized gains,
      // per-portfolio holdings …) and refetchOnMount is disabled by default in
      // queryClient, so stale cached data would still flash when navigating.
      // Clearing the whole cache guarantees every page re-fetches fresh state.
      queryClient.clear();
      setWipeDialogOpen(false);
      setWipeConfirmText("");
    },
    onError: (error: Error) => {
      toast({
        title: "Chyba",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const recalculateMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/realized-gains/recalculate");
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/realized-gains"] });
      toast({
        title: "Hotovo",
        description: data.message || "Realizované zisky boli prepočítané.",
      });
    },
    onError: () => {
      toast({
        title: "Chyba",
        description: "Nepodarilo sa prepočítať realizované zisky.",
        variant: "destructive",
      });
    },
  });

  const maskKey = (key: string | null) => {
    if (!key) return "";
    if (key.length <= 8) return "••••••••";
    return key.substring(0, 4) + "••••••••" + key.substring(key.length - 4);
  };

  const handleCreatePortfolio = async () => {
    if (!newPortfolioName.trim()) return;
    setIsCreating(true);
    try {
      await createPortfolio(newPortfolioName.trim(), newPortfolioBroker);
      toast({
        title: "Vytvorené",
        description: "Nové portfólio bolo úspešne vytvorené.",
      });
      setNewPortfolioName("");
      setNewPortfolioBroker(undefined);
    } catch (error) {
      toast({
        title: "Chyba",
        description: "Nepodarilo sa vytvoriť portfólio.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdatePortfolio = async () => {
    if (!editingPortfolio || !editingPortfolio.name.trim()) return;
    setIsUpdating(true);
    try {
      await updatePortfolio(editingPortfolio.id, editingPortfolio.name.trim(), editingPortfolio.brokerCode);
      toast({
        title: "Uložené",
        description: "Portfólio bolo úspešne aktualizované.",
      });
      setEditingPortfolio(null);
    } catch (error) {
      toast({
        title: "Chyba",
        description: "Nepodarilo sa aktualizovať portfólio.",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleHidden = async (id: string, currentlyHidden: boolean) => {
    setTogglingHiddenId(id);
    try {
      await setPortfolioHidden(id, !currentlyHidden);
      toast({
        title: currentlyHidden ? "Odkryté" : "Skryté",
        description: currentlyHidden
          ? "Portfólio je opäť viditeľné v celej aplikácii."
          : "Portfólio je skryté. Transakcie ostávajú uložené a môžete ho kedykoľvek odkryť.",
      });
    } catch (error) {
      toast({
        title: "Chyba",
        description: "Nepodarilo sa zmeniť viditeľnosť portfólia.",
        variant: "destructive",
      });
    } finally {
      setTogglingHiddenId(null);
    }
  };

  const handleDeletePortfolio = async () => {
    if (!deletePortfolioId) return;
    setIsDeleting(true);
    try {
      await deletePortfolio(deletePortfolioId);
      toast({
        title: "Vymazané",
        description: "Portfólio a všetky jeho transakcie boli vymazané.",
      });
      setDeletePortfolioId(null);
    } catch (error) {
      toast({
        title: "Chyba",
        description: "Nepodarilo sa vymazať portfólio.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-settings-title">Údaje</h1>
        <p className="text-muted-foreground">
          Spravujte svoje nastavenia aplikácie a API kľúče.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary" />
            <CardTitle>Správa portfólií</CardTitle>
          </div>
          <CardDescription>
            Vytvárajte a spravujte svoje investičné portfóliá. Každé portfólio môže obsahovať vlastné transakcie a holdings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Názov nového portfólia..."
              value={newPortfolioName}
              onChange={(e) => setNewPortfolioName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreatePortfolio()}
              className="flex-1"
              data-testid="input-new-portfolio-name"
            />
            <Select
              value={newPortfolioBroker || "none"}
              onValueChange={(value) => setNewPortfolioBroker(value === "none" ? undefined : value as BrokerCode)}
            >
              <SelectTrigger className="w-[180px]" data-testid="select-new-portfolio-broker">
                <SelectValue placeholder="Broker (voliteľné)">
                  {newPortfolioBroker ? <BrokerSelectItem brokerCode={newPortfolioBroker} /> : "Žiadny broker"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-6 w-6 text-muted-foreground" />
                    <span>Žiadny broker</span>
                  </div>
                </SelectItem>
                {BROKER_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    <BrokerSelectItem brokerCode={code} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button 
              onClick={handleCreatePortfolio}
              disabled={!newPortfolioName.trim() || isCreating}
              data-testid="button-create-portfolio"
            >
              {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>
          
          <div className="space-y-2">
            {allPortfolios.map((portfolio) => (
              <div
                key={portfolio.id}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  portfolio.isHidden ? "bg-muted/50 opacity-70" : "bg-muted"
                }`}
                data-testid={`portfolio-item-${portfolio.id}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {portfolio.brokerCode ? (
                    <BrokerLogo brokerCode={portfolio.brokerCode} size="sm" />
                  ) : (
                    <Briefcase className="h-6 w-6 text-muted-foreground shrink-0" />
                  )}
                  <span className={`font-medium truncate ${portfolio.isHidden ? "line-through" : ""}`}>
                    {portfolio.name}
                  </span>
                  {portfolio.isDefault && (
                    <Badge variant="outline" className="text-xs">Predvolené</Badge>
                  )}
                  {portfolio.isHidden && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      Skryté
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleToggleHidden(portfolio.id, !!portfolio.isHidden)}
                    disabled={togglingHiddenId === portfolio.id}
                    title={portfolio.isHidden ? "Odkryť portfólio" : "Skryť portfólio"}
                    aria-label={portfolio.isHidden ? "Odkryť portfólio" : "Skryť portfólio"}
                    data-testid={`button-toggle-hidden-portfolio-${portfolio.id}`}
                  >
                    {togglingHiddenId === portfolio.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : portfolio.isHidden ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditingPortfolio({ id: portfolio.id, name: portfolio.name, brokerCode: portfolio.brokerCode })}
                    data-testid={`button-edit-portfolio-${portfolio.id}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {allPortfolios.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeletePortfolioId(portfolio.id)}
                      title="Vymazať portfólio"
                      aria-label="Vymazať portfólio"
                      data-testid={`button-delete-portfolio-${portfolio.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {allPortfolios.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Zatiaľ nemáte žiadne portfóliá.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editingPortfolio} onOpenChange={(open) => !open && setEditingPortfolio(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upraviť portfólio</DialogTitle>
            <DialogDescription>
              Upravte názov a brokera pre toto portfólio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Názov portfólia</label>
              <Input
                value={editingPortfolio?.name || ""}
                onChange={(e) => setEditingPortfolio(prev => prev ? { ...prev, name: e.target.value } : null)}
                placeholder="Názov portfólia"
                data-testid="input-edit-portfolio-name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Broker</label>
              <Select
                value={editingPortfolio?.brokerCode || "none"}
                onValueChange={(value) => setEditingPortfolio(prev => prev ? { ...prev, brokerCode: value === "none" ? null : value as BrokerCode } : null)}
              >
                <SelectTrigger data-testid="select-edit-portfolio-broker">
                  <SelectValue placeholder="Vyberte brokera">
                    {editingPortfolio?.brokerCode ? <BrokerSelectItem brokerCode={editingPortfolio.brokerCode} /> : "Žiadny broker"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <div className="flex items-center gap-2">
                      <Briefcase className="h-6 w-6 text-muted-foreground" />
                      <span>Žiadny broker</span>
                    </div>
                  </SelectItem>
                  {BROKER_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      <BrokerSelectItem brokerCode={code} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingPortfolio(null)}>
              Zrušiť
            </Button>
            <Button 
              onClick={handleUpdatePortfolio}
              disabled={!editingPortfolio?.name.trim() || isUpdating}
              data-testid="button-save-portfolio-name"
            >
              {isUpdating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Uložiť
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletePortfolioId} onOpenChange={(open) => !open && setDeletePortfolioId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vymazať portfólio</DialogTitle>
            <DialogDescription>
              {(() => {
                const target = allPortfolios.find((p) => p.id === deletePortfolioId);
                const isDefault = !!target?.isDefault;
                return (
                  <>
                    Naozaj chcete vymazať {target ? <strong>„{target.name}"</strong> : "toto portfólio"}?
                    Všetky transakcie, holdings a opcie v tomto portfóliu budú natrvalo vymazané. Táto akcia je nevratná.
                    {isDefault && (
                      <> Keďže ide o hlavné portfólio, automaticky sa ním stane iné z vašich portfólií.</>
                    )}
                    {" "}Ak chcete dáta len skryť z prehľadu a zachovať ich, použite tlačidlo oka (skryť portfólio).
                  </>
                );
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePortfolioId(null)}>
              Zrušiť
            </Button>
            <Button 
              variant="destructive"
              onClick={handleDeletePortfolio}
              disabled={isDeleting}
              data-testid="button-confirm-delete-portfolio"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Vymazať
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            <CardTitle>Mena zobrazenia</CardTitle>
          </div>
          <CardDescription>
            Vyberte menu, v ktorej sa budú zobrazovať všetky hodnoty. Ceny amerických akcií sa automaticky prepočítajú aktuálnym kurzom.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Select 
              value={settings?.preferredCurrency || "EUR"} 
              onValueChange={(value) => handleCurrencyChange(value as Currency)}
              disabled={updateSettingsMutation.isPending}
            >
              <SelectTrigger className="w-[200px]" data-testid="select-currency">
                <SelectValue placeholder="Vyberte menu" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EUR">EUR - Euro</SelectItem>
                <SelectItem value="USD">USD - Americký dolár</SelectItem>
              </SelectContent>
            </Select>
            {updateSettingsMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
          </div>
          
          {exchangeRate && (
            <div className="p-3 bg-muted rounded-lg text-sm">
              <p className="text-muted-foreground">
                Aktuálny kurz: <span className="font-medium text-foreground">1 EUR = {exchangeRate.eurToUsd.toFixed(4)} USD</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Kurz sa aktualizuje každú hodinu z Európskej centrálnej banky.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <LineChart className="h-5 w-5 text-primary" />
            <CardTitle>Zobrazenie na prehľade</CardTitle>
          </div>
          <CardDescription>
            Nastavte, čo sa zobrazí na hlavnej stránke. Vypnutie sekcií môže urýchliť načítanie.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Zobraziť graf</div>
              <div className="text-xs text-muted-foreground">
                Graf zobrazuje vývoj hodnoty portfólia v čase
              </div>
            </div>
            <Switch
              checked={showChart}
              onCheckedChange={setShowChart}
              data-testid="switch-show-chart"
            />
          </div>
          
          {showChart && (
            <div className="flex items-center justify-between pt-2 border-t">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Interakcia s grafom</div>
                <div className="text-xs text-muted-foreground">
                  Zobraziť hodnotu pri dotyku/kliknutí na graf
                </div>
              </div>
              <Switch
                checked={showTooltip}
                onCheckedChange={setShowTooltip}
                data-testid="switch-show-tooltip"
              />
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t">
            <div className="space-y-0.5">
              <div className="text-sm font-medium flex items-center gap-2">
                <Newspaper className="h-4 w-4 text-muted-foreground" />
                Novinky k vašim aktívam
              </div>
              <div className="text-xs text-muted-foreground">
                Zobraziť sekciu s aktuálnymi správami pre tickery vo vašom portfóliu
              </div>
            </div>
            <Switch
              checked={showNews}
              onCheckedChange={setShowNews}
              data-testid="switch-show-news"
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Skryť sumy</div>
              <div className="text-xs text-muted-foreground">
                Nahradiť peňažné hodnoty hviezdičkami (••••••)
              </div>
            </div>
            <Switch
              checked={hideAmounts}
              onCheckedChange={setHideAmounts}
              data-testid="switch-hide-amounts"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            <CardTitle>API kľúče</CardTitle>
          </div>
          <CardDescription>
            Pre správne fungovanie aplikácie potrebujete aspoň jeden API kľúč. 
            Alpha Vantage je primárny zdroj, Finnhub slúži ako záloha.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Alpha Vantage</h3>
                {settings?.alphaVantageKey ? (
                  <Badge variant="outline" className="text-green-500 border-green-500">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Aktívny
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-red-500 border-red-500">
                    <XCircle className="h-3 w-3 mr-1" />
                    Chýba
                  </Badge>
                )}
              </div>
              <a 
                href="https://www.alphavantage.co/support/#api-key" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
              >
                Získať kľúč <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <p className="text-sm text-muted-foreground">
              Primárny zdroj cien akcií. Bezplatný limit: 25 požiadaviek/deň.
            </p>
            
            {settings?.alphaVantageKey ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 p-2 bg-muted rounded-md">
                  <span className="font-mono text-sm">
                    {showAlphaVantage ? settings.alphaVantageKey : maskKey(settings.alphaVantageKey)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowAlphaVantage(!showAlphaVantage)}
                    data-testid="button-toggle-alphavantage"
                  >
                    {showAlphaVantage ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <Button 
                  variant="destructive" 
                  size="sm"
                  onClick={handleRemoveAlphaVantage}
                  disabled={updateSettingsMutation.isPending}
                  data-testid="button-remove-alphavantage"
                >
                  Odstrániť
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  placeholder="Zadajte Alpha Vantage API kľúč..."
                  value={alphaVantageKey}
                  onChange={(e) => setAlphaVantageKey(e.target.value)}
                  data-testid="input-alphavantage-key"
                />
                <Button 
                  onClick={handleSaveAlphaVantage}
                  disabled={!alphaVantageKey.trim() || updateSettingsMutation.isPending}
                  data-testid="button-save-alphavantage"
                >
                  {updateSettingsMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Uložiť"
                  )}
                </Button>
              </div>
            )}
          </div>

          <div className="border-t pt-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-medium">Finnhub</h3>
                {settings?.finnhubKey ? (
                  <Badge variant="outline" className="text-green-500 border-green-500">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Aktívny
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-red-500 border-red-500">
                    <XCircle className="h-3 w-3 mr-1" />
                    Chýba
                  </Badge>
                )}
              </div>
              <a 
                href="https://finnhub.io/register" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
              >
                Získať kľúč <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <p className="text-sm text-muted-foreground">
              Záložný zdroj cien. Bezplatný limit: 60 požiadaviek/minútu.
            </p>
            
            {settings?.finnhubKey ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 p-2 bg-muted rounded-md">
                  <span className="font-mono text-sm">
                    {showFinnhub ? settings.finnhubKey : maskKey(settings.finnhubKey)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowFinnhub(!showFinnhub)}
                    data-testid="button-toggle-finnhub"
                  >
                    {showFinnhub ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <Button 
                  variant="destructive" 
                  size="sm"
                  onClick={handleRemoveFinnhub}
                  disabled={updateSettingsMutation.isPending}
                  data-testid="button-remove-finnhub"
                >
                  Odstrániť
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  placeholder="Zadajte Finnhub API kľúč..."
                  value={finnhubKey}
                  onChange={(e) => setFinnhubKey(e.target.value)}
                  data-testid="input-finnhub-key"
                />
                <Button 
                  onClick={handleSaveFinnhub}
                  disabled={!finnhubKey.trim() || updateSettingsMutation.isPending}
                  data-testid="button-save-finnhub"
                >
                  {updateSettingsMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Uložiť"
                  )}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-primary" />
            <CardTitle>Prepočet realizovaného zisku</CardTitle>
          </div>
          <CardDescription>
            Prepočítajte realizovaný zisk/stratu pre všetky existujúce predajné transakcie na základe histórie nákupov.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Táto funkcia prepočíta realizovaný zisk pre všetky vaše SELL transakcie. 
            Zisk sa počíta ako: <span className="font-medium">(predajná cena - priemerná nákupná cena) × počet akcií - poplatky</span>
          </p>
          <div className="p-3 bg-muted rounded-lg text-sm">
            <p className="text-muted-foreground">
              Prepočet je potrebný len pre staršie transakcie. Nové predaje už automaticky počítajú realizovaný zisk.
            </p>
          </div>
          <Button 
            onClick={() => recalculateMutation.mutate()}
            disabled={recalculateMutation.isPending}
            data-testid="button-recalculate-gains"
          >
            {recalculateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Prepočítavam...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Prepočítať realizovaný zisk
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Informácie o API</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div>
            <h4 className="font-medium text-foreground mb-1">Alpha Vantage</h4>
            <p>
              Primárny zdroj pre historické a aktuálne ceny akcií. Podporuje americké aj európske trhy 
              (napr. VWCE.DEX pre XETRA, VUSA.L pre Londýn). Bezplatný plán má limit 25 požiadaviek denne.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-foreground mb-1">Finnhub</h4>
            <p>
              Záložný zdroj, ktorý sa použije ak Alpha Vantage nedostupný. Poskytuje real-time ceny 
              pre americké akcie. Bezplatný plán má limit 60 požiadaviek za minútu.
            </p>
          </div>
          <div className="p-3 bg-muted rounded-lg">
            <p className="font-medium text-foreground mb-1">Ako to funguje?</p>
            <p>
              Aplikácia najprv skúsi získať cenu z Alpha Vantage. Ak zlyhá (napr. prekročený limit), 
              automaticky použije Finnhub ako zálohu. Pre najlepší zážitok odporúčame mať oba kľúče.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <CardTitle className="text-destructive">Nebezpečná zóna</CardTitle>
          </div>
          <CardDescription>
            Nezvratné operácie nad vašimi dátami. Používajte len ak viete, čo
            robíte.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-semibold">Vymazať všetky transakcie a dáta</h4>
                <p className="text-sm text-muted-foreground">
                  Vymaže <span className="font-medium text-foreground">všetky transakcie, holdingy a opčné obchody</span>
                  {" "}naprieč všetkými vašimi portfóliami – vrátane tých, ktoré majú
                  neznáme portfólio (nezaradené záznamy). Portfóliá a API kľúče
                  zostanú zachované, aby ste mohli dáta znovu naimportovať.
                </p>
                <p className="text-sm font-medium text-destructive">
                  Táto akcia je nezvratná – nedá sa vrátiť späť.
                </p>
              </div>
            </div>
            <Button
              variant="destructive"
              onClick={() => {
                setWipeConfirmText("");
                setWipeDialogOpen(true);
              }}
              data-testid="button-open-wipe-dialog"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Vymazať všetky transakcie
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={wipeDialogOpen}
        onOpenChange={(open) => {
          if (!wipeAllDataMutation.isPending) {
            setWipeDialogOpen(open);
            if (!open) setWipeConfirmText("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Naozaj vymazať všetky dáta?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-2">
                <p>
                  Touto akciou <span className="font-semibold">natrvalo zmažete</span>:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>všetky transakcie (BUY, SELL, dividendy, dane) zo všetkých portfólií</li>
                  <li>všetky holdingy (aktuálne pozície)</li>
                  <li>všetky opčné obchody</li>
                  <li>aj tzv. nezaradené záznamy bez portfólia</li>
                </ul>
                <p className="text-sm">
                  Portfóliá, nastavenia meny, API kľúče a prihlásenie
                  <span className="font-medium"> zostanú</span>. Po vymazaní môžete naimportovať dáta odznova.
                </p>
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  Túto akciu nie je možné vrátiť späť. Žiadny undo, žiadna záloha.
                </div>
                <div className="space-y-2 pt-2">
                  <label className="text-sm font-medium text-foreground">
                    Na potvrdenie napíšte do poľa: <span className="font-mono">VYMAZAT VSETKO</span>
                  </label>
                  <Input
                    value={wipeConfirmText}
                    onChange={(e) => setWipeConfirmText(e.target.value)}
                    placeholder="VYMAZAT VSETKO"
                    autoFocus
                    disabled={wipeAllDataMutation.isPending}
                    data-testid="input-wipe-confirm"
                  />
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setWipeDialogOpen(false);
                setWipeConfirmText("");
              }}
              disabled={wipeAllDataMutation.isPending}
              data-testid="button-cancel-wipe"
            >
              Zrušiť
            </Button>
            <Button
              variant="destructive"
              onClick={() => wipeAllDataMutation.mutate()}
              disabled={
                wipeConfirmText.trim() !== "VYMAZAT VSETKO" ||
                wipeAllDataMutation.isPending
              }
              data-testid="button-confirm-wipe"
            >
              {wipeAllDataMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Mažem...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Áno, vymazať všetko
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
