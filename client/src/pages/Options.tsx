import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { usePortfolio } from "@/hooks/usePortfolio";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, TrendingUp, TrendingDown, Target, Clock, CheckCircle, XCircle, AlertTriangle, Trash2, Edit, X, Download, Upload, FileText, Calendar, DollarSign, Hash, FileDown } from "lucide-react";
import { format } from "date-fns";
import { sk } from "date-fns/locale";
import type { OptionTrade, Portfolio } from "@shared/schema";

interface OptionStats {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: string;
  totalRealizedGain: string;
  totalWins: string;
  totalLosses: string;
  avgWin: string;
  avgLoss: string;
}

const formatUSD = (value: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

export default function Options() {
  const { selectedPortfolioId, portfolios } = usePortfolio();
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<OptionTrade | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const portfolioParam = selectedPortfolioId && selectedPortfolioId !== "all" ? `?portfolio=${selectedPortfolioId}` : "";

  const { data: trades, isLoading: tradesLoading } = useQuery<OptionTrade[]>({
    queryKey: ["/api/options" + portfolioParam],
  });

  const { data: stats, isLoading: statsLoading } = useQuery<OptionStats>({
    queryKey: ["/api/options/stats/summary" + portfolioParam],
  });

  const invalidateOptionsQueries = () => {
    queryClient.invalidateQueries({ predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === 'string' && key.startsWith('/api/options');
    }});
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/options", data);
    },
    onSuccess: () => {
      invalidateOptionsQueries();
      setIsAddDialogOpen(false);
      toast({
        title: "Úspech",
        description: "Opčný obchod bol pridaný.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Chyba",
        description: error.message || "Nepodarilo sa pridať opčný obchod.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return await apiRequest("PATCH", `/api/options/${id}`, data);
    },
    onSuccess: () => {
      invalidateOptionsQueries();
      setIsEditDialogOpen(false);
      setIsCloseDialogOpen(false);
      setSelectedTrade(null);
      toast({
        title: "Úspech",
        description: "Opčný obchod bol aktualizovaný.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Chyba",
        description: error.message || "Nepodarilo sa aktualizovať opčný obchod.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/options/${id}`);
    },
    onSuccess: () => {
      invalidateOptionsQueries();
      toast({
        title: "Úspech",
        description: "Opčný obchod bol vymazaný.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Chyba",
        description: error.message || "Nepodarilo sa vymazať opčný obchod.",
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: { trades: any[]; portfolioId: string | null }) => {
      return await apiRequest("POST", "/api/options/import", data);
    },
    onSuccess: (result: any) => {
      invalidateOptionsQueries();
      setIsImportDialogOpen(false);
      toast({
        title: "Import dokončený",
        description: result.message || `Importovaných ${result.imported} obchodov.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Chyba importu",
        description: error.message || "Nepodarilo sa importovať obchody.",
        variant: "destructive",
      });
    },
  });

  const filteredTrades = trades?.filter(trade => {
    if (filter === "open") return trade.status === "OPEN";
    if (filter === "closed") return trade.status !== "OPEN";
    return true;
  }) || [];

  const handleExport = () => {
    const exportUrl = `/api/options/export${portfolioParam}`;
    window.open(exportUrl, '_blank');
  };

  const handleDownloadTemplate = () => {
    window.open('/api/options/template', '_blank');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "OPEN":
        return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30"><Clock className="h-3 w-3 mr-1" />Otvorená</Badge>;
      case "CLOSED":
        return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30"><CheckCircle className="h-3 w-3 mr-1" />Uzatvorená</Badge>;
      case "EXPIRED":
        return <Badge variant="outline" className="bg-gray-500/10 text-gray-600 border-gray-500/30"><XCircle className="h-3 w-3 mr-1" />Expirovala</Badge>;
      case "ASSIGNED":
        return <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-500/30"><AlertTriangle className="h-3 w-3 mr-1" />Priradená</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getDirectionBadge = (direction: string, optionType: string) => {
    const label = `${direction} ${optionType}`;
    if (direction === "SELL") {
      return <Badge className="bg-red-500/90 text-white">{label}</Badge>;
    }
    return <Badge className="bg-green-500/90 text-white">{label}</Badge>;
  };

  const getDaysToExpiry = (expirationDate: Date) => {
    const now = new Date();
    const expiry = new Date(expirationDate);
    const diffTime = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-options-title">Opcie</h1>
          <p className="text-muted-foreground">Sledovanie opčných obchodov</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleDownloadTemplate} data-testid="button-download-template">
            <FileDown className="h-4 w-4 mr-2" />
            Vzorový súbor
          </Button>
          <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" data-testid="button-open-import">
                <Upload className="h-4 w-4 mr-2" />
                Import
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Importovať opcie</DialogTitle>
                <DialogDescription>
                  Nahrajte CSV súbor s opčnými obchodmi alebo vložte dáta manuálne
                </DialogDescription>
              </DialogHeader>
              <ImportOptionsForm 
                onSubmit={(trades) => {
                  const portfolioId = selectedPortfolioId === "all" 
                    ? portfolios[0]?.id || null 
                    : selectedPortfolioId;
                  importMutation.mutate({ trades, portfolioId });
                }}
                isPending={importMutation.isPending}
              />
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" onClick={handleExport} data-testid="button-export">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-option">
                <Plus className="h-4 w-4 mr-2" />
                Nová opcia
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Pridať opčný obchod</DialogTitle>
                <DialogDescription>Zadajte detaily vášho opčného obchodu</DialogDescription>
              </DialogHeader>
              <AddOptionForm 
                onSubmit={(data) => createMutation.mutate(data)}
                isPending={createMutation.isPending}
                portfolios={portfolios}
                selectedPortfolioId={selectedPortfolioId}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {statsLoading ? (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2 p-3 md:p-6">
                <Skeleton className="h-4 w-20" />
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <Skeleton className="h-6 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : stats ? (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 gap-1 p-3 md:p-6 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium">Celkový zisk</CardTitle>
              {parseFloat(stats.totalRealizedGain) >= 0 ? (
                <TrendingUp className="h-3 w-3 md:h-4 md:w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-3 w-3 md:h-4 md:w-4 text-red-500" />
              )}
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <div className={`text-lg md:text-2xl font-bold truncate ${parseFloat(stats.totalRealizedGain) >= 0 ? "text-green-600" : "text-red-600"}`} data-testid="text-options-total-gain">
                {formatUSD(parseFloat(stats.totalRealizedGain))}
              </div>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-1 truncate">
                <span className="hidden md:inline">Zisky: </span>{formatUSD(parseFloat(stats.totalWins))} | <span className="hidden md:inline">Straty: </span>{formatUSD(parseFloat(stats.totalLosses))}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 gap-1 p-3 md:p-6 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium">Win Rate</CardTitle>
              <Target className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <div className="text-lg md:text-2xl font-bold" data-testid="text-options-win-rate">
                {stats.winRate}%
              </div>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
                {stats.winningTrades}W/{stats.losingTrades}L <span className="hidden md:inline">z {stats.closedTrades} uzatvorených</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 gap-1 p-3 md:p-6 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium">Otvorené</CardTitle>
              <Clock className="h-3 w-3 md:h-4 md:w-4 text-blue-500" />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <div className="text-lg md:text-2xl font-bold" data-testid="text-options-open">
                {stats.openTrades}
              </div>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-1">
                z {stats.totalTrades} celkovo
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 gap-1 p-3 md:p-6 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium">Priem. obchod</CardTitle>
              <TrendingUp className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <div className="text-lg md:text-2xl font-bold truncate" data-testid="text-options-avg">
                {formatUSD(parseFloat(stats.avgWin))}
              </div>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-1 truncate">
                <span className="hidden md:inline">Priem. strata: </span>{formatUSD(parseFloat(stats.avgLoss))}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader className="p-3 md:p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <CardTitle className="text-base md:text-lg">Opčné obchody</CardTitle>
            <div className="flex gap-1 md:gap-2">
              <Button
                variant={filter === "all" ? "default" : "outline"}
                size="sm"
                className="text-xs px-2 md:px-3"
                onClick={() => setFilter("all")}
                data-testid="button-filter-all"
              >
                Všetky
              </Button>
              <Button
                variant={filter === "open" ? "default" : "outline"}
                size="sm"
                className="text-xs px-2 md:px-3"
                onClick={() => setFilter("open")}
                data-testid="button-filter-open"
              >
                Otvorené
              </Button>
              <Button
                variant={filter === "closed" ? "default" : "outline"}
                size="sm"
                className="text-xs px-2 md:px-3"
                onClick={() => setFilter("closed")}
                data-testid="button-filter-closed"
              >
                Uzatvorené
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
          {tradesLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : filteredTrades.length === 0 ? (
            <div className="text-center py-12">
              <Target className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">
                {filter === "all" 
                  ? "Zatiaľ nemáte žiadne opčné obchody." 
                  : filter === "open" 
                    ? "Nemáte žiadne otvorené pozície."
                    : "Nemáte žiadne uzatvorené pozície."}
              </p>
              {filter === "all" && (
                <div className="flex flex-col sm:flex-row gap-2 justify-center mt-4">
                  <Button 
                    variant="outline"
                    onClick={() => setIsAddDialogOpen(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Pridať obchod
                  </Button>
                  <Button 
                    variant="outline"
                    onClick={() => setIsImportDialogOpen(true)}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Importovať
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTrades.map((trade) => {
                const daysToExpiry = getDaysToExpiry(trade.expirationDate);
                const totalPremium = parseFloat(trade.premium) * 100 * parseFloat(trade.contracts);
                
                return (
                  <div 
                    key={trade.id} 
                    className="p-4 rounded-lg border bg-card hover-elevate"
                    data-testid={`option-trade-${trade.id}`}
                  >
                    <div className="flex flex-col md:flex-row gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 md:gap-2 mb-2">
                          <span className="font-bold text-lg">{trade.underlying}</span>
                          {getDirectionBadge(trade.direction, trade.optionType)}
                          {getStatusBadge(trade.status)}
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div className="flex items-center gap-1.5">
                            <DollarSign className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="text-muted-foreground text-xs">Strike</div>
                              <div className="font-medium">{formatUSD(parseFloat(trade.strikePrice))}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="text-muted-foreground text-xs">Expirácia</div>
                              <div className="font-medium">
                                {format(new Date(trade.expirationDate), "d.M.yyyy", { locale: sk })}
                                {trade.status === "OPEN" && (
                                  <span className={`ml-1 text-xs ${daysToExpiry <= 7 ? "text-red-500" : daysToExpiry <= 30 ? "text-yellow-500" : "text-muted-foreground"}`}>
                                    ({daysToExpiry}d)
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Hash className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="text-muted-foreground text-xs">Kontrakty</div>
                              <div className="font-medium">{trade.contracts}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="text-muted-foreground text-xs">Prémia</div>
                              <div className="font-medium">
                                ${parseFloat(trade.premium).toFixed(2)}/akcia
                                <span className="text-muted-foreground text-xs ml-1">({formatUSD(totalPremium)})</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-muted-foreground">
                          <span>Otvorené: {format(new Date(trade.openDate), "d.M.yyyy", { locale: sk })}</span>
                          {trade.closeDate && (
                            <span>Zatvorené: {format(new Date(trade.closeDate), "d.M.yyyy", { locale: sk })}</span>
                          )}
                          {trade.commission && parseFloat(trade.commission) > 0 && (
                            <span>Poplatok: {formatUSD(parseFloat(trade.commission))}</span>
                          )}
                          {trade.notes && (
                            <span className="italic truncate max-w-[200px]" title={trade.notes}>
                              <FileText className="h-3 w-3 inline mr-1" />
                              {trade.notes}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-start gap-2 md:gap-3 md:min-w-[140px]">
                        <div className="text-right">
                          <div className={`text-xl font-bold ${parseFloat(trade.realizedGain || "0") >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {trade.status !== "OPEN" 
                              ? formatUSD(parseFloat(trade.realizedGain || "0"))
                              : "-"
                            }
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {trade.status !== "OPEN" ? "Realizované" : "Otvorená pozícia"}
                          </div>
                        </div>
                        
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              setSelectedTrade(trade);
                              setIsEditDialogOpen(true);
                            }}
                            data-testid={`button-edit-${trade.id}`}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          {trade.status === "OPEN" && (
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                setSelectedTrade(trade);
                                setIsCloseDialogOpen(true);
                              }}
                              data-testid={`button-close-${trade.id}`}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              if (confirm("Naozaj chcete vymazať tento obchod?")) {
                                deleteMutation.mutate(trade.id);
                              }
                            }}
                            data-testid={`button-delete-${trade.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isCloseDialogOpen} onOpenChange={setIsCloseDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uzatvoriť pozíciu</DialogTitle>
            <DialogDescription>
              {selectedTrade && `${selectedTrade.underlying} ${selectedTrade.direction} ${selectedTrade.optionType} @ ${formatUSD(parseFloat(selectedTrade.strikePrice))}`}
            </DialogDescription>
          </DialogHeader>
          {selectedTrade && (
            <CloseOptionForm
              trade={selectedTrade}
              onSubmit={(data) => updateMutation.mutate({ id: selectedTrade.id, data })}
              isPending={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upraviť opčný obchod</DialogTitle>
            <DialogDescription>
              {selectedTrade && `${selectedTrade.underlying} ${selectedTrade.direction} ${selectedTrade.optionType}`}
            </DialogDescription>
          </DialogHeader>
          {selectedTrade && (
            <EditOptionForm
              trade={selectedTrade}
              portfolios={portfolios}
              onSubmit={(data) => updateMutation.mutate({ id: selectedTrade.id, data })}
              isPending={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddOptionForm({ 
  onSubmit, 
  isPending, 
  portfolios, 
  selectedPortfolioId 
}: { 
  onSubmit: (data: any) => void;
  isPending: boolean;
  portfolios: any[];
  selectedPortfolioId: string | null;
}) {
  const [formData, setFormData] = useState({
    portfolioId: selectedPortfolioId === "all" ? portfolios[0]?.id || "" : selectedPortfolioId,
    underlying: "",
    optionType: "CALL",
    direction: "SELL",
    strikePrice: "",
    expirationDate: "",
    premium: "",
    contracts: "1",
    commission: "0",
    notes: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      expirationDate: new Date(formData.expirationDate).toISOString(),
      openDate: new Date().toISOString(),
      status: "OPEN",
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="underlying">Podkladové aktívum</Label>
          <Input
            id="underlying"
            placeholder="AAPL, SPY, ..."
            value={formData.underlying}
            onChange={(e) => setFormData(prev => ({ ...prev, underlying: e.target.value.toUpperCase() }))}
            required
            data-testid="input-underlying"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="portfolioId">Portfólio</Label>
          <Select
            value={formData.portfolioId || ""}
            onValueChange={(value) => setFormData(prev => ({ ...prev, portfolioId: value }))}
          >
            <SelectTrigger data-testid="select-portfolio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {portfolios.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="optionType">Typ opcie</Label>
          <Select
            value={formData.optionType}
            onValueChange={(value) => setFormData(prev => ({ ...prev, optionType: value }))}
          >
            <SelectTrigger data-testid="select-option-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CALL">CALL</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="direction">Smer</Label>
          <Select
            value={formData.direction}
            onValueChange={(value) => setFormData(prev => ({ ...prev, direction: value }))}
          >
            <SelectTrigger data-testid="select-direction">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BUY">BUY (Nákup)</SelectItem>
              <SelectItem value="SELL">SELL (Predaj/Písanie)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="strikePrice">Strike cena</Label>
          <Input
            id="strikePrice"
            type="number"
            step="0.01"
            placeholder="150.00"
            value={formData.strikePrice}
            onChange={(e) => setFormData(prev => ({ ...prev, strikePrice: e.target.value }))}
            required
            data-testid="input-strike-price"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="expirationDate">Dátum expirácie</Label>
          <Input
            id="expirationDate"
            type="date"
            value={formData.expirationDate}
            onChange={(e) => setFormData(prev => ({ ...prev, expirationDate: e.target.value }))}
            required
            data-testid="input-expiration-date"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="premium">Prémia/akcia</Label>
          <Input
            id="premium"
            type="number"
            step="0.01"
            placeholder="2.50"
            value={formData.premium}
            onChange={(e) => setFormData(prev => ({ ...prev, premium: e.target.value }))}
            required
            data-testid="input-premium"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="contracts">Kontrakty</Label>
          <Input
            id="contracts"
            type="number"
            min="1"
            value={formData.contracts}
            onChange={(e) => setFormData(prev => ({ ...prev, contracts: e.target.value }))}
            required
            data-testid="input-contracts"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="commission">Poplatok</Label>
          <Input
            id="commission"
            type="number"
            step="0.01"
            value={formData.commission}
            onChange={(e) => setFormData(prev => ({ ...prev, commission: e.target.value }))}
            data-testid="input-commission"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Poznámky</Label>
        <Input
          id="notes"
          placeholder="Voliteľné poznámky..."
          value={formData.notes}
          onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
          data-testid="input-notes"
        />
      </div>

      {formData.premium && formData.contracts && (
        <div className="p-3 bg-muted rounded-lg text-sm">
          <div className="flex justify-between">
            <span>Celková prémia:</span>
            <span className="font-semibold">
              {formatUSD(parseFloat(formData.premium || "0") * 100 * parseInt(formData.contracts || "1"))} 
              <span className="text-muted-foreground ml-1">(100 akcií × {formData.contracts} kontraktov)</span>
            </span>
          </div>
        </div>
      )}

      <DialogFooter>
        <Button type="submit" disabled={isPending} data-testid="button-submit-option">
          {isPending ? "Ukladám..." : "Pridať obchod"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditOptionForm({ 
  trade,
  portfolios,
  onSubmit, 
  isPending 
}: { 
  trade: OptionTrade;
  portfolios: any[];
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [formData, setFormData] = useState({
    portfolioId: trade.portfolioId || "",
    underlying: trade.underlying,
    optionType: trade.optionType,
    direction: trade.direction,
    strikePrice: trade.strikePrice,
    expirationDate: new Date(trade.expirationDate).toISOString().split('T')[0],
    premium: trade.premium,
    contracts: trade.contracts,
    commission: trade.commission || "0",
    notes: trade.notes || "",
    openDate: new Date(trade.openDate).toISOString().split('T')[0],
    realizedGain: trade.realizedGain || "0",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      expirationDate: new Date(formData.expirationDate).toISOString(),
      openDate: new Date(formData.openDate).toISOString(),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="edit-underlying">Podkladové aktívum</Label>
          <Input
            id="edit-underlying"
            value={formData.underlying}
            onChange={(e) => setFormData(prev => ({ ...prev, underlying: e.target.value.toUpperCase() }))}
            required
            data-testid="input-edit-underlying"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-portfolioId">Portfólio</Label>
          <Select
            value={formData.portfolioId || ""}
            onValueChange={(value) => setFormData(prev => ({ ...prev, portfolioId: value }))}
          >
            <SelectTrigger data-testid="select-edit-portfolio">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {portfolios.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="edit-optionType">Typ opcie</Label>
          <Select
            value={formData.optionType}
            onValueChange={(value) => setFormData(prev => ({ ...prev, optionType: value }))}
          >
            <SelectTrigger data-testid="select-edit-option-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CALL">CALL</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-direction">Smer</Label>
          <Select
            value={formData.direction}
            onValueChange={(value) => setFormData(prev => ({ ...prev, direction: value }))}
          >
            <SelectTrigger data-testid="select-edit-direction">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BUY">BUY (Nákup)</SelectItem>
              <SelectItem value="SELL">SELL (Predaj/Písanie)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="edit-strikePrice">Strike cena</Label>
          <Input
            id="edit-strikePrice"
            type="number"
            step="0.01"
            value={formData.strikePrice}
            onChange={(e) => setFormData(prev => ({ ...prev, strikePrice: e.target.value }))}
            required
            data-testid="input-edit-strike-price"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-expirationDate">Dátum expirácie</Label>
          <Input
            id="edit-expirationDate"
            type="date"
            value={formData.expirationDate}
            onChange={(e) => setFormData(prev => ({ ...prev, expirationDate: e.target.value }))}
            required
            data-testid="input-edit-expiration-date"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="edit-premium">Prémia/akcia</Label>
          <Input
            id="edit-premium"
            type="number"
            step="0.01"
            value={formData.premium}
            onChange={(e) => setFormData(prev => ({ ...prev, premium: e.target.value }))}
            required
            data-testid="input-edit-premium"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-contracts">Kontrakty</Label>
          <Input
            id="edit-contracts"
            type="number"
            min="1"
            value={formData.contracts}
            onChange={(e) => setFormData(prev => ({ ...prev, contracts: e.target.value }))}
            required
            data-testid="input-edit-contracts"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-commission">Poplatok</Label>
          <Input
            id="edit-commission"
            type="number"
            step="0.01"
            value={formData.commission}
            onChange={(e) => setFormData(prev => ({ ...prev, commission: e.target.value }))}
            data-testid="input-edit-commission"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="edit-openDate">Dátum otvorenia</Label>
          <Input
            id="edit-openDate"
            type="date"
            value={formData.openDate}
            onChange={(e) => setFormData(prev => ({ ...prev, openDate: e.target.value }))}
            required
            data-testid="input-edit-open-date"
          />
        </div>
        {trade.status !== "OPEN" && (
          <div className="space-y-2">
            <Label htmlFor="edit-realizedGain">Realizovaný zisk</Label>
            <Input
              id="edit-realizedGain"
              type="number"
              step="0.01"
              value={formData.realizedGain}
              onChange={(e) => setFormData(prev => ({ ...prev, realizedGain: e.target.value }))}
              data-testid="input-edit-realized-gain"
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="edit-notes">Poznámky</Label>
        <Textarea
          id="edit-notes"
          placeholder="Poznámky k obchodu..."
          value={formData.notes}
          onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
          className="min-h-[80px]"
          data-testid="input-edit-notes"
        />
      </div>

      <DialogFooter>
        <Button type="submit" disabled={isPending} data-testid="button-save-edit">
          {isPending ? "Ukladám..." : "Uložiť zmeny"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function CloseOptionForm({ 
  trade, 
  onSubmit, 
  isPending 
}: { 
  trade: OptionTrade;
  onSubmit: (data: any) => void;
  isPending: boolean;
}) {
  const [formData, setFormData] = useState({
    status: "CLOSED",
    closePremium: "",
    closeCommission: "0",
    closeDate: new Date().toISOString().split("T")[0],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submitData: any = {
      status: formData.status,
      closeDate: new Date(formData.closeDate).toISOString(),
    };
    
    if (formData.status === "CLOSED") {
      submitData.closePremium = formData.closePremium;
      submitData.closeCommission = formData.closeCommission;
    }
    
    onSubmit(submitData);
  };

  const calculatePnL = () => {
    const openPremium = parseFloat(trade.premium);
    const contracts = parseFloat(trade.contracts);
    const openCommission = parseFloat(trade.commission || "0");
    const closePremium = parseFloat(formData.closePremium || "0");
    const closeCommission = parseFloat(formData.closeCommission || "0");

    if (formData.status === "EXPIRED") {
      if (trade.direction === "SELL") {
        return (openPremium * 100 * contracts) - openCommission;
      }
      return -(openPremium * 100 * contracts) - openCommission;
    }

    if (formData.status === "CLOSED" && formData.closePremium) {
      if (trade.direction === "SELL") {
        return ((openPremium - closePremium) * 100 * contracts) - openCommission - closeCommission;
      }
      return ((closePremium - openPremium) * 100 * contracts) - openCommission - closeCommission;
    }

    if (formData.status === "ASSIGNED") {
      if (trade.direction === "SELL") {
        return (openPremium * 100 * contracts) - openCommission;
      }
      return -(openPremium * 100 * contracts) - openCommission;
    }

    return 0;
  };

  const pnl = calculatePnL();

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="status">Spôsob uzatvorenia</Label>
        <Select
          value={formData.status}
          onValueChange={(value) => setFormData(prev => ({ ...prev, status: value }))}
        >
          <SelectTrigger data-testid="select-close-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CLOSED">Uzatvorená (buy to close / sell to close)</SelectItem>
            <SelectItem value="EXPIRED">Expirovala bezcenná</SelectItem>
            <SelectItem value="ASSIGNED">Priradená (assignment)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {formData.status === "CLOSED" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="closePremium">Zatvárajúca prémia/akcia</Label>
            <Input
              id="closePremium"
              type="number"
              step="0.01"
              placeholder="1.00"
              value={formData.closePremium}
              onChange={(e) => setFormData(prev => ({ ...prev, closePremium: e.target.value }))}
              required
              data-testid="input-close-premium"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="closeCommission">Poplatok</Label>
            <Input
              id="closeCommission"
              type="number"
              step="0.01"
              value={formData.closeCommission}
              onChange={(e) => setFormData(prev => ({ ...prev, closeCommission: e.target.value }))}
              data-testid="input-close-commission"
            />
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="closeDate">Dátum uzatvorenia</Label>
        <Input
          id="closeDate"
          type="date"
          value={formData.closeDate}
          onChange={(e) => setFormData(prev => ({ ...prev, closeDate: e.target.value }))}
          required
          data-testid="input-close-date"
        />
      </div>

      <div className={`p-3 rounded-lg text-sm ${pnl >= 0 ? "bg-green-500/10" : "bg-red-500/10"}`}>
        <div className="flex justify-between">
          <span>Odhadovaný P/L:</span>
          <span className={`font-bold ${pnl >= 0 ? "text-green-600" : "text-red-600"}`}>
            {pnl >= 0 ? "+" : ""}{formatUSD(Math.abs(pnl))}
          </span>
        </div>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={isPending} data-testid="button-confirm-close">
          {isPending ? "Ukladám..." : "Uzatvoriť pozíciu"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ImportOptionsForm({ 
  onSubmit, 
  isPending 
}: { 
  onSubmit: (trades: any[]) => void;
  isPending: boolean;
}) {
  const [csvContent, setCsvContent] = useState("");
  const [parsedTrades, setParsedTrades] = useState<any[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseCSV = (content: string) => {
    const lines = content.trim().split('\n');
    if (lines.length < 2) {
      setParseError("CSV musí obsahovať hlavičku a aspoň jeden riadok dát.");
      return;
    }

    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const requiredFields = ['underlying', 'optiontype', 'direction', 'strikeprice', 'expirationdate'];
    const missing = requiredFields.filter(f => !header.includes(f));
    
    if (missing.length > 0) {
      setParseError(`Chýbajúce povinné stĺpce: ${missing.join(', ')}`);
      return;
    }

    try {
      const trades = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        const values = lines[i].split(',').map(v => v.trim());
        const trade: any = {};
        
        header.forEach((h, idx) => {
          const key = h.replace(/\s+/g, '');
          trade[key] = values[idx] || "";
        });

        trades.push({
          underlying: trade.underlying,
          optionType: trade.optiontype,
          direction: trade.direction,
          strikePrice: trade.strikeprice,
          expirationDate: trade.expirationdate,
          contracts: trade.contracts || "1",
          premium: trade.premium || "0",
          commission: trade.commission || "0",
          status: trade.status || "OPEN",
          openDate: trade.opendate || new Date().toISOString().split('T')[0],
          closeDate: trade.closedate || null,
          closePremium: trade.closepremium || null,
          closeCommission: trade.closecommission || null,
          realizedGain: trade.realizedgain || "0",
          notes: trade.notes || null,
        });
      }

      setParsedTrades(trades);
      setParseError(null);
    } catch (err: any) {
      setParseError(`Chyba pri parsovaní: ${err.message}`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCsvContent(content);
      parseCSV(content);
    };
    reader.readAsText(file);
  };

  const handlePaste = () => {
    if (csvContent) {
      parseCSV(csvContent);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedTrades.length > 0) {
      onSubmit(parsedTrades);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Tabs defaultValue="upload">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="upload">Nahrať súbor</TabsTrigger>
          <TabsTrigger value="paste">Vložiť CSV</TabsTrigger>
        </TabsList>
        
        <TabsContent value="upload" className="space-y-4">
          <div className="border-2 border-dashed rounded-lg p-6 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              data-testid="input-file-upload"
            />
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground mb-3">
              Nahrajte CSV súbor s opčnými obchodmi
            </p>
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => fileInputRef.current?.click()}
              data-testid="button-select-file"
            >
              Vybrať súbor
            </Button>
          </div>
        </TabsContent>
        
        <TabsContent value="paste" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="csvContent">CSV obsah</Label>
            <Textarea
              id="csvContent"
              placeholder="underlying,optionType,direction,strikePrice,expirationDate,contracts,premium,..."
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              className="min-h-[150px] font-mono text-xs"
              data-testid="textarea-csv-content"
            />
            <Button 
              type="button" 
              variant="outline" 
              onClick={handlePaste}
              data-testid="button-parse-csv"
            >
              Parsovať CSV
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {parseError && (
        <div className="p-3 bg-red-500/10 text-red-600 rounded-lg text-sm">
          {parseError}
        </div>
      )}

      {parsedTrades.length > 0 && (
        <div className="space-y-2">
          <div className="p-3 bg-green-500/10 text-green-600 rounded-lg text-sm">
            Nájdených {parsedTrades.length} obchodov na import
          </div>
          <div className="max-h-[200px] overflow-auto border rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="p-2 text-left">Ticker</th>
                  <th className="p-2 text-left">Typ</th>
                  <th className="p-2 text-left">Smer</th>
                  <th className="p-2 text-left">Strike</th>
                  <th className="p-2 text-left">Expirácia</th>
                  <th className="p-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {parsedTrades.slice(0, 10).map((trade, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="p-2">{trade.underlying}</td>
                    <td className="p-2">{trade.optionType}</td>
                    <td className="p-2">{trade.direction}</td>
                    <td className="p-2">{trade.strikePrice}</td>
                    <td className="p-2">{trade.expirationDate}</td>
                    <td className="p-2">{trade.status}</td>
                  </tr>
                ))}
                {parsedTrades.length > 10 && (
                  <tr className="border-t">
                    <td colSpan={6} className="p-2 text-center text-muted-foreground">
                      ... a ďalších {parsedTrades.length - 10} obchodov
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="text-xs text-muted-foreground p-3 bg-muted rounded-lg">
        <p className="font-medium mb-1">Formát CSV:</p>
        <p>underlying, optionType, direction, strikePrice, expirationDate, contracts, premium, commission, status, openDate, closeDate, closePremium, closeCommission, realizedGain, notes</p>
        <p className="mt-2">
          <Button 
            type="button" 
            variant="ghost" 
            className="h-auto p-0 text-xs underline"
            onClick={() => window.open('/api/options/template', '_blank')}
          >
            Stiahnuť vzorový súbor
          </Button>
        </p>
      </div>

      <DialogFooter>
        <Button 
          type="submit" 
          disabled={isPending || parsedTrades.length === 0} 
          data-testid="button-confirm-import"
        >
          {isPending ? "Importujem..." : `Importovať ${parsedTrades.length} obchodov`}
        </Button>
      </DialogFooter>
    </form>
  );
}
