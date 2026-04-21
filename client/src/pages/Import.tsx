import { useState, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { sk } from "date-fns/locale";
import { 
  Upload, 
  FileUp, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Download,
  Info,
  FileSpreadsheet,
  ArrowRight,
  Wrench
} from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/hooks/useCurrency";
import type { Portfolio } from "@shared/schema";
import { formatShareQuantity } from "@/lib/utils";

interface ParsedTransaction {
  date: string;
  ticker: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND' | 'TAX';
  quantity: number;
  priceEur: number;
  totalAmountEur: number;
  originalComment?: string;
  externalId?: string;
}

interface ImportLogEntry {
  row: number;
  status: 'success' | 'warning' | 'error' | 'skipped';
  message: string;
  data?: ParsedTransaction;
  originalData?: Record<string, any>;
}

interface XTBImportResult {
  transactions: ParsedTransaction[];
  log: ImportLogEntry[];
  summary: {
    total: number;
    success: number;
    warnings: number;
    errors: number;
    skipped: number;
  };
}

interface SaveResult {
  imported: number;
  skippedDuplicates?: number;
  errors?: string[];
  message: string;
}

/** JSON { message }, alebo HTML od proxy (502…) — bez výpisu celého HTML do toastu. */
async function readHttpErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const j = JSON.parse(text) as { message?: string };
    if (typeof j?.message === "string" && j.message.trim()) {
      return j.message.trim();
    }
  } catch {
    /* not JSON */
  }

  const status = response.status;
  const start = text.trimStart();

  if (
    start.startsWith("<!DOCTYPE") ||
    start.startsWith("<html") ||
    start.startsWith("<HTML")
  ) {
    const titleMatch = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim();
    if (status === 502 || title === "502") {
      return "Server nedostupný (502 Bad Gateway). Proxy alebo hosting neprepojil aplikáciu — skús znova o minútu, obnov stránku alebo skontroluj či aplikácia na hostingu beží.";
    }
    if (status === 503) {
      return "Služba je dočasne nedostupná (503). Skús import znova neskôr.";
    }
    if (status === 504) {
      return "Časový limit servera (504). Veľký import môže trvať dlho — skús znova alebo menší súbor.";
    }
    if (title && /^\d{3}$/.test(title)) {
      return `Server vrátil chybu (${title}). Skús znova alebo kontaktuj hosting.`;
    }
    return `Server vrátil HTML namiesto odpovede aplikácie (HTTP ${status}). Ak problém pretrváva, pozri log na hostingu.`;
  }

  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
  if (snippet) {
    return snippet;
  }
  return `HTTP ${status} ${response.statusText || ""}`.trim();
}

export default function Import() {
  const { toast } = useToast();
  const { formatCurrency } = useCurrency();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedPortfolio, setSelectedPortfolio] = useState<string>("default");
  const [parseResult, setParseResult] = useState<XTBImportResult | null>(null);
  const [activeTab, setActiveTab] = useState<string>("transactions");
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [migrateTarget, setMigrateTarget] = useState<string>("default");

  const { data: portfolios } = useQuery<Portfolio[]>({
    queryKey: ["/api/portfolios"],
  });

  const migrateMutation = useMutation({
    mutationFn: async () => {
      const body =
        migrateTarget === "default"
          ? {}
          : { targetPortfolioId: migrateTarget };
      const response = await fetch("/api/portfolios/migrate-unassigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(await readHttpErrorMessage(response));
      }
      return response.json() as Promise<{
        targetPortfolioId: string;
        transactionsMoved: number;
        holdingsMoved: number;
        holdingsMerged: number;
        optionTradesMoved: number;
      }>;
    },
    onSuccess: (data) => {
      const total =
        (data.transactionsMoved || 0) +
        (data.holdingsMoved || 0) +
        (data.holdingsMerged || 0) +
        (data.optionTradesMoved || 0);
      toast({
        title: "Presun dokončený",
        description:
          total === 0
            ? "Žiadne nezaradené transakcie sa nenašli."
            : `Presunuté: ${data.transactionsMoved} transakcií, ${data.holdingsMoved} nových holdingov, ${data.holdingsMerged} zlúčených, ${data.optionTradesMoved} opcií.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dividends"] });
      queryClient.invalidateQueries({ queryKey: ["/api/realized-gains"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Chyba",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const parseMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/import/xtb/parse', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error(await readHttpErrorMessage(response));
      }
      
      return response.json() as Promise<XTBImportResult>;
    },
    onSuccess: (data) => {
      setParseResult(data);
      setActiveTab("transactions");
      toast({
        title: "Súbor spracovaný",
        description: `Nájdených ${data.summary.success} transakcií, ${data.summary.errors} chýb, ${data.summary.skipped} preskočených.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Chyba spracovania",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (transactions: ParsedTransaction[]) => {
      const response = await fetch('/api/import/xtb/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          transactions,
          portfolioId: selectedPortfolio === 'default' ? null : selectedPortfolio,
        }),
      });
      
      if (!response.ok) {
        throw new Error(await readHttpErrorMessage(response));
      }
      
      return response.json() as Promise<SaveResult>;
    },
    onSuccess: (data) => {
      const warn =
        data.errors?.length ?
          ` ${data.errors.slice(0, 2).join(" · ")}${data.errors.length > 2 ? "…" : ""}`
          : "";
      toast({
        title: "Import dokončený",
        description: `${data.message}${warn}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dividends"] });
      setParseResult(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Chyba uloženia",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsParsing(true);
    try {
      await parseMutation.mutateAsync(file);
    } finally {
      setIsParsing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSave = async () => {
    if (!parseResult?.transactions.length) return;
    
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync(parseResult.transactions);
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'skipped':
        return <Info className="h-4 w-4 text-muted-foreground" />;
      default:
        return null;
    }
  };

  const getTypeBadgeVariant = (type: string) => {
    switch (type) {
      case 'BUY':
        return 'default';
      case 'SELL':
        return 'secondary';
      case 'DIVIDEND':
        return 'outline';
      case 'TAX':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'BUY':
        return 'Nákup';
      case 'SELL':
        return 'Predaj';
      case 'DIVIDEND':
        return 'Dividenda';
      case 'TAX':
        return 'Daň';
      default:
        return type;
    }
  };

  return (
    <div className="container mx-auto py-6 px-4 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Import z XTB</h1>
        <p className="text-muted-foreground">
          Nahrajte súbor exportu z XTB brokera (CSV alebo XLSX) pre automatický import transakcií.
        </p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Nahrať súbor
            </CardTitle>
            <CardDescription>
              Podporované formáty: CSV, XLSX, XLS. Maximálna veľkosť: 10 MB.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium mb-2 block">Portfólio pre import</label>
                  <Select value={selectedPortfolio} onValueChange={setSelectedPortfolio}>
                    <SelectTrigger data-testid="select-portfolio">
                      <SelectValue placeholder="Vyberte portfólio" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Predvolené portfólio</SelectItem>
                      {portfolios?.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    data-testid="input-file-upload"
                  />
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isParsing}
                    data-testid="button-upload-file"
                  >
                    {isParsing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Spracovávam...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Nahrať súbor
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Formát XTB exportu</AlertTitle>
                <AlertDescription>
                  Súbor by mal obsahovať stĺpce: Time, Type, Symbol, Amount, Comment.
                  Parser automaticky detekuje hlavičku a oddeľovač (čiarka alebo bodkočiarka).
                </AlertDescription>
              </Alert>
            </div>
          </CardContent>
        </Card>

        {parseResult && (
          <>
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <CardTitle>Výsledok spracovania</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="default" className="bg-green-500">
                      {parseResult.summary.success} úspešných
                    </Badge>
                    {parseResult.summary.warnings > 0 && (
                      <Badge variant="secondary" className="bg-yellow-500 text-black">
                        {parseResult.summary.warnings} varovanie
                      </Badge>
                    )}
                    {parseResult.summary.errors > 0 && (
                      <Badge variant="destructive">
                        {parseResult.summary.errors} chýb
                      </Badge>
                    )}
                    <Badge variant="outline">
                      {parseResult.summary.skipped} preskočených
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="transactions" data-testid="tab-transactions">
                      Transakcie ({parseResult.transactions.length})
                    </TabsTrigger>
                    <TabsTrigger value="log" data-testid="tab-log">
                      Log ({parseResult.log.length})
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="transactions">
                    <ScrollArea className="h-[400px] rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>XTB ID</TableHead>
                            <TableHead>Dátum</TableHead>
                            <TableHead>Ticker</TableHead>
                            <TableHead>Typ</TableHead>
                            <TableHead className="text-right">Množstvo</TableHead>
                            <TableHead className="text-right">Cena (EUR)</TableHead>
                            <TableHead className="text-right">Suma (EUR)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parseResult.transactions.map((tx, index) => (
                            <TableRow key={index} data-testid={`row-transaction-${index}`} className={tx.type === 'TAX' ? 'bg-red-500/5' : ''}>
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {tx.externalId || '-'}
                              </TableCell>
                              <TableCell>
                                {format(new Date(tx.date), "d.M.yyyy", { locale: sk })}
                              </TableCell>
                              <TableCell className="font-medium">{tx.ticker}</TableCell>
                              <TableCell>
                                <Badge variant={getTypeBadgeVariant(tx.type)}>
                                  {getTypeLabel(tx.type)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {tx.quantity > 0 ? formatShareQuantity(tx.quantity) : '-'}
                              </TableCell>
                              <TableCell className="text-right">
                                {tx.priceEur > 0 ? formatCurrency(tx.priceEur) : '-'}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCurrency(tx.totalAmountEur)}
                              </TableCell>
                            </TableRow>
                          ))}
                          {parseResult.transactions.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                                Žiadne transakcie na import
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="log">
                    <ScrollArea className="h-[400px] rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12">Riadok</TableHead>
                            <TableHead className="w-12">Stav</TableHead>
                            <TableHead>Správa</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parseResult.log.map((entry, index) => (
                            <TableRow 
                              key={index} 
                              className={
                                entry.status === 'error' ? 'bg-red-500/10' :
                                entry.status === 'warning' ? 'bg-yellow-500/10' :
                                entry.status === 'skipped' ? 'bg-muted/50' : ''
                              }
                              data-testid={`row-log-${index}`}
                            >
                              <TableCell className="font-mono text-sm">
                                {entry.row}
                              </TableCell>
                              <TableCell>
                                {getStatusIcon(entry.status)}
                              </TableCell>
                              <TableCell className="text-sm">
                                {entry.message}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>

                <div className="flex justify-end gap-2 mt-4">
                  <Button
                    variant="outline"
                    onClick={() => setParseResult(null)}
                    data-testid="button-cancel-import"
                  >
                    Zrušiť
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={isSaving || parseResult.transactions.length === 0}
                    data-testid="button-save-import"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Ukladám...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-2" />
                        Uložiť {parseResult.transactions.length} transakcií
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Podporované typy transakcií</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <Badge variant="default">Nákup</Badge>
                <div className="text-sm text-muted-foreground">
                  Stocks/ETF purchase - automaticky extrahuje množstvo z komentára a vypočíta cenu v EUR
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="secondary">Predaj</Badge>
                <div className="text-sm text-muted-foreground">
                  Stocks/ETF sale - rovnaká logika ako nákup
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="outline">Dividenda</Badge>
                <div className="text-sm text-muted-foreground">
                  Dividend - automaticky extrahuje ticker z komentára ak chýba
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Badge variant="destructive">Daň</Badge>
                <div className="text-sm text-muted-foreground">
                  Withholding tax - zrážková daň z dividend
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Opraviť nezaradené transakcie
            </CardTitle>
            <CardDescription>
              Ak ti predchádzajúci import uložil dáta tak, že sa zobrazujú len
              pod "Všetky portfóliá" a nie v konkrétnom portfóliu, tu ich môžeš
              presunúť. Presunie všetky transakcie, holdingy a opcie s
              nenastaveným portfóliom do vybraného cieľa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium mb-2 block">
                  Cieľové portfólio
                </label>
                <Select value={migrateTarget} onValueChange={setMigrateTarget}>
                  <SelectTrigger data-testid="select-migrate-target">
                    <SelectValue placeholder="Vyberte portfólio" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Predvolené portfólio</SelectItem>
                    {portfolios?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={() => migrateMutation.mutate()}
                  disabled={migrateMutation.isPending}
                  data-testid="button-migrate-unassigned"
                >
                  {migrateMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Presúvam...
                    </>
                  ) : (
                    <>
                      <Wrench className="h-4 w-4 mr-2" />
                      Presunúť nezaradené
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
