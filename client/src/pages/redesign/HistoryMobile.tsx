import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { sk } from "date-fns/locale";
import { ArrowDown, ArrowUp, Check, Pencil, PlusCircle, Trash2 } from "lucide-react";
import type { Transaction } from "@shared/schema";
import { CASH_FLOW_TICKER } from "@shared/schema";
import { CASH_INTEREST_DISPLAY_NAME, CASH_INTEREST_TICKER } from "@shared/tickerCurrency";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { AddTransactionForm } from "@/components/AddTransactionForm";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Select,
  TopBar,
  type BadgeTone,
} from "@/redesign/ui";
import { HelpButton, PageBody, PortfolioSwitcher, signedMoney } from "./mobileChrome";

const TYPE_LABEL: Record<string, string> = {
  BUY: "Nákup",
  SELL: "Predaj",
  DIVIDEND: "Div",
  TAX: "Daň",
  DEPOSIT: "Vklad",
  WITHDRAWAL: "Výber",
};

const TYPE_TONE: Record<string, BadgeTone> = {
  BUY: "Profit",
  SELL: "Loss",
  DIVIDEND: "Info",
  TAX: "Warning",
  DEPOSIT: "Neutral",
  WITHDRAWAL: "Warning",
};

const TYPE_FILTERS = [
  { value: "all", label: "Všetky" },
  { value: "BUY", label: "Nákupy" },
  { value: "SELL", label: "Predaje" },
  { value: "DIVIDEND", label: "Dividendy" },
  { value: "DEPOSIT", label: "Vklady" },
  { value: "WITHDRAWAL", label: "Výbery" },
] as const;

type SortField =
  | "transactionDate"
  | "type"
  | "ticker"
  | "shares"
  | "pricePerShare"
  | "commission"
  | "total"
  | "realizedGain";

const SORT_OPTIONS: Array<{ value: SortField; label: string }> = [
  { value: "transactionDate", label: "Dátum" },
  { value: "type", label: "Typ" },
  { value: "ticker", label: "Ticker" },
  { value: "shares", label: "Počet kusov" },
  { value: "pricePerShare", label: "Cena/ks" },
  { value: "commission", label: "Poplatky" },
  { value: "total", label: "Celkom" },
  { value: "realizedGain", label: "Realiz. zisk" },
];

function formatShareQuantitySafe(raw: string | null | undefined): string {
  const n = parseFloat(raw || "0");
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function txCurrency(tx: Transaction): "EUR" | "USD" | "GBP" | "CZK" | "PLN" {
  const cur = (tx.currency || "EUR").toUpperCase();
  if (cur === "USD" || cur === "GBP" || cur === "CZK" || cur === "PLN") return cur;
  return "EUR";
}

function txCountLabel(n: number): string {
  if (n === 1) return "1 transakcia";
  if (n >= 2 && n <= 4) return `${n} transakcie`;
  return `${n} transakcií`;
}

export default function HistoryMobile() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { formatCurrency, convertPrice } = useCurrency();
  const { getQueryParam, isAllPortfolios, selectedPortfolio } = usePortfolio();
  const { hideAmounts } = useChartSettings();
  const portfolioParam = getQueryParam();
  const rangeLabel = isAllPortfolios
    ? "Rozsah: všetky viditeľné portfóliá."
    : `Rozsah: ${selectedPortfolio?.name || "portfólio"}.`;
  const mask = (s: string) => (hideAmounts ? "••••••" : s);

  const [typeFilter, setTypeFilter] = useState("all");
  const [tickerFilter, setTickerFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("transactionDate");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [addOpen, setAddOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: transactions = [], isPending } = useQuery<Transaction[]>({
    queryKey: ["/api/transactions", portfolioParam],
    queryFn: async () => {
      const res = await fetch(`/api/transactions?portfolio=${encodeURIComponent(portfolioParam)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("transactions");
      return res.json();
    },
  });

  const { data: sellGainsPayload } = useQuery<{
    gains: Record<string, number>;
    bySell?: Record<string, { gainEur: number; costEur: number; pct: number | null }>;
  }>({
    queryKey: ["/api/sell-realized-gains", portfolioParam],
    queryFn: async () => {
      const res = await fetch(
        `/api/sell-realized-gains?portfolio=${encodeURIComponent(portfolioParam)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("sell realized gains");
      return res.json();
    },
    enabled: transactions.length > 0,
    staleTime: 60 * 1000,
  });

  const gainEurBySellId = useMemo(() => {
    const m = new Map<string, number>();
    const bySell = sellGainsPayload?.bySell;
    if (bySell) {
      for (const [id, row] of Object.entries(bySell)) {
        if (row && Number.isFinite(row.gainEur)) m.set(id, row.gainEur);
      }
      return m;
    }
    const gains = sellGainsPayload?.gains;
    if (gains) {
      for (const [id, value] of Object.entries(gains)) {
        if (Number.isFinite(value)) m.set(id, value);
      }
    }
    return m;
  }, [sellGainsPayload]);

  const uniqueTickers = useMemo(
    () => Array.from(new Set(transactions.map((tx) => tx.ticker).filter(Boolean))).sort(),
    [transactions],
  );

  const tickerFilterLabel = (ticker: string) => {
    if (ticker === CASH_FLOW_TICKER) return "Hotovosť (vklady/výbery)";
    if (ticker.toUpperCase() === CASH_INTEREST_TICKER) return CASH_INTEREST_DISPLAY_NAME;
    return ticker;
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/transactions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      toast({ title: "Vymazané", description: "Transakcia bola odstránená." });
    },
    onError: (err: Error) => {
      toast({ title: "Chyba", description: err.message || "Nepodarilo sa vymazať.", variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => apiRequest("DELETE", `/api/transactions/${id}`)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      setSelectedIds(new Set());
      toast({ title: "Vymazané", description: "Označené transakcie boli odstránené." });
    },
  });

  const amountValue = (tx: Transaction) => {
    const price = parseFloat(tx.pricePerShare || "0");
    const shares = parseFloat(tx.shares || "0");
    const commission = parseFloat(tx.commission || "0");
    const raw =
      tx.type === "DIVIDEND" || tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL"
        ? price
        : price * shares + (tx.type === "BUY" ? commission : -commission);
    return convertPrice(raw, txCurrency(tx));
  };

  const amountFor = (tx: Transaction) => {
    const value = amountValue(tx);
    if (tx.type === "SELL" || tx.type === "DIVIDEND" || tx.type === "DEPOSIT") {
      return mask(signedMoney(formatCurrency, Math.abs(value)));
    }
    if (tx.type === "BUY" || tx.type === "TAX" || tx.type === "WITHDRAWAL") {
      return mask(`−${formatCurrency(Math.abs(value))}`);
    }
    return mask(formatCurrency(Math.abs(value)));
  };

  const filtered = useMemo(() => {
    const list = transactions.filter((tx) => {
      if (typeFilter !== "all" && tx.type !== typeFilter) return false;
      if (tickerFilter !== "all" && tx.ticker !== tickerFilter) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    const txTotal = (tx: Transaction) => {
      const shares = parseFloat(String(tx.shares ?? "0"));
      const price = parseFloat(String(tx.pricePerShare ?? "0"));
      const commission = parseFloat(String(tx.commission ?? "0"));
      if (!Number.isFinite(shares) || !Number.isFinite(price)) return 0;
      const gross = shares * price;
      if (tx.type === "DIVIDEND") return gross - (Number.isFinite(commission) ? commission : 0);
      if (tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL") return gross;
      if (tx.type === "BUY") return gross + (Number.isFinite(commission) ? commission : 0);
      return gross - (Number.isFinite(commission) ? commission : 0);
    };
    const realizedAmount = (tx: Transaction) => {
      if (tx.type !== "SELL") return 0;
      const eur = gainEurBySellId.get(tx.id);
      return eur != null && Number.isFinite(eur) ? eur : 0;
    };
    const getKey = (tx: Transaction): string | number => {
      switch (sortField) {
        case "transactionDate":
          return new Date(tx.transactionDate).getTime();
        case "type":
          return tx.type || "";
        case "ticker":
          return tx.ticker || "";
        case "shares":
          return parseFloat(String(tx.shares ?? "0")) || 0;
        case "pricePerShare":
          return parseFloat(String(tx.pricePerShare ?? "0")) || 0;
        case "commission":
          return parseFloat(String(tx.commission ?? "0")) || 0;
        case "total":
          return txTotal(tx);
        case "realizedGain":
          return realizedAmount(tx);
        default:
          return 0;
      }
    };

    return [...list].sort((a, b) => {
      const av = getKey(a);
      const bv = getKey(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "sk") * dir;
    });
  }, [transactions, typeFilter, tickerFilter, sortField, sortDir, gainEurBySellId]);

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of filtered) {
      const key = format(new Date(tx.transactionDate), "LLLL yyyy", { locale: sk });
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(tx);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const toggleId = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar
        overline="História transakcií"
        title="História"
        onOverlineClick={() => setPickerOpen(true)}
        trailing={
          <HelpButton
            title="História"
            body="Zoznam nákupov, predajov, dividend a peňažných pohybov. Filter podľa typu; rozsah podľa vybraného portfólia."
          />
        }
      />

      <PortfolioSwitcher open={pickerOpen} onClose={() => setPickerOpen(false)} />

      <PageBody>
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">{rangeLabel}</p>

        <Button className="w-full" onClick={() => setAddOpen(true)}>
          <PlusCircle className="size-4" />
          Pridať transakciu
        </Button>
        <div className="flex gap-1.5">
          <Button
            variant="Secondary"
            className="flex-1"
            onClick={() => {
              window.location.href = `/api/transactions/export?portfolio=${portfolioParam}`;
            }}
          >
            Export CSV
          </Button>
          <Button variant="Secondary" className="flex-1" onClick={() => setLocation("/import")}>
            Import CSV
          </Button>
        </div>

        <Card className="gap-2" data-name="Card/Filters">
          <div className="grid grid-cols-2 gap-2">
            <Select
              label="Typ"
              value={typeFilter}
              onChange={setTypeFilter}
              options={TYPE_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
            />
            <Select
              label="Akcia"
              value={tickerFilter}
              onChange={setTickerFilter}
              options={[
                { value: "all", label: "Všetky" },
                ...uniqueTickers.map((ticker) => ({
                  value: ticker,
                  label: tickerFilterLabel(ticker),
                })),
              ]}
            />
          </div>
          <div className="flex items-end gap-2">
            <Select
              className="min-w-0 flex-1"
              label="Zoradiť"
              value={sortField}
              onChange={(value) => setSortField(value as SortField)}
              options={SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            />
            <button
              type="button"
              data-testid="button-sort-direction"
              onClick={() => setSortDir((prev) => (prev === "desc" ? "asc" : "desc"))}
              className="inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] px-2 text-xs font-medium text-[var(--rd-text-primary)]"
            >
              {sortDir === "desc" ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}
              {sortDir === "desc" ? "Zostupne" : "Vzostupne"}
            </button>
          </div>
        </Card>

        {selectedIds.size > 0 ? (
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-xs text-[var(--rd-text-secondary)]">
              Označených: {selectedIds.size}
            </p>
            <Button
              variant="Secondary"
              onClick={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
              disabled={bulkDeleteMutation.isPending}
            >
              <Trash2 className="size-4 text-[var(--rd-loss)]" />
              Vymazať
            </Button>
          </div>
        ) : null}

        {isPending ? (
          <p className="text-sm text-[var(--rd-text-tertiary)]">Načítavam…</p>
        ) : groups.length === 0 ? (
          <EmptyState
            title="Žiadne transakcie"
            body="Pridaj nákup, alebo importuj CSV/Excel z brokera."
            actionLabel="Importovať"
            onAction={() => setLocation("/import")}
          />
        ) : (
          groups.map(([month, rows]) => (
            <Card key={month} className="gap-1">
              <div className="flex items-center gap-1.5">
                <p className="min-w-0 flex-1 rd-type-overline text-[var(--rd-text-tertiary)]">{month}</p>
                <p className="text-[10px] font-medium text-[var(--rd-text-tertiary)]">{txCountLabel(rows.length)}</p>
              </div>
              <div className="flex flex-col">
                {rows.map((tx) => {
                  const ticker = tx.ticker === CASH_FLOW_TICKER ? "CASH" : tx.ticker || "—";
                  const checked = selectedIds.has(tx.id);
                  const meta = `${format(new Date(tx.transactionDate), "d. MMM yyyy HH:mm", { locale: sk })} · ${formatShareQuantitySafe(tx.shares)} ks`;
                  const unit = tx.pricePerShare
                    ? `${mask(formatCurrency(convertPrice(parseFloat(tx.pricePerShare), txCurrency(tx))))} / ks`
                    : undefined;
                  return (
                    <div key={tx.id} className="flex flex-col gap-1.5 border-t border-[var(--rd-border-subtle)] py-2 first:border-t-0">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={checked ? "Odznačiť" : "Označiť"}
                          aria-pressed={checked}
                          onClick={() => toggleId(tx.id, !checked)}
                          className={`inline-flex size-5 shrink-0 items-center justify-center rounded-[var(--rd-radius-xs)] border ${
                            checked
                              ? "border-[var(--rd-profit)] bg-[var(--rd-profit)] text-[var(--rd-text-on-brand)]"
                              : "border-[var(--rd-border-strong)] bg-transparent"
                          }`}
                        >
                          {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
                        </button>
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(tx)}>
                          <div className="flex items-center gap-1.5">
                            <Avatar ticker={ticker} companyName={tx.companyName || undefined} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <p className="rd-type-data text-[var(--rd-text-primary)]">{ticker}</p>
                                <Badge label={TYPE_LABEL[tx.type] || tx.type} tone={TYPE_TONE[tx.type] || "Neutral"} />
                              </div>
                            </div>
                            <p className="rd-type-data shrink-0 text-[var(--rd-text-primary)]">{amountFor(tx)}</p>
                          </div>
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 pl-7">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] leading-[14px] text-[var(--rd-text-tertiary)]">{meta}</p>
                          {unit ? <p className="text-[10px] font-medium leading-3 text-[var(--rd-text-tertiary)]">{unit}</p> : null}
                        </div>
                        <button
                          type="button"
                          aria-label="Upraviť"
                          className="inline-flex size-8 items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)]"
                          onClick={() => setSelected(tx)}
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          type="button"
                          aria-label="Vymazať"
                          className="inline-flex size-8 items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-loss)]"
                          onClick={() => deleteMutation.mutate(tx.id)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))
        )}
      </PageBody>

      <Dialog open={addOpen} title="Nová transakcia" body="Pridajte nákup alebo inú transakciu do portfólia." onClose={() => setAddOpen(false)}>
        <div className="mt-3 max-h-[60vh] overflow-y-auto">
          <AddTransactionForm embed onSuccessSubmit={() => setAddOpen(false)} />
        </div>
      </Dialog>

      <Dialog
        open={!!selected}
        title={
          selected
            ? `${TYPE_LABEL[selected.type] || selected.type} · ${selected.ticker === CASH_FLOW_TICKER ? "CASH" : selected.ticker}`
            : "Detail"
        }
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-[var(--rd-text-secondary)]">
              {format(new Date(selected.transactionDate), "d. MMMM yyyy HH:mm", { locale: sk })}
            </p>
            {selected.companyName ? <p className="text-[var(--rd-text-primary)]">{selected.companyName}</p> : null}
            <div className="space-y-1 font-mono text-xs">
              <p>Suma · {amountFor(selected)}</p>
              <p>
                Cena ·{" "}
                {selected.pricePerShare
                  ? mask(formatCurrency(convertPrice(parseFloat(selected.pricePerShare), txCurrency(selected))))
                  : "—"}
              </p>
              <p>Množstvo · {formatShareQuantitySafe(selected.shares)} ks</p>
              <p>
                Poplatok ·{" "}
                {mask(formatCurrency(convertPrice(parseFloat(selected.commission || "0"), txCurrency(selected))))}
              </p>
              <p>Mena · {(selected.currency || "EUR").toUpperCase()}</p>
            </div>
            {selected.ticker && selected.ticker !== CASH_FLOW_TICKER ? (
              <Button
                variant="Secondary"
                className="mt-3 w-full"
                onClick={() => {
                  const t = selected.ticker;
                  setSelected(null);
                  setLocation(`/asset/${encodeURIComponent(t)}`);
                }}
              >
                Otvoriť aktívum
              </Button>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
