import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, Chip, Select, TopBar, type BadgeTone } from "@/redesign/ui";
import { KvRow, PageBody, signedMoney } from "./mobileChrome";

type Broker = "xtb" | "etoro";

const IMPORT_BROKER_KEY = "moneiqwise.import.broker";

function readImportBroker(): Broker {
  if (typeof window === "undefined") return "xtb";
  return window.localStorage.getItem(IMPORT_BROKER_KEY) === "etoro" ? "etoro" : "xtb";
}

async function readHttpErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const j = JSON.parse(text) as { message?: string };
    if (typeof j?.message === "string" && j.message.trim()) return j.message.trim();
  } catch {
    /* not JSON */
  }
  const start = text.trimStart();
  if (start.startsWith("<!DOCTYPE") || start.startsWith("<html") || start.startsWith("<HTML")) {
    if (response.status === 502) {
      return "Server nedostupný (502). Skús znova o chvíľu.";
    }
    return `Server vrátil HTML namiesto odpovede (HTTP ${response.status}).`;
  }
  const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
  return snippet || `HTTP ${response.status}`;
}

const XTB_TYPES: { label: string; detail: string; tone: BadgeTone }[] = [
  { label: "Nákup", detail: "Množstvo z komentára, cena v EUR", tone: "Info" },
  { label: "Predaj", detail: "Rovnaká logika ako nákup", tone: "Neutral" },
  { label: "Dividenda", detail: "Ticker z komentára, ak chýba", tone: "Profit" },
  { label: "Daň", detail: "Zrážková daň z dividend", tone: "Loss" },
];

const ETORO_TYPES: { label: string; detail: string; tone: BadgeTone }[] = [
  { label: "Nákup", detail: "Otvorenie pozície z Account Activity", tone: "Info" },
  { label: "Predaj", detail: "Zatvorenie pozície / čiastočný predaj", tone: "Neutral" },
  { label: "Dividenda", detail: "Hárok Dividends", tone: "Profit" },
  { label: "Vklad", detail: "Deposit / withdrawal z Account Activity", tone: "Warning" },
];

export default function ImportMobile() {
  const { toast } = useToast();
  const { formatCurrency } = useCurrency();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [broker, setBroker] = useState<Broker>(() => readImportBroker());
  const [portfolioId, setPortfolioId] = useState("default");
  const [migrateTarget, setMigrateTarget] = useState("default");
  const [recalcTarget, setRecalcTarget] = useState("default");
  const [cashScope, setCashScope] = useState("all");
  const [fileName, setFileName] = useState<string | null>(null);

  const { data: portfolios = [] } = useQuery({
    queryKey: ["/api/portfolios"],
    queryFn: async () => {
      const res = await fetch("/api/portfolios", { credentials: "include" });
      if (!res.ok) throw new Error("portfolios");
      return res.json() as Promise<Array<{ id: string; name: string; isDefault?: boolean }>>;
    },
  });

  const defaultPortfolioId = useMemo(
    () => portfolios.find((p) => p.isDefault)?.id ?? portfolios[0]?.id,
    [portfolios],
  );

  const portfolioOptions = useMemo(
    () => [
      { value: "default", label: "Predvolené portfólio" },
      ...portfolios.map((p) => ({ value: p.id, label: p.name })),
    ],
    [portfolios],
  );

  const cashScopeOptions = useMemo(
    () => [
      { value: "all", label: "Všetky portfóliá" },
      { value: "default", label: "Predvolené portfólio" },
      ...portfolios.map((p) => ({ value: p.id, label: p.name })),
    ],
    [portfolios],
  );

  const resolvedCashPortfolio = useMemo(() => {
    if (cashScope === "default") return defaultPortfolioId ?? "all";
    return cashScope;
  }, [cashScope, defaultPortfolioId]);

  const { data: cashBreakdown, isLoading: cashLoading } = useQuery({
    queryKey: ["/api/cash-ledger-breakdown", resolvedCashPortfolio],
    queryFn: async () => {
      const res = await fetch(
        `/api/cash-ledger-breakdown?portfolio=${encodeURIComponent(resolvedCashPortfolio)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(await readHttpErrorMessage(res));
      return res.json() as Promise<{
        transactionCount: number;
        netCashEur: number;
        depositsEur: number;
        withdrawalsEur: number;
        buysEur: number;
        sellsEur: number;
        dividendsEur: number;
        taxEur: number;
      }>;
    },
    enabled: portfolios.length > 0,
    staleTime: 30_000,
  });

  const pickBroker = (next: Broker) => {
    setBroker(next);
    try {
      localStorage.setItem(IMPORT_BROKER_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);
      const parseRes = await fetch(`/api/import/${broker}/parse`, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!parseRes.ok) throw new Error(await readHttpErrorMessage(parseRes));
      const parsed = (await parseRes.json()) as {
        transactions?: unknown[];
        message?: string;
      };
      const savePortfolioId = portfolioId === "default" ? null : portfolioId;
      const saveRes = await fetch(`/api/import/${broker}/save`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: parsed.transactions ?? [],
          portfolioId: savePortfolioId,
        }),
      });
      if (!saveRes.ok) throw new Error(await readHttpErrorMessage(saveRes));
      return saveRes.json() as Promise<{ imported?: number; message?: string }>;
    },
    onSuccess: (saved) => {
      toast({
        title: "Import hotový",
        description:
          saved?.imported != null ? `Importovaných: ${saved.imported}` : saved?.message || "Dáta boli uložené.",
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/cash-ledger-breakdown"] });
      setFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (err: Error) => {
      toast({ title: "Import zlyhal", description: err.message, variant: "destructive" });
    },
  });

  const migrateMutation = useMutation({
    mutationFn: async () => {
      const body = migrateTarget === "default" ? {} : { targetPortfolioId: migrateTarget };
      const res = await fetch("/api/portfolios/migrate-unassigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readHttpErrorMessage(res));
      return res.json() as Promise<{
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
            : `Presunuté: ${data.transactionsMoved} transakcií, ${data.holdingsMoved} holdingov, ${data.optionTradesMoved} opcií.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/cash-ledger-breakdown"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
    },
    onError: (err: Error) => {
      toast({ title: "Chyba", description: err.message, variant: "destructive" });
    },
  });

  const recalcMutation = useMutation({
    mutationFn: async () => {
      if (portfolios.length === 0) throw new Error("Nemáš žiadne portfólio.");
      const id =
        recalcTarget === "default"
          ? (portfolios.find((p) => p.isDefault) ?? portfolios[0]!).id
          : recalcTarget;
      const res = await fetch(`/api/portfolios/${id}/recalculate-holdings`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await readHttpErrorMessage(res));
      return res.json() as Promise<{ synced: number }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Pozície prepočítané",
        description:
          data.synced === 0
            ? "Žiadne akciové transakcie v tomto portfóliu."
            : `Prepočítaných ${data.synced} tickerov.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/cash-ledger-breakdown"] });
    },
    onError: (err: Error) => {
      toast({ title: "Chyba", description: err.message, variant: "destructive" });
    },
  });

  const formatTypes = broker === "xtb" ? XTB_TYPES : ETORO_TYPES;

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline="XTB · eToro" title="Import brokera" />
      <PageBody>
        <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
          Nahrajte export z XTB alebo eToro pre automatický import transakcií do portfólia.
        </p>

        <Card className="gap-2 p-3">
          <div>
            <p className="rd-type-label text-[var(--rd-text-primary)]">Broker</p>
            <div className="mt-1.5 flex gap-1">
              <Chip active={broker === "xtb"} onClick={() => pickBroker("xtb")}>
                XTB
              </Chip>
              <Chip active={broker === "etoro"} onClick={() => pickBroker("etoro")}>
                eToro
              </Chip>
            </div>
          </div>
          <Select
            label="Portfólio pre import"
            value={portfolioId}
            onChange={setPortfolioId}
            options={portfolioOptions}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              if (!file) return;
              setFileName(file.name);
              importMutation.mutate(file);
            }}
          />
          <button
            type="button"
            disabled={importMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-2 rounded-[var(--rd-radius-md)] border border-dashed border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface)] px-3 py-6",
              importMutation.isPending && "opacity-60",
            )}
            data-testid="button-upload-file"
          >
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-[var(--rd-bg-surface-hover)] text-[var(--rd-text-secondary)]">
              <Upload className="size-5" aria-hidden />
            </span>
            <p className="rd-type-body-strong text-[var(--rd-text-primary)]">Nahrať súbor</p>
            <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">CSV, XLSX, XLS · max 10 MB</p>
            {fileName ? (
              <p className="rd-type-data-sm text-[var(--rd-text-secondary)]">{fileName}</p>
            ) : null}
            <span className="mt-1 inline-flex h-9 items-center rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] [background-image:var(--rd-bg-surface-gradient)] px-3 rd-type-label text-[var(--rd-text-primary)]">
              {importMutation.isPending ? "Importujem…" : "Nahrať súbor"}
            </span>
          </button>
        </Card>

        <Card className="gap-2 p-3">
          <div>
            <h3 className="rd-type-h3 text-[var(--rd-text-primary)]">
              Formát {broker === "xtb" ? "XTB" : "eToro"} exportu
            </h3>
            <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
              {broker === "xtb"
                ? "Nový XTB export (Cash Operations, Open Positions) aj starý formát (Cash operation history)."
                : "Stiahnite Account Statement z eToro (Nastavenia → Account Statement → Download XLS)."}
            </p>
          </div>
          <p className="rd-type-body-strong text-[var(--rd-text-primary)]">
            Podporované typy transakcií
          </p>
          <div className="flex flex-col">
            {formatTypes.map((row, i) => (
              <div key={row.label}>
                {i > 0 ? <div className="h-px w-full bg-[var(--rd-border-subtle)]" /> : null}
                <div className="flex items-center gap-2 py-2">
                  <div className="w-[84px] shrink-0">
                    <Badge label={row.label} tone={row.tone} />
                  </div>
                  <p className="min-w-0 flex-1 rd-type-body-sm text-[var(--rd-text-secondary)]">
                    {row.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="gap-2 p-3">
          <div>
            <h3 className="rd-type-h3 text-[var(--rd-text-primary)]">Opraviť nezaradené transakcie</h3>
            <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
              Presunie transakcie, holdingy a opcie s nenastaveným portfóliom do vybraného cieľa.
            </p>
          </div>
          <Select
            label="Cieľové portfólio"
            value={migrateTarget}
            onChange={setMigrateTarget}
            options={portfolioOptions}
          />
          <Button
            variant="Secondary"
            className="w-full"
            disabled={migrateMutation.isPending || portfolios.length === 0}
            onClick={() => migrateMutation.mutate()}
            data-testid="button-move-unassigned"
          >
            {migrateMutation.isPending ? "Presúvam…" : "Presunúť nezaradené"}
          </Button>
        </Card>

        <Card className="gap-2 p-3">
          <div>
            <h3 className="rd-type-h3 text-[var(--rd-text-primary)]">Prepočítať akciové pozície</h3>
            <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
              Znovu vypočíta množstvá a priemerné ceny z výpisu transakcií (BUY/SELL) v zvolenom
              portfóliu.
            </p>
          </div>
          <Select
            label="Portfólio"
            value={recalcTarget}
            onChange={setRecalcTarget}
            options={portfolioOptions}
          />
          <Button
            variant="Secondary"
            className="w-full"
            disabled={recalcMutation.isPending || portfolios.length === 0}
            onClick={() => recalcMutation.mutate()}
            data-testid="button-recalc-positions"
          >
            {recalcMutation.isPending ? "Prepočítavam…" : "Prepočítať z transakcií"}
          </Button>
        </Card>

        <Card className="gap-2 p-3">
          <div>
            <h3 className="rd-type-h3 text-[var(--rd-text-primary)]">Rozpad hotovosti</h3>
            <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
              Kontrola denníka: vklady + výbery − nákupy + predaje + dividendy + dane = čistá
              hotovosť.
            </p>
          </div>
          <Select label="Rozsah" value={cashScope} onChange={setCashScope} options={cashScopeOptions} />
          {cashLoading ? (
            <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">Načítavam…</p>
          ) : cashBreakdown ? (
            <div className="flex flex-col gap-1.5">
              <KvRow label="Transakcií v denníku" value={String(cashBreakdown.transactionCount)} />
              <div className="h-px w-full bg-[var(--rd-border-subtle)]" />
              <KvRow
                label="Vklady (DEPOSIT)"
                value={signedMoney(formatCurrency, cashBreakdown.depositsEur)}
                tone="up"
              />
              <KvRow
                label="Výbery (WITHDRAWAL)"
                value={signedMoney(formatCurrency, -Math.abs(cashBreakdown.withdrawalsEur))}
                tone="down"
              />
              <KvRow
                label="Nákupy (BUY) — odtok"
                value={signedMoney(formatCurrency, -Math.abs(cashBreakdown.buysEur))}
                tone="down"
              />
              <KvRow
                label="Predaje (SELL) — prítok"
                value={signedMoney(formatCurrency, cashBreakdown.sellsEur)}
                tone="up"
              />
              <KvRow
                label="Dividendy"
                value={signedMoney(formatCurrency, cashBreakdown.dividendsEur)}
                tone="up"
              />
              <KvRow
                label="Dane (TAX)"
                value={signedMoney(formatCurrency, -Math.abs(cashBreakdown.taxEur))}
                tone="down"
              />
              <div className="h-px w-full bg-[var(--rd-border-subtle)]" />
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 rd-type-body-strong text-[var(--rd-text-primary)]">
                  Čistá hotovosť
                </p>
                <p className="rd-type-data-lg shrink-0 text-[var(--rd-text-primary)]">
                  {formatCurrency(cashBreakdown.netCashEur)}
                </p>
              </div>
            </div>
          ) : (
            <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">Žiadne dáta.</p>
          )}
        </Card>
      </PageBody>
    </div>
  );
}
