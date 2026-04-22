import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { usePortfolio } from "@/hooks/usePortfolio";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Check, ChevronsUpDown, Loader2, TrendingUp, TrendingDown, Coins, Briefcase, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { CASH_FLOW_TICKER } from "@shared/schema";
import { cn } from "@/lib/utils";

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

interface Stock {
  ticker: string;
  name: string;
  exchange?: string;
  currency?: string;
}

interface StockQuote {
  ticker: string;
  price: number;
  change: number;
  changePercent: number;
  high52: number;
  low52: number;
}

type TransactionType = "BUY" | "SELL" | "DIVIDEND" | "DEPOSIT" | "WITHDRAWAL";

const transactionSchema = z
  .object({
    id: z.string().optional(),
    type: z.enum(["BUY", "SELL", "DIVIDEND", "DEPOSIT", "WITHDRAWAL"]),
    ticker: z.string().optional().default(""),
    companyName: z.string().optional().default(""),
    shares: z.string().optional(),
    pricePerShare: z.string().min(1, "Zadajte cenu/sumu"),
    commission: z.string().default("0"),
    transactionDate: z.string().min(1, "Vyberte dátum transakcie"),
    cashNote: z.string().optional().default(""),
    cashCurrency: z.string().default("EUR"),
    externalRefId: z.string().optional().default(""),
  })
  .refine(
    (data) => {
      if (data.type === "DEPOSIT" || data.type === "WITHDRAWAL") {
        return parseFloat((data.pricePerShare || "0").replace(",", ".")) > 0;
      }
      if (data.type === "BUY" || data.type === "SELL" || data.type === "DIVIDEND") {
        return parseFloat((data.pricePerShare || "0").replace(",", ".")) > 0;
      }
      return true;
    },
    { message: "Hodnota musí byť väčšia ako 0", path: ["pricePerShare"] },
  )
  .refine(
    (data) => {
      if (data.type === "BUY" || data.type === "SELL" || data.type === "DIVIDEND") {
        if (!data.ticker?.trim()) return false;
        if (!data.companyName?.trim()) return false;
        return true;
      }
      return true;
    },
    { message: "Vyberte spoločnosť", path: ["ticker"] },
  )
  .refine(
    (data) => {
      if (data.type === "BUY" || data.type === "SELL") {
        return data.shares && data.shares.length > 0 && parseFloat((data.shares || "0").replace(",", ".")) > 0;
      }
      return true;
    },
    { message: "Zadajte počet kusov", path: ["shares"] },
  )
  .refine(
    (data) => {
      if (data.type === "DIVIDEND" && !data.shares) return false;
      if (data.type === "DIVIDEND" && data.shares) {
        return parseFloat((data.shares || "0").replace(",", ".")) > 0;
      }
      return true;
    },
    { message: "Zadajte počet akcií (pre výpočet pomeru)", path: ["shares"] },
  );

type TransactionForm = z.infer<typeof transactionSchema>;

export type AddTransactionFormProps = {
  /** Volané po úspešnom uložení (napr. zatvorenie dialógu v Histórii). */
  onSuccessSubmit?: () => void;
  /** Bez vonkajšieho max-w wrappera (napr. v dialógu). */
  embed?: boolean;
};

export function AddTransactionForm({ onSuccessSubmit, embed }: AddTransactionFormProps) {
  const { toast } = useToast();
  const { selectedPortfolio, isAllPortfolios, portfolios } = usePortfolio();
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<StockQuote | null>(null);
  const [transactionType, setTransactionType] = useState<TransactionType>("BUY");
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>("");

  const debouncedSearch = useDebounce(inputValue, 300);

  useEffect(() => {
    if (portfolios.length > 0 && !selectedPortfolioId) {
      if (selectedPortfolio && !isAllPortfolios) {
        setSelectedPortfolioId(selectedPortfolio.id);
      } else {
        const defaultPortfolio = portfolios.find((p) => p.isDefault) || portfolios[0];
        setSelectedPortfolioId(defaultPortfolio.id);
      }
    }
  }, [portfolios, selectedPortfolio, isAllPortfolios, selectedPortfolioId]);

  const form = useForm<TransactionForm>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      id: "",
      type: "BUY",
      ticker: "",
      companyName: "",
      shares: "",
      pricePerShare: "",
      commission: "0",
      transactionDate: new Date().toISOString().slice(0, 16),
      cashNote: "",
      cashCurrency: "EUR",
      externalRefId: "",
    },
  });

  const { data: stocks, isLoading: stocksLoading } = useQuery<Stock[]>({
    queryKey: ["/api/stocks/search", debouncedSearch],
    queryFn: async () => {
      const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(debouncedSearch)}`);
      if (!res.ok) throw new Error("Failed to search stocks");
      return res.json();
    },
    enabled: debouncedSearch.length >= 1,
  });

  const mutation = useMutation({
    mutationFn: async (data: TransactionForm) => {
      if (data.type === "DEPOSIT" || data.type === "WITHDRAWAL") {
        const raw = (data.pricePerShare || "0").replace(",", ".");
        const amt = parseFloat(raw);
        const ccy = (data.cashCurrency || "EUR").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "EUR";
        const label =
          (data.cashNote || data.companyName || "").trim() ||
          (data.type === "DEPOSIT" ? "Vklad" : "Výber");
        const signed = data.type === "WITHDRAWAL" ? -Math.abs(amt) : Math.abs(amt);
        const body: Record<string, unknown> = {
          type: data.type,
          ticker: CASH_FLOW_TICKER,
          companyName: label,
          shares: "1",
          pricePerShare: Math.abs(amt).toString(),
          commission: "0",
          transactionDate: data.transactionDate,
          portfolioId: selectedPortfolioId,
          originalCurrency: ccy,
          exchangeRateAtTransaction: ccy === "EUR" ? 1 : 1,
          baseCurrencyAmount: signed.toFixed(4),
        };
        if (data.id?.trim()) body.id = data.id.trim();
        if (data.externalRefId?.trim()) body.transactionId = data.externalRefId.trim();
        return await apiRequest("POST", "/api/transactions", body);
      }
      return await apiRequest("POST", "/api/transactions", { ...data, portfolioId: selectedPortfolioId });
    },
    onSuccess: () => {
      const messages: Record<TransactionType, string> = {
        BUY: "Nákup zaznamenaný",
        SELL: "Predaj zaznamenaný",
        DIVIDEND: "Dividenda zaznamenaná",
        DEPOSIT: "Vklad zaznamenaný",
        WITHDRAWAL: "Výber zaznamenaný",
      };
      toast({
        title: messages[transactionType],
        description: `Transakcia bola úspešne uložená.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dividends"] });
      queryClient.invalidateQueries({ queryKey: ["/api/realized-gains"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pnl-breakdown"] });
      queryClient.invalidateQueries({ queryKey: ["/api/twr"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio-performance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolios"] });
      form.reset({
        id: "",
        type: transactionType,
        ticker: "",
        companyName: "",
        shares: "",
        pricePerShare: "",
        commission: "0",
        transactionDate: new Date().toISOString().slice(0, 16),
        cashNote: "",
        cashCurrency: "EUR",
        externalRefId: "",
      });
      setSelectedStock(null);
      setSelectedQuote(null);
      setInputValue("");
      onSuccessSubmit?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Chyba",
        description: error.message || "Nepodarilo sa uložiť transakciu.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    form.setValue("type", transactionType);
  }, [transactionType, form]);

  const handleStockSelect = async (stock: Stock) => {
    try {
      setLoadingPrice(true);
      setSelectedStock(stock);
      form.setValue("ticker", stock.ticker);
      form.setValue("companyName", stock.name);

      if (transactionType !== "DIVIDEND") {
        const res = await fetch(`/api/stocks/quote/${stock.ticker}`);
        if (!res.ok) throw new Error("Failed to fetch price");
        const quote: StockQuote = await res.json();

        setSelectedQuote(quote);
        form.setValue("pricePerShare", quote.price.toFixed(2));
      }
      setOpen(false);
    } catch {
      toast({
        title: "Chyba",
        description: "Nepodarilo sa načítať cenu akcie.",
        variant: "destructive",
      });
      if (transactionType !== "DIVIDEND") {
        setSelectedStock(null);
        setSelectedQuote(null);
      }
    } finally {
      setLoadingPrice(false);
    }
  };

  const onSubmit = (data: TransactionForm) => {
    mutation.mutate(data);
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("sk-SK", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
    }).format(value);
  };

  const handleTypeChange = (type: TransactionType) => {
    setTransactionType(type);
    form.setValue("type", type);
    if (type === "DIVIDEND") {
      setSelectedQuote(null);
      form.setValue("pricePerShare", "");
    }
    if (type === "DEPOSIT" || type === "WITHDRAWAL") {
      setSelectedStock(null);
      setSelectedQuote(null);
      setInputValue("");
      form.setValue("ticker", CASH_FLOW_TICKER);
      form.setValue("companyName", type === "DEPOSIT" ? "Vklad" : "Výber");
      form.setValue("shares", "1");
      form.setValue("commission", "0");
      form.setValue("pricePerShare", "");
    } else {
      if (form.getValues("ticker") === CASH_FLOW_TICKER) {
        form.setValue("ticker", "");
        form.setValue("companyName", "");
        form.setValue("shares", "");
      }
    }
  };

  const getDescription = () => {
    switch (transactionType) {
      case "BUY":
        return "Pridajte nákup akcie do svojho portfólia.";
      case "SELL":
        return "Zaznamenajte predaj akcie z portfólia.";
      case "DIVIDEND":
        return "Zaznamenajte prijatú dividendu.";
      case "DEPOSIT":
        return "Vloženie peňazí na obchodný účet (neprepája sa s konkrétnou akciou).";
      case "WITHDRAWAL":
        return "Výber peňazí z obchodného účtu.";
    }
  };

  const getSubmitButtonText = () => {
    if (mutation.isPending) return "Ukladám...";
    switch (transactionType) {
      case "BUY":
        return "Zaznamenať nákup";
      case "SELL":
        return "Zaznamenať predaj";
      case "DIVIDEND":
        return "Zaznamenať dividendu";
      case "DEPOSIT":
        return "Zaznamenať vklad";
      case "WITHDRAWAL":
        return "Zaznamenať výber";
    }
  };

  const getTotalLabel = () => {
    if (transactionType === "DIVIDEND") {
      return "Čistá dividenda (po dani):";
    }
    if (transactionType === "DEPOSIT" || transactionType === "WITHDRAWAL") {
      return transactionType === "DEPOSIT" ? "Vklad:" : "Výber:";
    }
    return "Celková suma:";
  };

  const calculateTotal = () => {
    const shares = parseFloat(form.watch("shares") || "0");
    const price = parseFloat(form.watch("pricePerShare") || "0");
    const commission = parseFloat(form.watch("commission") || "0");

    if (transactionType === "DEPOSIT" || transactionType === "WITHDRAWAL") {
      const p = Math.abs(parseFloat((form.watch("pricePerShare") || "0").toString().replace(",", ".")) || 0);
      return transactionType === "WITHDRAWAL" ? -p : p;
    }
    if (transactionType === "DIVIDEND") {
      return shares * price - commission;
    }
    return shares * price + commission;
  };

  const isCashFlow = transactionType === "DEPOSIT" || transactionType === "WITHDRAWAL";

  const inner = (
    <Card className={embed ? "border-0 shadow-none" : undefined}>
      <CardHeader>
        <CardTitle>Nová transakcia</CardTitle>
        <CardDescription>{getDescription()}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="p-4 rounded-lg bg-muted">
              <Label className="text-base font-medium mb-3 block">Typ transakcie</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={transactionType === "BUY" ? "default" : "outline"}
                  className={cn(
                    "flex items-center gap-2 min-w-0",
                    transactionType === "BUY" && "bg-green-600 hover:bg-green-700"
                  )}
                  onClick={() => handleTypeChange("BUY")}
                  data-testid="button-type-buy"
                >
                  <TrendingUp className="h-4 w-4" />
                  Nákup
                </Button>
                <Button
                  type="button"
                  variant={transactionType === "SELL" ? "default" : "outline"}
                  className={cn(
                    "flex items-center gap-2",
                    transactionType === "SELL" && "bg-red-600 hover:bg-red-700"
                  )}
                  onClick={() => handleTypeChange("SELL")}
                  data-testid="button-type-sell"
                >
                  <TrendingDown className="h-4 w-4" />
                  Predaj
                </Button>
                <Button
                  type="button"
                  variant={transactionType === "DIVIDEND" ? "default" : "outline"}
                  className={cn(
                    "flex items-center gap-2",
                    transactionType === "DIVIDEND" && "bg-blue-600 hover:bg-blue-700"
                  )}
                  onClick={() => handleTypeChange("DIVIDEND")}
                  data-testid="button-type-dividend"
                >
                  <Coins className="h-4 w-4" />
                  Dividenda
                </Button>
                <Button
                  type="button"
                  variant={transactionType === "DEPOSIT" ? "default" : "outline"}
                  className={cn(
                    "flex items-center gap-2",
                    transactionType === "DEPOSIT" && "bg-emerald-700 hover:bg-emerald-800"
                  )}
                  onClick={() => handleTypeChange("DEPOSIT")}
                  data-testid="button-type-deposit"
                >
                  <ArrowDownToLine className="h-4 w-4" />
                  Vklad
                </Button>
                <Button
                  type="button"
                  variant={transactionType === "WITHDRAWAL" ? "default" : "outline"}
                  className={cn(
                    "flex items-center gap-2",
                    transactionType === "WITHDRAWAL" && "bg-amber-700 hover:bg-amber-800"
                  )}
                  onClick={() => handleTypeChange("WITHDRAWAL")}
                  data-testid="button-type-withdrawal"
                >
                  <ArrowUpFromLine className="h-4 w-4" />
                  Výber
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Briefcase className="h-4 w-4" />
                Portfólio
              </Label>
              <Select value={selectedPortfolioId} onValueChange={setSelectedPortfolioId}>
                <SelectTrigger data-testid="select-portfolio">
                  <SelectValue placeholder="Vyberte portfólio" />
                </SelectTrigger>
                <SelectContent>
                  {portfolios.map((portfolio) => (
                    <SelectItem key={portfolio.id} value={portfolio.id} data-testid={`option-portfolio-${portfolio.id}`}>
                      {portfolio.name}
                      {portfolio.isDefault && " (predvolené)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isCashFlow && (
              <div className="space-y-4 p-4 rounded-lg border border-dashed bg-muted/40">
                <p className="text-sm text-muted-foreground">
                  Suma v uvádzacej mene. Pri výbere zadajte kladné číslo — výber sa v účtovníctve ukladá so zápornou hodnotou.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="cashCurrency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Menový kód (ISO)</FormLabel>
                        <FormControl>
                          <Input placeholder="EUR" maxLength={3} className="uppercase" {...field} data-testid="input-cash-currency" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="externalRefId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>ID od brokera (voliteľné)</FormLabel>
                        <FormControl>
                          <Input placeholder="napr. z výpisu XTB" {...field} data-testid="input-cash-external-id" />
                        </FormControl>
                        <FormDescription>
                          V jednom portfóliu musí byť toto ID vždy iné. Ak vklad dopĺňaš ručne a to isté ID už
                          príde z importu, pole radšej nechaj prázdne — inak ukladanie zlyhá na duplicite.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="cashNote"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Poznámka / pomenovanie</FormLabel>
                      <FormControl>
                        <Input placeholder="napr. SEPA vklad, PayPal, výber do banky…" {...field} data-testid="input-cash-note" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            {!isCashFlow && (
            <FormField
              control={form.control}
              name="ticker"
              render={() => (
                <FormItem className="flex flex-col">
                  <FormLabel>Akcia / ETF</FormLabel>
                  <Popover open={open} onOpenChange={setOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={open}
                          className="w-full justify-between"
                          data-testid="button-stock-select"
                        >
                          {selectedStock ? `${selectedStock.ticker} - ${selectedStock.name}` : "Vyhľadajte akciu..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[400px] p-0">
                      <div className="flex flex-col">
                        <div className="flex items-center border-b px-3">
                          <Input
                            placeholder="Zadajte ticker alebo názov..."
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            className="border-0 focus-visible:ring-0 h-11"
                            data-testid="input-stock-search"
                            autoFocus
                          />
                        </div>
                        <ScrollArea className="max-h-[300px]">
                          {stocksLoading && (
                            <div className="p-4 text-center">
                              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                            </div>
                          )}
                          {!stocksLoading && stocks && stocks.length > 0 && (
                            <div className="p-1">
                              {stocks.map((stock) => (
                                <div
                                  key={stock.ticker}
                                  onClick={() => handleStockSelect(stock)}
                                  className="flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground"
                                  data-testid={`option-stock-${stock.ticker}`}
                                >
                                  <Check
                                    className={cn(
                                      "h-4 w-4",
                                      selectedStock?.ticker === stock.ticker ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  <div className="flex flex-col flex-1">
                                    <span className="font-medium">{stock.ticker}</span>
                                    <span className="text-xs text-muted-foreground">{stock.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {stock.exchange} - {stock.currency}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {!stocksLoading && (!stocks || stocks.length === 0) && inputValue.length >= 2 && (
                            <div className="p-2">
                              <div className="text-center text-sm text-muted-foreground mb-2">Akcia nenájdená v databáze.</div>
                              <div
                                onClick={() => {
                                  const manualStock: Stock = {
                                    ticker: inputValue.toUpperCase(),
                                    name: inputValue.toUpperCase(),
                                    exchange: "Manuálne zadané",
                                    currency: "EUR",
                                  };
                                  setSelectedStock(manualStock);
                                  form.setValue("ticker", manualStock.ticker);
                                  form.setValue("companyName", manualStock.name);
                                  setSelectedQuote(null);
                                  setOpen(false);
                                }}
                                className="flex flex-col items-center p-2 rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground border-t"
                                data-testid="option-stock-manual"
                              >
                                <span className="font-medium">Pridať manuálne: {inputValue.toUpperCase()}</span>
                                <span className="text-xs text-muted-foreground">Zadajte cenu a názov ručne</span>
                              </div>
                            </div>
                          )}
                          {!stocksLoading && inputValue.length < 2 && (
                            <div className="p-4 text-center text-sm text-muted-foreground">
                              Zadajte aspoň 2 znaky pre vyhľadávanie
                            </div>
                          )}
                        </ScrollArea>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
            )}

            {selectedStock && selectedQuote && transactionType !== "DIVIDEND" && !isCashFlow && (
              <div className="p-4 rounded-lg bg-muted text-sm">
                <div className="flex justify-between">
                  <span>Aktuálna cena:</span>
                  <span className="font-medium">{formatCurrency(selectedQuote.price)}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span>Denná zmena:</span>
                  <span className={selectedQuote.change >= 0 ? "text-green-500" : "text-red-500"}>
                    {selectedQuote.change >= 0 ? "+" : ""}
                    {formatCurrency(selectedQuote.change)} ({selectedQuote.changePercent >= 0 ? "+" : ""}
                    {selectedQuote.changePercent.toFixed(2)}%)
                  </span>
                </div>
              </div>
            )}

            {selectedStock && !selectedQuote && !isCashFlow && (
              <FormField
                control={form.control}
                name="companyName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Názov spoločnosti / ETF</FormLabel>
                    <FormControl>
                      <Input placeholder="Zadajte názov..." {...field} data-testid="input-company-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="transactionDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dátum a čas</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} data-testid="input-transaction-date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vlastné ID (voliteľné)</FormLabel>
                  <FormControl>
                    <Input placeholder="Nechajte prázdne pre automatické ID" {...field} data-testid="input-custom-id" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div
              className={
                isCashFlow
                  ? "grid grid-cols-1 gap-4"
                  : transactionType === "DIVIDEND"
                    ? ""
                    : "grid grid-cols-2 gap-4"
              }
            >
              {transactionType !== "DIVIDEND" && !isCashFlow && (
                <FormField
                  control={form.control}
                  name="shares"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Počet kusov</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.0001" placeholder="0.00" {...field} data-testid="input-shares" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="pricePerShare"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {isCashFlow
                        ? `Suma (kladne číslo) — ${(form.watch("cashCurrency") || "EUR").toUpperCase().slice(0, 3) || "EUR"}`
                        : transactionType === "DIVIDEND"
                          ? "Celková suma dividendy (€)"
                          : "Cena za akciu (€)"}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min={isCashFlow ? 0.01 : undefined}
                        placeholder="0.00"
                        {...field}
                        data-testid="input-price"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {!isCashFlow && (
            <FormField
              control={form.control}
              name="commission"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{transactionType === "DIVIDEND" ? "Zrážková daň (€)" : "Poplatky / Provízia (€)"}</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" placeholder="0.00" {...field} data-testid="input-commission" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            )}

            {((isCashFlow && form.watch("pricePerShare")) ||
              (transactionType !== "DIVIDEND" && !isCashFlow && form.watch("shares") && form.watch("pricePerShare")) ||
              (transactionType === "DIVIDEND" && form.watch("pricePerShare"))) && (
              <div className="p-4 rounded-lg bg-muted">
                <div className="flex justify-between text-sm">
                  <span>{transactionType === "DIVIDEND" ? "Čistá dividenda (po dani):" : getTotalLabel()}</span>
                  <span
                    className={cn(
                      "font-medium",
                      transactionType === "DIVIDEND" && "text-blue-500",
                      isCashFlow && transactionType === "WITHDRAWAL" && "text-amber-700"
                    )}
                  >
                    {formatCurrency(
                      transactionType === "DIVIDEND"
                        ? parseFloat(form.watch("pricePerShare") || "0") - parseFloat(form.watch("commission") || "0")
                        : calculateTotal()
                    )}
                  </span>
                </div>
                {transactionType === "DIVIDEND" && parseFloat(form.watch("commission") || "0") > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>Hrubá dividenda:</span>
                    <span>{formatCurrency(parseFloat(form.watch("pricePerShare") || "0"))}</span>
                  </div>
                )}
              </div>
            )}

            <Button
              type="submit"
              className={cn(
                "w-full",
                transactionType === "BUY" && "bg-green-600 hover:bg-green-700",
                transactionType === "SELL" && "bg-red-600 hover:bg-red-700",
                transactionType === "DIVIDEND" && "bg-blue-600 hover:bg-blue-700",
                transactionType === "DEPOSIT" && "bg-emerald-700 hover:bg-emerald-800",
                transactionType === "WITHDRAWAL" && "bg-amber-700 hover:bg-amber-800"
              )}
              disabled={mutation.isPending || loadingPrice}
              data-testid="button-submit-transaction"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Ukladám...
                </>
              ) : (
                getSubmitButtonText()
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );

  if (embed) {
    return inner;
  }

  return <div className="max-w-2xl mx-auto">{inner}</div>;
}
