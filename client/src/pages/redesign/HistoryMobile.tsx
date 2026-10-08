import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { sk } from "date-fns/locale";
import { Download, PlusCircle, Upload } from "lucide-react";
import type { Transaction } from "@shared/schema";
import { CASH_FLOW_TICKER } from "@shared/schema";
import { useCurrency } from "@/hooks/useCurrency";
import { usePortfolio } from "@/hooks/usePortfolio";
import { AddTransactionForm } from "@/components/AddTransactionForm";
import {
  Button,
  Card,
  Chip,
  Dialog,
  EmptyState,
  Select,
  TopBar,
  TransactionRow,
  type BadgeTone,
} from "@/redesign/ui";
import { PageBody } from "./mobileChrome";

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

export default function HistoryMobile() {
  const { formatCurrency, convertPrice } = useCurrency();
  const { getQueryParam, isAllPortfolios } = usePortfolio();
  const portfolioParam = getQueryParam();
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [addOpen, setAddOpen] = useState(false);

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

  const filtered = useMemo(() => {
    let list = [...transactions];
    if (typeFilter !== "all") list = list.filter((tx) => tx.type === typeFilter);
    list.sort((a, b) => {
      const da = new Date(a.transactionDate).getTime();
      const db = new Date(b.transactionDate).getTime();
      return sortDir === "desc" ? db - da : da - db;
    });
    return list;
  }, [transactions, typeFilter, sortDir]);

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

  const amountFor = (tx: Transaction) => {
    const price = parseFloat(tx.pricePerShare || "0");
    const shares = parseFloat(tx.shares || "0");
    const commission = parseFloat(tx.commission || "0");
    const raw =
      tx.type === "DIVIDEND" || tx.type === "DEPOSIT" || tx.type === "WITHDRAWAL"
        ? price
        : price * shares + (tx.type === "BUY" ? commission : -commission);
    const cur = (tx.currency || "EUR").toUpperCase() as "EUR" | "USD" | "GBP" | "CZK" | "PLN";
    const converted = convertPrice(raw, cur === "EUR" || cur === "USD" || cur === "GBP" || cur === "CZK" || cur === "PLN" ? cur : "EUR");
    const sign = tx.type === "SELL" || tx.type === "DIVIDEND" || tx.type === "DEPOSIT" ? "+" : "";
    return `${sign}${formatCurrency(Math.abs(converted))}`;
  };

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline="História transakcií" title="História" />
      <PageBody>
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
          Rozsah: {isAllPortfolios ? "všetky viditeľné portfóliá" : "vybrané portfólio"}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button className="flex-1" onClick={() => setAddOpen(true)}>
            <PlusCircle className="size-4" />
            Pridať transakciu
          </Button>
          <Button
            variant="Secondary"
            onClick={() => {
              window.location.href = `/api/transactions/export?portfolio=${portfolioParam}`;
            }}
          >
            <Download className="size-4" />
            Export
          </Button>
          <Button
            variant="Ghost"
            onClick={() => {
              window.location.href = "/api/transactions/import-template";
            }}
          >
            <Upload className="size-4" />
            Vzor
          </Button>
        </div>
        <div className="flex gap-2">
          <Select
            label="Typ"
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: "all", label: "Všetky" },
              { value: "BUY", label: "Nákupy" },
              { value: "SELL", label: "Predaje" },
              { value: "DIVIDEND", label: "Dividendy" },
              { value: "DEPOSIT", label: "Vklady" },
              { value: "WITHDRAWAL", label: "Výbery" },
              { value: "TAX", label: "Dane" },
            ]}
          />
          <div className="flex flex-1 items-end gap-1 pb-0.5">
            <Chip active={sortDir === "desc"} onClick={() => setSortDir("desc")}>
              Zostupne
            </Chip>
            <Chip active={sortDir === "asc"} onClick={() => setSortDir("asc")}>
              Vzostupne
            </Chip>
          </div>
        </div>

        {isPending ? (
          <p className="text-sm text-[var(--rd-text-tertiary)]">Načítavam…</p>
        ) : groups.length === 0 ? (
          <EmptyState title="Žiadne transakcie" body="Pridaj nákup alebo importuj CSV." />
        ) : (
          groups.map(([month, rows]) => (
            <Card key={month}>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-semibold leading-5">{month}</h3>
                <p className="font-mono text-xs text-[var(--rd-text-tertiary)]">{rows.length} transakcií</p>
              </div>
              <div className="divide-y divide-[var(--rd-border-subtle)]">
                {rows.map((tx) => {
                  const ticker =
                    tx.ticker === CASH_FLOW_TICKER ? "CASH" : tx.ticker || "—";
                  const meta = `${format(new Date(tx.transactionDate), "d. MMM yyyy HH:mm", { locale: sk })} · ${formatShareQuantitySafe(tx.shares)} ks`;
                  return (
                    <TransactionRow
                      key={tx.id}
                      ticker={ticker}
                      badge={TYPE_LABEL[tx.type] || tx.type}
                      tone={TYPE_TONE[tx.type] || "Neutral"}
                      meta={meta}
                      amount={amountFor(tx)}
                      unit={tx.pricePerShare ? `${formatCurrency(convertPrice(parseFloat(tx.pricePerShare), ((tx.currency || "EUR") as "EUR")))} / ks` : undefined}
                    />
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
    </div>
  );
}

function formatShareQuantitySafe(raw: string | null | undefined): string {
  const n = parseFloat(raw || "0");
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
