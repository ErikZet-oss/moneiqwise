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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { usePortfolio } from "@/hooks/usePortfolio";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Check, ChevronsUpDown, Loader2, TrendingUp, TrendingDown, Coins, Briefcase } from "lucide-react";
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

type TransactionType = "BUY" | "SELL" | "DIVIDEND";

const transactionSchema = z.object({
  id: z.string().optional(), // Optional custom ID
  type: z.enum(["BUY", "SELL", "DIVIDEND"]),
  ticker: z.string().min(1, "Vyberte akciu"),
  companyName: z.string().min(1, "Názov spoločnosti je povinný"),
  shares: z.string().optional(),
  pricePerShare: z.string().min(1, "Zadajte cenu/sumu").refine((val) => parseFloat(val) > 0, "Suma musí byť väčšia ako 0"),
  commission: z.string().default("0"),
  transactionDate: z.string().min(1, "Vyberte dátum transakcie"),
}).refine((data) => {
  if (data.type !== "DIVIDEND") {
    return data.shares && data.shares.length > 0 && parseFloat(data.shares) > 0;
  }
  return true;
}, {
  message: "Zadajte počet kusov",
  path: ["shares"],
});

type TransactionForm = z.infer<typeof transactionSchema>;

export default function Transactions() {
  const { toast } = useToast();
  const { getQueryParam, selectedPortfolio, isAllPortfolios, portfolios } = usePortfolio();
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<StockQuote | null>(null);
  const [transactionType, setTransactionType] = useState<TransactionType>("BUY");
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>("");
  
  const debouncedSearch = useDebounce(inputValue, 300);
  const portfolioParam = getQueryParam();

  useEffect(() => {
    if (portfolios.length > 0 && !selectedPortfolioId) {
      if (selectedPortfolio && !isAllPortfolios) {
        setSelectedPortfolioId(selectedPortfolio.id);
      } else {
        const defaultPortfolio = portfolios.find(p => p.isDefault) || portfolios[0];
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
      const response = await apiRequest("POST", "/api/transactions", { ...data, portfolioId: selectedPortfolioId });
      return response;
    },
    onSuccess: () => {
      const messages: Record<TransactionType, string> = {
        BUY: "Nákup zaznamenaný",
        SELL: "Predaj zaznamenaný",
        DIVIDEND: "Dividenda zaznamenaná",
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
      form.reset({
        id: "",
        type: transactionType,
        ticker: "",
        companyName: "",
        shares: "",
        pricePerShare: "",
        commission: "0",
        transactionDate: new Date().toISOString().slice(0, 16),
      });
      setSelectedStock(null);
      setSelectedQuote(null);
      setInputValue("");
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
    } catch (error) {
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
  };

  const getDescription = () => {
    switch (transactionType) {
      case "BUY":
        return "Pridajte nákup akcie do svojho portfólia.";
      case "SELL":
        return "Zaznamenajte predaj akcie z portfólia.";
      case "DIVIDEND":
        return "Zaznamenajte prijatú dividendu.";
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
    }
  };

  const getTotalLabel = () => {
    if (transactionType === "DIVIDEND") {
      return "Čistá dividenda (po dani):";
    }
    return "Celková suma:";
  };

  const calculateTotal = () => {
    const shares = parseFloat(form.watch("shares") || "0");
    const price = parseFloat(form.watch("pricePerShare") || "0");
    const commission = parseFloat(form.watch("commission") || "0");
    
    if (transactionType === "DIVIDEND") {
      return shares * price - commission;
    }
    return shares * price + commission;
  };

  return (
    <div className="max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>Nová transakcia</CardTitle>
          <CardDescription>
            {getDescription()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="p-4 rounded-lg bg-muted">
                <Label className="text-base font-medium mb-3 block">
                  Typ transakcie
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    type="button"
                    variant={transactionType === "BUY" ? "default" : "outline"}
                    className={cn(
                      "flex items-center gap-2",
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
                </div>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4" />
                  Portfólio
                </Label>
                <Select 
                  value={selectedPortfolioId} 
                  onValueChange={setSelectedPortfolioId}
                >
                  <SelectTrigger data-testid="select-portfolio">
                    <SelectValue placeholder="Vyberte portfólio" />
                  </SelectTrigger>
                  <SelectContent>
                    {portfolios.map((portfolio) => (
                      <SelectItem 
                        key={portfolio.id} 
                        value={portfolio.id}
                        data-testid={`option-portfolio-${portfolio.id}`}
                      >
                        {portfolio.name}
                        {portfolio.isDefault && " (predvolené)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <FormField
                control={form.control}
                name="ticker"
                render={({ field }) => (
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
                            {selectedStock 
                              ? `${selectedStock.ticker} - ${selectedStock.name}`
                              : "Vyhľadajte akciu..."}
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
                                      <span className="text-xs text-muted-foreground">{stock.exchange} - {stock.currency}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            {!stocksLoading && (!stocks || stocks.length === 0) && inputValue.length >= 2 && (
                              <div className="p-2">
                                <div className="text-center text-sm text-muted-foreground mb-2">
                                  Akcia nenájdená v databáze.
                                </div>
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
                                  <span className="text-xs text-muted-foreground">
                                    Zadajte cenu a názov ručne
                                  </span>
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

              {selectedStock && selectedQuote && transactionType !== "DIVIDEND" && (
                <div className="p-4 rounded-lg bg-muted text-sm">
                  <div className="flex justify-between">
                    <span>Aktuálna cena:</span>
                    <span className="font-medium">{formatCurrency(selectedQuote.price)}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span>Denná zmena:</span>
                    <span className={selectedQuote.change >= 0 ? "text-green-500" : "text-red-500"}>
                      {selectedQuote.change >= 0 ? "+" : ""}{formatCurrency(selectedQuote.change)} 
                      ({selectedQuote.changePercent >= 0 ? "+" : ""}{selectedQuote.changePercent.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              )}

              {selectedStock && !selectedQuote && (
                <FormField
                  control={form.control}
                  name="companyName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Názov spoločnosti / ETF</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Zadajte názov..." 
                          {...field} 
                          data-testid="input-company-name"
                        />
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
                      <Input 
                        type="datetime-local" 
                        {...field} 
                        data-testid="input-transaction-date"
                      />
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
                      <Input 
                        placeholder="Nechajte prázdne pre automatické ID" 
                        {...field} 
                        data-testid="input-custom-id"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className={transactionType === "DIVIDEND" ? "" : "grid grid-cols-2 gap-4"}>
                {transactionType !== "DIVIDEND" && (
                  <FormField
                    control={form.control}
                    name="shares"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Počet kusov</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            step="0.0001"
                            placeholder="0.00" 
                            {...field} 
                            data-testid="input-shares"
                          />
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
                      <FormLabel>{transactionType === "DIVIDEND" ? "Celková suma dividendy (€)" : "Cena za akciu (€)"}</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          step="0.01"
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

              <FormField
                control={form.control}
                name="commission"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{transactionType === "DIVIDEND" ? "Zrážková daň (€)" : "Poplatky / Provízia (€)"}</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        step="0.01"
                        placeholder="0.00" 
                        {...field} 
                        data-testid="input-commission"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {((transactionType !== "DIVIDEND" && form.watch("shares") && form.watch("pricePerShare")) || 
                (transactionType === "DIVIDEND" && form.watch("pricePerShare"))) && (
                <div className="p-4 rounded-lg bg-muted">
                  <div className="flex justify-between text-sm">
                    <span>{transactionType === "DIVIDEND" ? "Čistá dividenda (po dani):" : getTotalLabel()}</span>
                    <span className={cn(
                      "font-medium",
                      transactionType === "DIVIDEND" && "text-blue-500"
                    )}>
                      {formatCurrency(transactionType === "DIVIDEND" 
                        ? parseFloat(form.watch("pricePerShare") || "0") - parseFloat(form.watch("commission") || "0")
                        : calculateTotal()
                      )}
                    </span>
                  </div>
                  {transactionType === "DIVIDEND" && parseFloat(form.watch("commission") || "0") > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                      <span>Hrubá dividenda:</span>
                      <span>
                        {formatCurrency(parseFloat(form.watch("pricePerShare") || "0"))}
                      </span>
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
                  transactionType === "DIVIDEND" && "bg-blue-600 hover:bg-blue-700"
                )}
                disabled={mutation.isPending}
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
    </div>
  );
}
