import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { sk } from "date-fns/locale";
import { Download, Eye, EyeOff, PlusCircle, Search, Upload } from "lucide-react";
import type { Transaction } from "@shared/schema";
import { CASH_FLOW_TICKER } from "@shared/schema";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useChartSettings } from "@/hooks/useChartSettings";
import { AddTransactionForm } from "@/components/AddTransactionForm";
import {
  Button,
  Card,
  Chip,
  Dialog,
  EmptyState,
  Input,
  TopBar,
  TransactionRow,
  type BadgeTone,
} from "@/redesign/ui";
import {
  HelpButton,
  PageBody,
  PortfolioSwitcher,
  signedMoney,
} from "./mobileChrome";

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
  SELL: "Info",
  DIVIDEND: "Profit",
  TAX: "Loss",
  DEPOSIT: "Neutral",
  WITHDRAWAL: "Warning",
};

const TYPE_FILTERS = [
  { value: "all", label: "Všetky" },
  { value: "BUY", label: "Nákupy" },
  { value: "SELL", label: "Predaje" },
  { value: "DIVIDEND", label: "Div" },
  { value: "DEPOSIT", label: "Vklady" },
  { value: "WITHDRAWAL", label: "Výbery" },
  { value: "TAX", label: "Dane" },
] as const;

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

export default function HistoryMobile() {
  const [, setLocation] = useLocation();
  const { formatCurrency, convertPrice } = useCurrency();
  const { getQueryParam, isAllPortfolios, selectedPortfolio } = usePortfolio();
  const { hideAmounts, toggleHideAmounts } = useChartSettings();
  const portfolioParam = getQueryParam();
  const overline = isAllPortfolios ? "Všetky portfóliá" : selectedPortfolio?.name || "Portfólio";
  const mask = (s: string) => (hideAmounts ? "••••••" : s);

  const [typeFilter, setTypeFilter] = useState("all");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<Transaction | null>(null);

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
    const q = query.trim().toLowerCase();
    let list = [...transactions];
    if (typeFilter !== "all") list = list.filter((tx) => tx.type === typeFilter);
    if (q) {
      list = list.filter((tx) => {
        const ticker = (tx.ticker || "").toLowerCase();
        const name = (tx.companyName || "").toLowerCase();
        return ticker.includes(q) || name.includes(q);
      });
    }
    list.sort((a, b) => {
      const da = new Date(a.transactionDate).getTime();
      const db = new Date(b.transactionDate).getTime();
      return sortDir === "desc" ? db - da : da - db;
    });
    return list;
  }, [transactions, typeFilter, sortDir, query]);

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

  const periodTotal = useMemo(() => {
    return filtered.reduce((sum, tx) => {
      const price = parseFloat(tx.pricePerShare || "0");
      const shares = parseFloat(tx.shares || "0");
      const commission = parseFloat(tx.commission || "0");
      const raw =
        tx.type === "DIVIDEND" || tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL"
          ? price
          : price * shares + (tx.type === "BUY" ? commission : -commission);
      const v = convertPrice(raw, txCurrency(tx));
      if (tx.type === "SELL" || tx.type === "DIVIDEND" || tx.type === "DEPOSIT") return sum + Math.abs(v);
      if (tx.type === "BUY" || tx.type === "TAX" || tx.type === "WITHDRAWAL") return sum - Math.abs(v);
      return sum;
    }, 0);
  }, [filtered, convertPrice]);

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar
        overline={overline}
        title="História"
        onOverlineClick={() => setPickerOpen(true)}
        trailing={
          <div className="flex items-center gap-1">
            <HelpButton
              title="História"
              body="Zoznam nákupov, predajov, dividend a peňažných pohybov. Filter podľa typu alebo tickera; sumy môžeš skryť okom."
            />
            <button
              type="button"
              aria-label={hideAmounts ? "Zobraziť sumy" : "Skryť sumy"}
              className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)]"
              onClick={() => toggleHideAmounts()}
            >
              {hideAmounts ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        }
      />

      <PortfolioSwitcher open={pickerOpen} onClose={() => setPickerOpen(false)} />

      <PageBody>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => setAddOpen(true)}>
            <PlusCircle className="size-4" />
            Pridať
          </Button>
          <Button
            variant="Secondary"
            aria-label="Export"
            onClick={() => {
              window.location.href = `/api/transactions/export?portfolio=${portfolioParam}`;
            }}
          >
            <Download className="size-4" />
          </Button>
          <Button variant="Ghost" onClick={() => setLocation("/import")}>
            <Upload className="size-4" />
            Import
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-[14px] z-10 size-4 text-[var(--rd-text-tertiary)]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hľadať ticker alebo názov…"
            className="pl-9"
            aria-label="Hľadať transakcie"
            mono={false}
          />
        </div>

        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
          {TYPE_FILTERS.map((f) => (
            <Chip key={f.value} active={typeFilter === f.value} onClick={() => setTypeFilter(f.value)}>
              {f.label}
            </Chip>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-[var(--rd-text-tertiary)]">
            {filtered.length} z {transactions.length} · netto {mask(signedMoney(formatCurrency, periodTotal))}
          </p>
          <div className="flex gap-1">
            <Chip active={sortDir === "desc"} onClick={() => setSortDir("desc")}>
              Najnovšie
            </Chip>
            <Chip active={sortDir === "asc"} onClick={() => setSortDir("asc")}>
              Najstaršie
            </Chip>
          </div>
        </div>

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
            <Card key={month} className="gap-0 p-0">
              <div className="flex items-baseline justify-between gap-2 px-4 pb-1 pt-4">
                <h3 className="text-[15px] font-semibold leading-5">{month}</h3>
                <p className="font-mono text-xs text-[var(--rd-text-tertiary)]">{rows.length}</p>
              </div>
              <div className="divide-y divide-[var(--rd-border-subtle)] px-4">
                {rows.map((tx) => {
                  const ticker = tx.ticker === CASH_FLOW_TICKER ? "CASH" : tx.ticker || "—";
                  const meta = `${format(new Date(tx.transactionDate), "d. MMM yyyy", { locale: sk })} · ${formatShareQuantitySafe(tx.shares)} ks`;
                  return (
                    <button
                      key={tx.id}
                      type="button"
                      className="w-full text-left"
                      onClick={() => setSelected(tx)}
                    >
                      <TransactionRow
                        ticker={ticker}
                        badge={TYPE_LABEL[tx.type] || tx.type}
                        tone={TYPE_TONE[tx.type] || "Neutral"}
                        meta={meta}
                        amount={amountFor(tx)}
                        unit={
                          tx.pricePerShare
                            ? `${mask(formatCurrency(convertPrice(parseFloat(tx.pricePerShare), txCurrency(tx))))} / ks`
                            : undefined
                        }
                      />
                    </button>
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
        title={selected ? `${TYPE_LABEL[selected.type] || selected.type} · ${selected.ticker === CASH_FLOW_TICKER ? "CASH" : selected.ticker}` : "Detail"}
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-[var(--rd-text-secondary)]">
              {format(new Date(selected.transactionDate), "d. MMMM yyyy HH:mm", { locale: sk })}
            </p>
            {selected.companyName ? (
              <p className="text-[var(--rd-text-primary)]">{selected.companyName}</p>
            ) : null}
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
