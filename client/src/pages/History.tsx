import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { sk } from "date-fns/locale";
import { Trash2, Download, Upload, FileDown, AlertTriangle, CheckCircle2, Loader2, Pencil, PlusCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { CompanyLogo } from "@/components/CompanyLogo";
import type { Transaction } from "@shared/schema";
import { AddTransactionForm } from "@/components/AddTransactionForm";

interface ImportResult {
  imported: number;
  skipped: number;
  alreadyExisting?: number;
  importedTickers: string[];
  errors: Array<{ row: number; ticker: string; reason: string }>;
}

interface EditFormData {
  type: string;
  ticker: string;
  companyName: string;
  shares: string;
  pricePerShare: string;
  commission: string;
  transactionDate: string;
}

export default function History() {
  const { toast } = useToast();
  const { formatCurrency } = useCurrency();
  const { getQueryParam, portfolios } = usePortfolio();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [tickerFilter, setTickerFilter] = useState<string>("all");
  const [idFilter, setIdFilter] = useState<string>("");
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [addTransactionOpen, setAddTransactionOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditFormData>({
    type: "BUY",
    ticker: "",
    companyName: "",
    shares: "",
    pricePerShare: "",
    commission: "",
    transactionDate: "",
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const portfolioParam = getQueryParam();

  const { data: transactions, isLoading } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/transactions?portfolio=${portfolioParam}`);
      if (!res.ok) throw new Error("Failed to fetch transactions");
      return res.json();
    },
  });

  const invalidateAllQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
    queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
    queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dividends"] });
    queryClient.invalidateQueries({ queryKey: ["/api/realized-gains"] });
    queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
  };

  const deleteMutation = useMutation({
    mutationFn: async (transactionId: string) => {
      return await apiRequest("DELETE", `/api/transactions/${transactionId}`);
    },
    onSuccess: () => {
      invalidateAllQueries();
    },
    onError: (error: Error) => {
      toast({
        title: "Chyba",
        description: error.message || "Nepodarilo sa vymazať transakciu.",
        variant: "destructive",
      });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await apiRequest("DELETE", `/api/transactions/${id}`);
      }
    },
    onSuccess: () => {
      toast({
        title: "Úspešne",
        description: `Vymazaných ${selectedIds.size} transakcií.`,
      });
      setSelectedIds(new Set());
      setDeleteDialogOpen(false);
      invalidateAllQueries();
    },
    onError: (error: Error) => {
      toast({
        title: "Chyba",
        description: error.message || "Nepodarilo sa vymazať transakcie.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: EditFormData }) => {
      return await apiRequest("PUT", `/api/transactions/${id}`, data);
    },
    onSuccess: () => {
      toast({
        title: "Úspešne",
        description: "Transakcia bola aktualizovaná.",
      });
      setEditDialogOpen(false);
      setEditingTransaction(null);
      invalidateAllQueries();
    },
    onError: (error: Error) => {
      toast({
        title: "Chyba",
        description: error.message || "Nepodarilo sa aktualizovať transakciu.",
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (csvData: string) => {
      const response = await apiRequest("POST", "/api/transactions/import", { csvData, portfolioId: portfolioParam === "all" ? undefined : portfolioParam });
      return response.json();
    },
    onSuccess: (data: ImportResult) => {
      setImportResult(data);
      invalidateAllQueries();
      
      if (data.errors.length === 0) {
        const existingSuffix = data.alreadyExisting && data.alreadyExisting > 0
          ? `, už existujúcich ${data.alreadyExisting}`
          : "";
        toast({
          title: "Import dokončený",
          description: `Úspešne importovaných ${data.imported} transakcií${existingSuffix}.`,
        });
      } else {
        toast({
          title: "Import dokončený s chybami",
          description: `Importovaných: ${data.imported}, Chyby: ${data.skipped}`,
          variant: "destructive",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Chyba importu",
        description: error.message || "Nepodarilo sa importovať transakcie.",
        variant: "destructive",
      });
    },
  });

  const handleExport = () => {
    window.location.href = `/api/transactions/export?portfolio=${portfolioParam}`;
  };

  const handleDownloadTemplate = () => {
    window.location.href = "/api/transactions/import-template";
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      importMutation.mutate(text);
    } catch (error) {
      toast({
        title: "Chyba",
        description: "Nepodarilo sa načítať súbor.",
        variant: "destructive",
      });
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleImportClick = () => {
    setImportResult(null);
    fileInputRef.current?.click();
  };

  const handleEditClick = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    const date = new Date(transaction.transactionDate);
    setEditForm({
      type: transaction.type,
      ticker: transaction.ticker,
      companyName: transaction.companyName,
      shares: transaction.shares,
      pricePerShare: transaction.pricePerShare,
      commission: transaction.commission || "0",
      transactionDate: format(date, "yyyy-MM-dd'T'HH:mm"),
    });
    setEditDialogOpen(true);
  };

  const handleEditSubmit = () => {
    if (!editingTransaction) return;
    updateMutation.mutate({
      id: editingTransaction.id,
      data: editForm,
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked && filteredTransactions) {
      setSelectedIds(new Set(filteredTransactions.map(t => t.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const newSelected = new Set(selectedIds);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedIds(newSelected);
  };

  const handleBulkDelete = () => {
    bulkDeleteMutation.mutate(Array.from(selectedIds));
  };

  const uniqueTickers = transactions 
    ? Array.from(new Set(transactions.map(t => t.ticker))).sort()
    : [];

  const filteredTransactions = transactions?.filter((t) => {
    if (typeFilter !== "all" && t.type !== typeFilter) return false;
    if (tickerFilter !== "all" && t.ticker !== tickerFilter) return false;
    if (idFilter && !t.id.toLowerCase().includes(idFilter.toLowerCase())) return false;
    return true;
  });

  const allSelected = filteredTransactions && filteredTransactions.length > 0 && 
    filteredTransactions.every(t => selectedIds.has(t.id));
  const someSelected = filteredTransactions && 
    filteredTransactions.some(t => selectedIds.has(t.id));

  const formatDate = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return format(d, "d. MMM yyyy HH:mm", { locale: sk });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex gap-4">
              <Skeleton className="h-10 w-40" />
              <Skeleton className="h-10 w-40" />
            </div>
            <Skeleton className="h-64 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle>História transakcií</CardTitle>
              <CardDescription>
                Kompletný zoznam všetkých nákupov, predajov a dividend.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Dialog open={addTransactionOpen} onOpenChange={setAddTransactionOpen}>
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    disabled={portfolios.length === 0}
                    data-testid="button-add-transaction"
                  >
                    <PlusCircle className="h-4 w-4 mr-2" />
                    Pridať transakciu
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto gap-0 p-4 sm:p-6">
                  <AddTransactionForm
                    embed
                    onSuccessSubmit={() => setAddTransactionOpen(false)}
                  />
                </DialogContent>
              </Dialog>

              {selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setDeleteDialogOpen(true)}
                  data-testid="button-delete-selected"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Vymazať ({selectedIds.size})
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={!transactions || transactions.length === 0}
                data-testid="button-export-csv"
              >
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
              
              <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="button-import-csv"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Import CSV
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Import transakcií</DialogTitle>
                    <DialogDescription>
                      Nahrajte CSV súbor s transakciami. Stiahnite si vzorový súbor pre správny formát.
                    </DialogDescription>
                  </DialogHeader>
                  
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadTemplate}
                        data-testid="button-download-template"
                      >
                        <FileDown className="h-4 w-4 mr-2" />
                        Stiahnuť vzorový súbor
                      </Button>
                    </div>

                    <div className="p-4 border rounded-lg bg-muted/50">
                      <p className="text-sm text-muted-foreground mb-2">
                        Požadované stĺpce (oddelené čiarkou alebo bodkočiarkou):
                      </p>
                      <code className="text-xs bg-background p-2 rounded block">
                        typ,ticker,nazov,pocet,cena,poplatok,datum
                      </code>
                      <p className="text-xs text-muted-foreground mt-2">
                        Príklad: BUY,VWCE.DE,Vanguard FTSE All-World,10,120.50,1.50,2024-01-15 10:30
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Podporované formáty dátumu: DD.MM.YYYY HH:mm, DD.MM.YYYY, YYYY-MM-DD
                      </p>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleFileSelect}
                      className="hidden"
                      data-testid="input-import-file"
                    />

                    <Button
                      className="w-full"
                      onClick={handleImportClick}
                      disabled={importMutation.isPending}
                      data-testid="button-select-file"
                    >
                      {importMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Importujem...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Vybrať súbor a importovať
                        </>
                      )}
                    </Button>

                    {importResult && (
                      <div className="space-y-3">
                        <Alert variant={importResult.errors.length > 0 ? "destructive" : "default"}>
                          {importResult.errors.length > 0 ? (
                            <AlertTriangle className="h-4 w-4" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          <AlertTitle>
                            {importResult.errors.length > 0 ? "Import dokončený s chybami" : "Import úspešný"}
                          </AlertTitle>
                          <AlertDescription>
                            Importovaných: {importResult.imported} transakcií
                            {importResult.alreadyExisting !== undefined && importResult.alreadyExisting > 0 && ` | Už existujúcich: ${importResult.alreadyExisting}`}
                            {importResult.skipped > 0 && ` | Preskočených: ${importResult.skipped}`}
                          </AlertDescription>
                        </Alert>

                        {importResult.errors.length > 0 && (
                          <div className="border rounded-lg">
                            <div className="p-3 border-b bg-muted/50">
                              <h4 className="font-medium text-sm flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-red-500" />
                                Chyby importu ({importResult.errors.length})
                              </h4>
                              <p className="text-xs text-muted-foreground mt-1">
                                Tieto transakcie sa nepodarilo importovať. Pridajte ich manuálne.
                              </p>
                            </div>
                            <ScrollArea className="max-h-[200px]">
                              <div className="p-2 space-y-1">
                                {importResult.errors.map((error, idx) => (
                                  <div 
                                    key={idx} 
                                    className="text-sm p-2 bg-red-500/10 rounded border border-red-500/20"
                                    data-testid={`error-row-${error.row}`}
                                  >
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className="text-xs">
                                        Riadok {error.row}
                                      </Badge>
                                      <span className="font-medium">{error.ticker}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                      {error.reason}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </ScrollArea>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Typ:</span>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[140px]" data-testid="select-type-filter">
                  <SelectValue placeholder="Všetky" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Všetky</SelectItem>
                  <SelectItem value="BUY">Nákupy</SelectItem>
                  <SelectItem value="SELL">Predaje</SelectItem>
                  <SelectItem value="DIVIDEND">Dividendy</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Akcia:</span>
              <Select value={tickerFilter} onValueChange={setTickerFilter}>
                <SelectTrigger className="w-[140px]" data-testid="select-ticker-filter">
                  <SelectValue placeholder="Všetky" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Všetky</SelectItem>
                  {uniqueTickers.map((ticker) => (
                    <SelectItem key={ticker} value={ticker}>
                      {ticker}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 ml-auto">
                <Badge variant="secondary">
                  Označených: {selectedIds.size}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedIds(new Set())}
                  data-testid="button-clear-selection"
                >
                  Zrušiť výber
                </Button>
              </div>
            )}
          </div>

          {!filteredTransactions || filteredTransactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="text-no-transactions">
              <p>Žiadne transakcie na zobrazenie.</p>
              {transactions && transactions.length > 0 && (
                <p className="text-sm mt-2">Skúste zmeniť filtre.</p>
              )}
            </div>
          ) : (
            <>
              {/* Mobile view - compact list */}
              <div className="md:hidden space-y-1">
                {filteredTransactions.map((transaction) => {
                  const shares = parseFloat(transaction.shares);
                  const price = parseFloat(transaction.pricePerShare);
                  const commission = parseFloat(transaction.commission || "0");
                  const grossAmount = shares * price;
                  const total = transaction.type === "DIVIDEND" 
                    ? grossAmount - commission
                    : transaction.type === "BUY" 
                    ? grossAmount + commission 
                    : grossAmount - commission;
                  const isSelected = selectedIds.has(transaction.id);

                  return (
                    <div 
                      key={transaction.id} 
                      className={`py-2.5 px-1 border-b last:border-b-0 ${isSelected ? "bg-muted/50 rounded-lg" : ""}`}
                      data-testid={`row-mobile-transaction-${transaction.id}`}
                    >
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => handleSelectOne(transaction.id, checked as boolean)}
                          aria-label={`Označiť transakciu ${transaction.ticker}`}
                          className="mt-1"
                          data-testid={`checkbox-mobile-transaction-${transaction.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <CompanyLogo ticker={transaction.ticker} companyName={transaction.companyName} size="xs" />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-semibold text-xs">{transaction.ticker}</span>
                                  <Badge 
                                    variant={transaction.type === "SELL" ? "destructive" : "default"}
                                    className={`text-[10px] px-1.5 py-0 h-4 ${
                                      transaction.type === "BUY" 
                                        ? "bg-green-500/20 text-green-600 border-green-500/30" 
                                        : transaction.type === "DIVIDEND"
                                        ? "bg-blue-500/20 text-blue-600 border-blue-500/30"
                                        : ""
                                    }`}
                                  >
                                    {transaction.type === "BUY" ? "Nákup" : transaction.type === "SELL" ? "Predaj" : "Div"}
                                  </Badge>
                                </div>
                                <p className="text-[9px] text-muted-foreground truncate">{transaction.companyName}</p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-xs font-semibold">{formatCurrency(total)}</div>
                              {transaction.type === "SELL" && transaction.realizedGain ? (
                                <div className={`text-[10px] ${parseFloat(transaction.realizedGain) >= 0 ? "text-green-500" : "text-red-500"}`}>
                                  {parseFloat(transaction.realizedGain) >= 0 ? "+" : ""}{formatCurrency(parseFloat(transaction.realizedGain))}
                                </div>
                              ) : transaction.type === "DIVIDEND" ? (
                                <div className="text-[10px] text-blue-500">+{formatCurrency(total)}</div>
                              ) : (
                                <div className="text-[10px] text-muted-foreground">{shares.toFixed(2)} ks</div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-1.5">
                            <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                              <span>{formatDate(transaction.transactionDate)}</span>
                              <span>•</span>
                              <span>{formatCurrency(price)}/ks</span>
                              {commission > 0 && (
                                <>
                                  <span>•</span>
                                  <span>Popl: {formatCurrency(commission)}</span>
                                </>
                              )}
                            </div>
                            <div className="flex gap-0.5">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => handleEditClick(transaction)}
                                data-testid={`button-mobile-edit-${transaction.id}`}
                              >
                                <Pencil className="h-3 w-3 text-blue-500" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => deleteMutation.mutate(transaction.id)}
                                disabled={deleteMutation.isPending}
                                data-testid={`button-mobile-delete-${transaction.id}`}
                              >
                                <Trash2 className="h-3 w-3 text-red-500" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop view - table */}
              <div className="hidden md:block">
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={handleSelectAll}
                      aria-label="Označiť všetky"
                      data-testid="checkbox-select-all"
                      className={someSelected && !allSelected ? "data-[state=checked]:bg-primary/50" : ""}
                    />
                  </TableHead>
                  <TableHead className="w-32">
                    <div className="flex flex-col gap-1">
                      <span>ID</span>
                      <Input
                        placeholder="Filtrovať..."
                        value={idFilter}
                        onChange={(e) => setIdFilter(e.target.value)}
                        className="h-7 text-xs"
                        data-testid="input-id-filter"
                      />
                    </div>
                  </TableHead>
                  <TableHead>Dátum</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Ticker</TableHead>
                  <TableHead className="text-right">Počet kusov</TableHead>
                  <TableHead className="text-right">Cena/ks</TableHead>
                  <TableHead className="text-right">Poplatky</TableHead>
                  <TableHead className="text-right">Celkom</TableHead>
                  <TableHead className="text-right">Realiz. zisk</TableHead>
                  <TableHead className="text-right">Akcie</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTransactions.map((transaction) => {
                  const shares = parseFloat(transaction.shares);
                  const price = parseFloat(transaction.pricePerShare);
                  const commission = parseFloat(transaction.commission || "0");
                  const grossAmount = shares * price;
                  const total = transaction.type === "DIVIDEND" 
                    ? grossAmount - commission  // Net dividend (gross - tax)
                    : transaction.type === "BUY" 
                    ? grossAmount + commission 
                    : grossAmount - commission;
                  const isSelected = selectedIds.has(transaction.id);

                  return (
                    <TableRow 
                      key={transaction.id} 
                      data-testid={`row-transaction-${transaction.id}`}
                      className={isSelected ? "bg-muted/50" : ""}
                    >
                      <TableCell>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => handleSelectOne(transaction.id, checked as boolean)}
                          aria-label={`Označiť transakciu ${transaction.ticker}`}
                          data-testid={`checkbox-transaction-${transaction.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground" data-testid={`text-id-${transaction.id}`}>
                        {transaction.id.slice(0, 8)}...
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(transaction.transactionDate)}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={transaction.type === "SELL" ? "destructive" : "default"}
                          className={
                            transaction.type === "BUY" 
                              ? "bg-green-500/20 text-green-600 border-green-500/30" 
                              : transaction.type === "DIVIDEND"
                              ? "bg-blue-500/20 text-blue-600 border-blue-500/30"
                              : ""
                          }
                        >
                          {transaction.type === "BUY" ? "Nákup" : transaction.type === "SELL" ? "Predaj" : "Dividenda"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <CompanyLogo ticker={transaction.ticker} companyName={transaction.companyName} size="sm" />
                          <div className="flex flex-col">
                            <span className="font-medium">{transaction.ticker}</span>
                            <span className="text-xs text-muted-foreground">{transaction.companyName}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{shares.toFixed(4)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(price)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {commission > 0 ? formatCurrency(commission) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(total)}
                      </TableCell>
                      <TableCell className="text-right">
                        {transaction.type === "SELL" && transaction.realizedGain ? (
                          <span className={`font-medium ${parseFloat(transaction.realizedGain) >= 0 ? "text-green-500" : "text-red-500"}`}>
                            {parseFloat(transaction.realizedGain) >= 0 ? "+" : ""}
                            {formatCurrency(parseFloat(transaction.realizedGain))}
                          </span>
                        ) : transaction.type === "DIVIDEND" ? (
                          <span className="font-medium text-blue-500">
                            +{formatCurrency(total)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleEditClick(transaction)}
                            data-testid={`button-edit-transaction-${transaction.id}`}
                          >
                            <Pencil className="h-4 w-4 text-blue-500" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteMutation.mutate(transaction.id)}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-transaction-${transaction.id}`}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
              </div>
            </>
          )}

          {filteredTransactions && filteredTransactions.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground text-right">
              Zobrazených {filteredTransactions.length} z {transactions?.length || 0} transakcií
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upraviť transakciu</DialogTitle>
            <DialogDescription>
              Upravte údaje transakcie. Zmeny sa prejavia aj v portfóliu.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-type">Typ</Label>
                <Select 
                  value={editForm.type} 
                  onValueChange={(value) => setEditForm({ ...editForm, type: value })}
                >
                  <SelectTrigger id="edit-type" data-testid="select-edit-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUY">Nákup</SelectItem>
                    <SelectItem value="SELL">Predaj</SelectItem>
                    <SelectItem value="DIVIDEND">Dividenda</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="edit-ticker">Ticker</Label>
                <Input
                  id="edit-ticker"
                  value={editForm.ticker}
                  onChange={(e) => setEditForm({ ...editForm, ticker: e.target.value.toUpperCase() })}
                  placeholder="napr. VWCE.DE, MO, AAPL"
                  data-testid="input-edit-ticker"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-company">Názov spoločnosti</Label>
              <Input
                id="edit-company"
                value={editForm.companyName}
                onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })}
                placeholder="Názov spoločnosti"
                data-testid="input-edit-company"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-shares">
                  {editForm.type === "DIVIDEND" ? "Počet akcií" : "Počet kusov"}
                </Label>
                <Input
                  id="edit-shares"
                  type="number"
                  step="0.0001"
                  value={editForm.shares}
                  onChange={(e) => setEditForm({ ...editForm, shares: e.target.value })}
                  data-testid="input-edit-shares"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="edit-price">
                  {editForm.type === "DIVIDEND" ? "Dividenda/akciu" : "Cena za kus"}
                </Label>
                <Input
                  id="edit-price"
                  type="number"
                  step="0.01"
                  value={editForm.pricePerShare}
                  onChange={(e) => setEditForm({ ...editForm, pricePerShare: e.target.value })}
                  data-testid="input-edit-price"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-commission">
                  {editForm.type === "DIVIDEND" ? "Zrážková daň" : "Poplatky"}
                </Label>
                <Input
                  id="edit-commission"
                  type="number"
                  step="0.01"
                  value={editForm.commission}
                  onChange={(e) => setEditForm({ ...editForm, commission: e.target.value })}
                  data-testid="input-edit-commission"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="edit-date">Dátum</Label>
                <Input
                  id="edit-date"
                  type="datetime-local"
                  value={editForm.transactionDate}
                  onChange={(e) => setEditForm({ ...editForm, transactionDate: e.target.value })}
                  data-testid="input-edit-date"
                />
              </div>
            </div>

            <div className="p-3 rounded-lg bg-muted/50 text-sm">
              <p className="font-medium mb-1">Tipy pre správne tickery:</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>US akcie: MO, AAPL, MSFT (bez prípony)</li>
                <li>Frankfurt: VWCE.DE, IS3N.DE</li>
                <li>Amsterdam: IMAE.AS (nie .NL alebo .AMS)</li>
                <li>Paríž: UST.PA (nie .FR alebo .PAR)</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              data-testid="button-cancel-edit"
            >
              Zrušiť
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={updateMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Ukladám...
                </>
              ) : (
                "Uložiť zmeny"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Vymazať transakcie</DialogTitle>
            <DialogDescription>
              Naozaj chcete vymazať {selectedIds.size} označených transakcií? Táto akcia sa nedá vrátiť.
            </DialogDescription>
          </DialogHeader>
          
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              data-testid="button-cancel-bulk-delete"
            >
              Zrušiť
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
              data-testid="button-confirm-bulk-delete"
            >
              {bulkDeleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Mažem...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Vymazať ({selectedIds.size})
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
