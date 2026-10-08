import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { sk } from "date-fns/locale";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useToast } from "@/hooks/use-toast";
import {
  Badge,
  Button,
  Card,
  Chip,
  Dialog,
  EmptyState,
  Input,
  SectionHeader,
  Select,
  StatTile,
  TopBar,
} from "@/redesign/ui";
import type { BadgeTone, StatTone } from "@/redesign/ui";
import type { OptionTrade } from "@shared/schema";

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

type OptionFormState = {
  portfolioId: string;
  underlying: string;
  optionType: string;
  direction: string;
  strikePrice: string;
  expirationDate: string;
  premium: string;
  contracts: string;
  commission: string;
  notes: string;
};

type EditFormState = OptionFormState & {
  openDate: string;
  realizedGain: string;
};

type ImportedOption = {
  underlying: string;
  optionType: string;
  direction: string;
  strikePrice: string;
  expirationDate: string;
  contracts: string;
  premium: string;
  commission: string;
  status: string;
  openDate: string;
  closeDate: string | null;
  closePremium: string | null;
  closeCommission: string | null;
  realizedGain: string;
  notes: string | null;
};

const formatUSD = (value: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

function statusMeta(status: string): { label: string; tone: BadgeTone } {
  switch (status) {
    case "OPEN":
      return { label: "Otvorená", tone: "Info" };
    case "CLOSED":
      return { label: "Uzatvorená", tone: "Profit" };
    case "EXPIRED":
      return { label: "Expirovala", tone: "Neutral" };
    case "ASSIGNED":
      return { label: "Priradená", tone: "Warning" };
    default:
      return { label: status, tone: "Neutral" };
  }
}

function daysToExpiry(expirationDate: Date | string): number {
  const expiry = new Date(expirationDate);
  return Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function dateInputValue(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().split("T")[0] ?? "";
}

function parseOptionsCsv(content: string): { trades: ImportedOption[]; error: string | null } {
  const lines = content.trim().split("\n");
  if (lines.length < 2) {
    return { trades: [], error: "CSV musí obsahovať hlavičku a aspoň jeden riadok dát." };
  }
  const header = lines[0].split(",").map((cell) => cell.trim().toLowerCase());
  const requiredFields = ["underlying", "optiontype", "direction", "strikeprice", "expirationdate"];
  const missing = requiredFields.filter((field) => !header.includes(field));
  if (missing.length > 0) {
    return { trades: [], error: `Chýbajúce povinné stĺpce: ${missing.join(", ")}` };
  }
  try {
    const trades: ImportedOption[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      if (!lines[i].trim()) continue;
      const values = lines[i].split(",").map((cell) => cell.trim());
      const trade: Record<string, string> = {};
      header.forEach((column, index) => {
        trade[column.replace(/\s+/g, "")] = values[index] || "";
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
        openDate: trade.opendate || new Date().toISOString().split("T")[0],
        closeDate: trade.closedate || null,
        closePremium: trade.closepremium || null,
        closeCommission: trade.closecommission || null,
        realizedGain: trade.realizedgain || "0",
        notes: trade.notes || null,
      });
    }
    return { trades, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "neznáma chyba";
    return { trades: [], error: `Chyba pri parsovaní: ${message}` };
  }
}

function emptyAddForm(portfolioId: string): OptionFormState {
  return {
    portfolioId,
    underlying: "",
    optionType: "CALL",
    direction: "SELL",
    strikePrice: "",
    expirationDate: "",
    premium: "",
    contracts: "1",
    commission: "0",
    notes: "",
  };
}

export default function OptionsMobile() {
  const { selectedPortfolioId, portfolios, allPortfolios } = usePortfolio();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editTrade, setEditTrade] = useState<OptionTrade | null>(null);
  const [closeTrade, setCloseTrade] = useState<OptionTrade | null>(null);
  const [deleteTrade, setDeleteTrade] = useState<OptionTrade | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");

  const portfolioScope = selectedPortfolioId && selectedPortfolioId !== "all" ? selectedPortfolioId : "all";
  const defaultPortfolioId =
    selectedPortfolioId && selectedPortfolioId !== "all" ? selectedPortfolioId : portfolios[0]?.id || "";

  const { data: trades, isLoading: tradesLoading } = useQuery<OptionTrade[]>({
    queryKey: ["/api/options", portfolioScope],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const params = new URLSearchParams();
      if (portfolioScope !== "all") params.set("portfolio", portfolioScope);
      const qs = params.toString();
      const url = qs ? `/api/options?${qs}` : "/api/options";
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch options");
      return res.json();
    },
  });

  const { data: stats, isLoading: statsLoading } = useQuery<OptionStats>({
    queryKey: ["/api/options/stats/summary", portfolioScope],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const params = new URLSearchParams();
      if (portfolioScope !== "all") params.set("portfolio", portfolioScope);
      const qs = params.toString();
      const url = qs ? `/api/options/stats/summary?${qs}` : "/api/options/stats/summary";
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch options stats");
      return res.json();
    },
  });

  const invalidateOptionsQueries = () => {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === "string" && key.startsWith("/api/options");
      },
    });
  };

  const createMutation = useMutation({
    mutationFn: async (data: OptionFormState & { expirationDate: string; openDate: string; status: string }) =>
      apiRequest("POST", "/api/options", data),
    onSuccess: () => {
      invalidateOptionsQueries();
      setAddOpen(false);
      toast({ title: "Úspech", description: "Opčný obchod bol pridaný." });
    },
    onError: (error: Error) => {
      toast({ title: "Chyba", description: error.message || "Nepodarilo sa pridať opčný obchod.", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      apiRequest("PATCH", `/api/options/${id}`, data),
    onSuccess: () => {
      invalidateOptionsQueries();
      setEditTrade(null);
      setCloseTrade(null);
      toast({ title: "Úspech", description: "Opčný obchod bol aktualizovaný." });
    },
    onError: (error: Error) => {
      toast({
        title: "Chyba",
        description: error.message || "Nepodarilo sa aktualizovať opčný obchod.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/options/${id}`),
    onSuccess: () => {
      invalidateOptionsQueries();
      setDeleteTrade(null);
      setEditTrade(null);
      toast({ title: "Úspech", description: "Opčný obchod bol vymazaný." });
    },
    onError: (error: Error) => {
      toast({ title: "Chyba", description: error.message || "Nepodarilo sa vymazať opčný obchod.", variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: { trades: ImportedOption[]; portfolioId: string | null }) => {
      const res = await apiRequest("POST", "/api/options/import", data);
      return res.json() as Promise<{ message?: string; imported?: number }>;
    },
    onSuccess: (result) => {
      invalidateOptionsQueries();
      setImportOpen(false);
      toast({
        title: "Import dokončený",
        description: result.message || `Importovaných ${result.imported ?? 0} obchodov.`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Chyba importu", description: error.message || "Nepodarilo sa importovať obchody.", variant: "destructive" });
    },
  });

  const filteredTrades =
    trades?.filter((trade) => {
      if (filter === "open") return trade.status === "OPEN";
      if (filter === "closed") return trade.status !== "OPEN";
      return true;
    }) ?? [];

  const portfolioNameById = new Map((allPortfolios ?? []).map((portfolio) => [portfolio.id, portfolio.name]));
  const tradePortfolioLabel = (trade: OptionTrade) => {
    if (!trade.portfolioId) return "Nezaradené";
    return portfolioNameById.get(trade.portfolioId) || "Neznáme portfólio";
  };

  const portfolioOptions = portfolios.map((portfolio) => ({ value: portfolio.id, label: portfolio.name }));

  const handleExport = () => {
    const exportUrl =
      portfolioScope !== "all"
        ? `/api/options/export?portfolio=${encodeURIComponent(portfolioScope)}`
        : "/api/options/export";
    window.open(exportUrl, "_blank");
  };

  const gain = stats ? parseFloat(stats.totalRealizedGain) : 0;
  const gainTone: StatTone = gain >= 0 ? "Up" : "Down";

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline="Opčné obchody" title="Opcie" />
      <div className="flex flex-col gap-4 px-4 pb-8">
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">Sledovanie opčných obchodov</p>
        <Button className="w-full" onClick={() => setAddOpen(true)}>
          Nová opcia
        </Button>
        <div className="flex gap-2">
          <Button variant="Secondary" className="min-w-0 flex-1 px-2" onClick={() => setImportOpen(true)}>
            Import
          </Button>
          <Button variant="Secondary" className="min-w-0 flex-1 px-2" onClick={handleExport}>
            Export
          </Button>
          <Button variant="Ghost" className="min-w-0 flex-1 px-2" onClick={() => window.open("/api/options/template", "_blank")}>
            Vzorový súbor
          </Button>
        </div>

        {statsLoading ? (
          <p className="text-xs text-[var(--rd-text-secondary)]">Načítavam súhrn…</p>
        ) : stats ? (
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Celkový zisk"
              value={formatUSD(gain)}
              sub={`${formatUSD(parseFloat(stats.totalWins))} / ${formatUSD(parseFloat(stats.totalLosses))}`}
              tone={gainTone}
            />
            <StatTile label="Win rate" value={`${stats.winRate}%`} sub={`${stats.winningTrades}W / ${stats.losingTrades}L`} />
            <StatTile label="Otvorené" value={String(stats.openTrades)} sub={`z ${stats.totalTrades} celkovo`} />
            <StatTile label="Priem. obchod" value={formatUSD(parseFloat(stats.avgWin))} sub={formatUSD(parseFloat(stats.avgLoss))} />
          </div>
        ) : null}

        <Card>
          <SectionHeader title="Opčné obchody" />
          <div className="flex gap-1">
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              Všetky
            </Chip>
            <Chip active={filter === "open"} onClick={() => setFilter("open")}>
              Otvorené
            </Chip>
            <Chip active={filter === "closed"} onClick={() => setFilter("closed")}>
              Uzatvorené
            </Chip>
          </div>

          {tradesLoading ? (
            <p className="text-xs text-[var(--rd-text-secondary)]">Načítavam obchody…</p>
          ) : filteredTrades.length === 0 ? (
            <div className="flex flex-col items-center gap-3">
              <EmptyState
                title={
                  filter === "all"
                    ? "Zatiaľ nemáte žiadne opčné obchody"
                    : filter === "open"
                      ? "Nemáte žiadne otvorené pozície"
                      : "Nemáte žiadne uzatvorené pozície"
                }
                body={
                  portfolioScope !== "all"
                    ? "Obchody označené ako Nezaradené sa zobrazia aj vo vybranom portfóliu."
                    : ""
                }
              />
              {filter === "all" ? (
                <div className="flex w-full gap-2">
                  <Button variant="Secondary" className="min-w-0 flex-1" onClick={() => setAddOpen(true)}>
                    Pridať obchod
                  </Button>
                  <Button variant="Secondary" className="min-w-0 flex-1" onClick={() => setImportOpen(true)}>
                    Importovať
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredTrades.map((trade) => {
                const status = statusMeta(trade.status);
                const closed = trade.status !== "OPEN";
                const realized = parseFloat(trade.realizedGain || "0");
                const expiryDays = daysToExpiry(trade.expirationDate);
                return (
                  <Card
                    key={trade.id}
                    className="cursor-pointer gap-2 p-3"
                    onClick={() => setEditTrade(trade)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setEditTrade(trade);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-medium leading-5">{trade.underlying}</p>
                        <p className="truncate text-xs leading-4 text-[var(--rd-text-tertiary)]">{tradePortfolioLabel(trade)}</p>
                      </div>
                      <p
                        className={`shrink-0 font-mono text-sm font-medium ${
                          !closed
                            ? "text-[var(--rd-text-secondary)]"
                            : realized >= 0
                              ? "text-[var(--rd-profit)]"
                              : "text-[var(--rd-loss)]"
                        }`}
                      >
                        {closed ? formatUSD(realized) : "—"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge label={trade.optionType} tone={trade.optionType === "PUT" ? "Warning" : "Info"} />
                      <Badge label={trade.direction} tone={trade.direction === "SELL" ? "Loss" : "Profit"} />
                      <Badge label={status.label} tone={status.tone} />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs leading-4 text-[var(--rd-text-tertiary)]">
                      <span>
                        Strike{" "}
                        <span className="font-mono font-medium text-[var(--rd-text-primary)]">
                          {formatUSD(parseFloat(trade.strikePrice))}
                        </span>
                      </span>
                      <span>
                        Expirácia{" "}
                        <span className="font-mono font-medium text-[var(--rd-text-primary)]">
                          {format(new Date(trade.expirationDate), "d.M.yyyy", { locale: sk })}
                          {trade.status === "OPEN" ? ` (${expiryDays}d)` : ""}
                        </span>
                      </span>
                    </div>
                    <p className="text-[11px] leading-4 text-[var(--rd-text-tertiary)]">
                      {closed ? "Realizované P/L" : "Otvorená pozícia"} · {trade.contracts} kontr. ·{" "}
                      <span className="font-mono">${parseFloat(trade.premium).toFixed(2)}</span>
                    </p>
                  </Card>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Dialog open={addOpen} title="Pridať opčný obchod" body="Zadajte detaily vášho opčného obchodu" onClose={() => setAddOpen(false)}>
        {addOpen ? (
          <OptionFieldsForm
            initial={emptyAddForm(defaultPortfolioId)}
            portfolios={portfolioOptions}
            pending={createMutation.isPending}
            submitLabel="Pridať obchod"
            onSubmit={(form) =>
              createMutation.mutate({
                ...form,
                expirationDate: new Date(form.expirationDate).toISOString(),
                openDate: new Date().toISOString(),
                status: "OPEN",
              })
            }
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!editTrade}
        title="Upraviť opčný obchod"
        body={editTrade ? `${editTrade.underlying} ${editTrade.direction} ${editTrade.optionType}` : undefined}
        onClose={() => setEditTrade(null)}
      >
        {editTrade ? (
          <EditOptionFields
            trade={editTrade}
            portfolios={portfolioOptions}
            pending={updateMutation.isPending}
            onSubmit={(data) => updateMutation.mutate({ id: editTrade.id, data })}
            onCloseTrade={() => {
              setCloseTrade(editTrade);
              setEditTrade(null);
            }}
            onDelete={() => setDeleteTrade(editTrade)}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!closeTrade}
        title="Uzatvoriť pozíciu"
        body={
          closeTrade
            ? `${closeTrade.underlying} ${closeTrade.direction} ${closeTrade.optionType} @ ${formatUSD(parseFloat(closeTrade.strikePrice))}`
            : undefined
        }
        onClose={() => setCloseTrade(null)}
      >
        {closeTrade ? (
          <CloseOptionFields
            trade={closeTrade}
            pending={updateMutation.isPending}
            onSubmit={(data) => updateMutation.mutate({ id: closeTrade.id, data })}
          />
        ) : null}
      </Dialog>

      <Dialog open={importOpen} title="Importovať opcie" body="Nahrajte CSV súbor s opčnými obchodmi alebo vložte dáta manuálne" onClose={() => setImportOpen(false)}>
        {importOpen ? (
          <ImportOptionsFields
            pending={importMutation.isPending}
            onSubmit={(rows) => {
              const portfolioId = selectedPortfolioId === "all" ? portfolios[0]?.id || null : selectedPortfolioId;
              importMutation.mutate({ trades: rows, portfolioId });
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!deleteTrade}
        title="Vymazať obchod?"
        body={deleteTrade ? `${deleteTrade.underlying} ${deleteTrade.direction} ${deleteTrade.optionType}` : undefined}
        onClose={() => setDeleteTrade(null)}
      >
        <div className="mt-4 flex gap-2">
          <Button variant="Secondary" className="flex-1" onClick={() => setDeleteTrade(null)}>
            Zrušiť
          </Button>
          <Button
            className="flex-1"
            disabled={!deleteTrade || deleteMutation.isPending}
            onClick={() => deleteTrade && deleteMutation.mutate(deleteTrade.id)}
          >
            {deleteMutation.isPending ? "Mažem…" : "Vymazať"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function OptionFieldsForm({
  initial,
  portfolios,
  pending,
  submitLabel,
  onSubmit,
}: {
  initial: OptionFormState;
  portfolios: { value: string; label: string }[];
  pending: boolean;
  submitLabel: string;
  onSubmit: (form: OptionFormState) => void;
}) {
  const [form, setForm] = useState(initial);
  const premiumTotal = parseFloat(form.premium || "0") * 100 * parseInt(form.contracts || "1", 10);

  return (
    <form
      className="mt-3 flex max-h-[65vh] flex-col gap-3 overflow-y-auto"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(form);
      }}
    >
      <Input
        label="Podkladové aktívum"
        placeholder="napr. AAPL"
        value={form.underlying}
        onChange={(event) => setForm((prev) => ({ ...prev, underlying: event.target.value.toUpperCase() }))}
        required
      />
      <Select
        label="Portfólio"
        value={form.portfolioId}
        options={portfolios}
        placeholder="Vybrať portfólio"
        onChange={(value) => setForm((prev) => ({ ...prev, portfolioId: value }))}
      />
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Typ opcie"
          value={form.optionType}
          options={[
            { value: "CALL", label: "CALL" },
            { value: "PUT", label: "PUT" },
          ]}
          onChange={(value) => setForm((prev) => ({ ...prev, optionType: value }))}
        />
        <Select
          label="Smer"
          value={form.direction}
          options={[
            { value: "BUY", label: "BUY (Nákup)" },
            { value: "SELL", label: "SELL (Písanie)" },
          ]}
          onChange={(value) => setForm((prev) => ({ ...prev, direction: value }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Strike cena"
          type="number"
          step="0.01"
          placeholder="0,00"
          value={form.strikePrice}
          onChange={(event) => setForm((prev) => ({ ...prev, strikePrice: event.target.value }))}
          required
        />
        <Input
          label="Dátum expirácie"
          type="date"
          value={form.expirationDate}
          onChange={(event) => setForm((prev) => ({ ...prev, expirationDate: event.target.value }))}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Prémia/akcia"
          type="number"
          step="0.01"
          placeholder="0,00"
          value={form.premium}
          onChange={(event) => setForm((prev) => ({ ...prev, premium: event.target.value }))}
          required
        />
        <Input
          label="Kontrakty"
          type="number"
          min="1"
          value={form.contracts}
          onChange={(event) => setForm((prev) => ({ ...prev, contracts: event.target.value }))}
          required
        />
      </div>
      <Input
        label="Poplatok"
        type="number"
        step="0.01"
        value={form.commission}
        onChange={(event) => setForm((prev) => ({ ...prev, commission: event.target.value }))}
      />
      <Input
        label="Poznámky"
        mono={false}
        placeholder="Voliteľné poznámky…"
        value={form.notes}
        onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
      />
      {form.premium && form.contracts ? (
        <p className="font-mono text-xs leading-4 text-[var(--rd-text-secondary)]">
          Celková prémia: {formatUSD(Number.isFinite(premiumTotal) ? premiumTotal : 0)}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Ukladám…" : submitLabel}
      </Button>
    </form>
  );
}

function EditOptionFields({
  trade,
  portfolios,
  pending,
  onSubmit,
  onCloseTrade,
  onDelete,
}: {
  trade: OptionTrade;
  portfolios: { value: string; label: string }[];
  pending: boolean;
  onSubmit: (data: Record<string, unknown>) => void;
  onCloseTrade: () => void;
  onDelete: () => void;
}) {
  const [form, setForm] = useState<EditFormState>({
    portfolioId: trade.portfolioId || "",
    underlying: trade.underlying,
    optionType: trade.optionType,
    direction: trade.direction,
    strikePrice: trade.strikePrice,
    expirationDate: dateInputValue(trade.expirationDate),
    premium: trade.premium,
    contracts: trade.contracts,
    commission: trade.commission || "0",
    notes: trade.notes || "",
    openDate: dateInputValue(trade.openDate),
    realizedGain: trade.realizedGain || "0",
  });

  return (
    <form
      className="mt-3 flex max-h-[65vh] flex-col gap-3 overflow-y-auto"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          ...form,
          expirationDate: new Date(form.expirationDate).toISOString(),
          openDate: new Date(form.openDate).toISOString(),
        });
      }}
    >
      <Input
        label="Podkladové aktívum"
        value={form.underlying}
        onChange={(event) => setForm((prev) => ({ ...prev, underlying: event.target.value.toUpperCase() }))}
        required
      />
      <Select
        label="Portfólio"
        value={form.portfolioId}
        options={portfolios}
        onChange={(value) => setForm((prev) => ({ ...prev, portfolioId: value }))}
      />
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Typ opcie"
          value={form.optionType}
          options={[
            { value: "CALL", label: "CALL" },
            { value: "PUT", label: "PUT" },
          ]}
          onChange={(value) => setForm((prev) => ({ ...prev, optionType: value }))}
        />
        <Select
          label="Smer"
          value={form.direction}
          options={[
            { value: "BUY", label: "BUY (Nákup)" },
            { value: "SELL", label: "SELL (Písanie)" },
          ]}
          onChange={(value) => setForm((prev) => ({ ...prev, direction: value }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Strike cena"
          type="number"
          step="0.01"
          value={form.strikePrice}
          onChange={(event) => setForm((prev) => ({ ...prev, strikePrice: event.target.value }))}
          required
        />
        <Input
          label="Dátum expirácie"
          type="date"
          value={form.expirationDate}
          onChange={(event) => setForm((prev) => ({ ...prev, expirationDate: event.target.value }))}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Prémia/akcia"
          type="number"
          step="0.01"
          value={form.premium}
          onChange={(event) => setForm((prev) => ({ ...prev, premium: event.target.value }))}
          required
        />
        <Input
          label="Kontrakty"
          type="number"
          min="1"
          value={form.contracts}
          onChange={(event) => setForm((prev) => ({ ...prev, contracts: event.target.value }))}
          required
        />
      </div>
      <Input
        label="Poplatok"
        type="number"
        step="0.01"
        value={form.commission}
        onChange={(event) => setForm((prev) => ({ ...prev, commission: event.target.value }))}
      />
      <Input
        label="Dátum otvorenia"
        type="date"
        value={form.openDate}
        onChange={(event) => setForm((prev) => ({ ...prev, openDate: event.target.value }))}
        required
      />
      {trade.status !== "OPEN" ? (
        <Input
          label="Realizovaný zisk"
          type="number"
          step="0.01"
          value={form.realizedGain}
          onChange={(event) => setForm((prev) => ({ ...prev, realizedGain: event.target.value }))}
        />
      ) : null}
      <Input
        label="Poznámky"
        mono={false}
        value={form.notes}
        onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
      />
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Ukladám…" : "Uložiť zmeny"}
      </Button>
      {trade.status === "OPEN" ? (
        <Button type="button" variant="Secondary" className="w-full" onClick={onCloseTrade}>
          Uzatvoriť pozíciu
        </Button>
      ) : null}
      <Button type="button" variant="Ghost" className="w-full" onClick={onDelete}>
        Vymazať
      </Button>
    </form>
  );
}

function CloseOptionFields({
  trade,
  pending,
  onSubmit,
}: {
  trade: OptionTrade;
  pending: boolean;
  onSubmit: (data: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    status: "CLOSED",
    closePremium: "",
    closeCommission: "0",
    closeDate: new Date().toISOString().split("T")[0] ?? "",
  });

  const pnl = (() => {
    const openPremium = parseFloat(trade.premium);
    const contracts = parseFloat(trade.contracts);
    const openCommission = parseFloat(trade.commission || "0");
    const closePremium = parseFloat(form.closePremium || "0");
    const closeCommission = parseFloat(form.closeCommission || "0");
    if (form.status === "EXPIRED" || form.status === "ASSIGNED") {
      const premiumValue = openPremium * 100 * contracts;
      return trade.direction === "SELL" ? premiumValue - openCommission : -premiumValue - openCommission;
    }
    if (form.status === "CLOSED" && form.closePremium) {
      if (trade.direction === "SELL") {
        return (openPremium - closePremium) * 100 * contracts - openCommission - closeCommission;
      }
      return (closePremium - openPremium) * 100 * contracts - openCommission - closeCommission;
    }
    return 0;
  })();

  return (
    <form
      className="mt-3 flex max-h-[65vh] flex-col gap-3 overflow-y-auto"
      onSubmit={(event) => {
        event.preventDefault();
        const submitData: Record<string, unknown> = {
          status: form.status,
          closeDate: new Date(form.closeDate).toISOString(),
        };
        if (form.status === "CLOSED") {
          submitData.closePremium = form.closePremium;
          submitData.closeCommission = form.closeCommission;
        }
        onSubmit(submitData);
      }}
    >
      <Select
        label="Spôsob uzatvorenia"
        value={form.status}
        options={[
          { value: "CLOSED", label: "Uzatvorená" },
          { value: "EXPIRED", label: "Expirovala bezcenná" },
          { value: "ASSIGNED", label: "Priradená" },
        ]}
        onChange={(value) => setForm((prev) => ({ ...prev, status: value }))}
      />
      {form.status === "CLOSED" ? (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Zatvárajúca prémia/akcia"
            type="number"
            step="0.01"
            value={form.closePremium}
            onChange={(event) => setForm((prev) => ({ ...prev, closePremium: event.target.value }))}
            required
          />
          <Input
            label="Poplatok"
            type="number"
            step="0.01"
            value={form.closeCommission}
            onChange={(event) => setForm((prev) => ({ ...prev, closeCommission: event.target.value }))}
          />
        </div>
      ) : null}
      <Input
        label="Dátum uzatvorenia"
        type="date"
        value={form.closeDate}
        onChange={(event) => setForm((prev) => ({ ...prev, closeDate: event.target.value }))}
        required
      />
      <p className={`font-mono text-sm ${pnl >= 0 ? "text-[var(--rd-profit)]" : "text-[var(--rd-loss)]"}`}>
        Odhadovaný P/L: {pnl >= 0 ? "+" : "−"}
        {formatUSD(Math.abs(pnl))}
      </p>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Ukladám…" : "Uzatvoriť pozíciu"}
      </Button>
    </form>
  );
}

function ImportOptionsFields({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (trades: ImportedOption[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [csvContent, setCsvContent] = useState("");
  const [parsedTrades, setParsedTrades] = useState<ImportedOption[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);

  const applyCsv = (content: string) => {
    const result = parseOptionsCsv(content);
    setParsedTrades(result.trades);
    setParseError(result.error);
  };

  return (
    <form
      className="mt-3 flex max-h-[65vh] flex-col gap-3 overflow-y-auto"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsedTrades.length > 0) onSubmit(parsedTrades);
      }}
    >
      <div className="flex gap-1">
        <Chip active={mode === "file"} onClick={() => setMode("file")}>
          Nahrať súbor
        </Chip>
        <Chip active={mode === "paste"} onClick={() => setMode("paste")}>
          Vložiť CSV
        </Chip>
      </div>
      {mode === "file" ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                const content = String(reader.result ?? "");
                setCsvContent(content);
                applyCsv(content);
              };
              reader.readAsText(file);
            }}
          />
          <Button type="button" variant="Secondary" className="w-full" onClick={() => fileInputRef.current?.click()}>
            Vybrať súbor
          </Button>
        </>
      ) : (
        <>
          <label className="flex flex-col gap-2">
            <span className="text-[13px] font-medium leading-4 text-[var(--rd-text-secondary)]">CSV obsah</span>
            <textarea
              value={csvContent}
              onChange={(event) => setCsvContent(event.target.value)}
              placeholder="underlying,optionType,direction,strikePrice,expirationDate,..."
              className="min-h-28 w-full rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-strong)] bg-[var(--rd-bg-surface-raised)] px-3 py-3 font-mono text-xs leading-4 text-[var(--rd-text-primary)] outline-none placeholder:text-[var(--rd-text-tertiary)]"
            />
          </label>
          <Button type="button" variant="Secondary" onClick={() => applyCsv(csvContent)}>
            Parsovať CSV
          </Button>
        </>
      )}
      {parseError ? <p className="text-xs leading-4 text-[var(--rd-loss)]">{parseError}</p> : null}
      {parsedTrades.length > 0 ? (
        <p className="text-xs leading-4 text-[var(--rd-profit)]">Nájdených {parsedTrades.length} obchodov na import</p>
      ) : null}
      <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">Formát CSV:</p>
      <p className="rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-base)] p-3 font-mono text-xs leading-4 text-[var(--rd-text-secondary)]">
        underlying, optionType, direction, strikePrice, expirationDate, contracts, premium, commission, status, openDate,
        closeDate, closePremium, closeCommission, realizedGain, notes
      </p>
      <button
        type="button"
        className="text-left text-[13px] font-medium leading-4 text-[var(--rd-profit)]"
        onClick={() => window.open("/api/options/template", "_blank")}
      >
        Stiahnuť vzorový súbor
      </button>
      <Button type="submit" className="w-full" disabled={pending || parsedTrades.length === 0}>
        {pending ? "Importujem…" : `Importovať ${parsedTrades.length} obchodov`}
      </Button>
    </form>
  );
}
