import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { startRegistration } from "@simplewebauthn/browser";
import {
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { BROKER_CATALOG } from "@/components/BrokerLogo";
import { useChartSettings, type ChartBenchmarkId, type DailyMoversDisplayCount } from "@/hooks/useChartSettings";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useQuickNavFab } from "@/hooks/useQuickNavFab";
import { useToast } from "@/hooks/use-toast";
import { CHART_BENCHMARK_OPTIONS } from "@/lib/chartBenchmarks";
import { MAX_QUICK_NAV_ITEMS, QUICK_NAV_SECTIONS } from "@/lib/quickNavSections";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Select,
  Toggle,
  TopBar,
} from "@/redesign/ui";
import { BROKER_CODES, type BrokerCode, type Currency } from "@shared/schema";
import { KvRow, PageBody } from "./mobileChrome";

interface ApiSettings {
  preferredCurrency: Currency;
  averageCostDisplayCurrency: Currency | null;
  passkeyStartupLockEnabled: boolean;
}

interface ExchangeRate {
  eurToUsd: number;
  usdToEur: number;
}

interface SnapshotDevPoint {
  date: string;
  totalValueEur: number;
  investedAmountEur: number;
  dailyProfitEur: number;
}

interface SnapshotDevResponse {
  points: SnapshotDevPoint[];
  source?: string;
  startIso?: string;
  endIso?: string;
}

interface PasskeyItem {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  transports: string[];
}

const BROKER_OPTIONS = [
  { value: "none", label: "Žiadny broker" },
  ...BROKER_CODES.map((code) => ({ value: code, label: BROKER_CATALOG[code].name })),
];

const CURRENCY_OPTIONS = [
  { value: "EUR", label: "EUR - Euro" },
  { value: "USD", label: "USD - Americký dolár" },
];

const MOVERS_COUNT_OPTIONS = [
  { value: "1", label: "1" },
  { value: "3", label: "3" },
  { value: "5", label: "5" },
];

const QUICK_NAV_OPTIONS = QUICK_NAV_SECTIONS.map((s) => ({ value: s.path, label: s.label }));

function formatPasskeyDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("sk-SK", { dateStyle: "medium", timeStyle: "short" });
}

function brokerLabel(code: BrokerCode | null) {
  if (!code) return "Žiadny broker";
  return BROKER_CATALOG[code]?.name ?? code;
}

export default function SettingsMobile() {
  const { toast } = useToast();
  const { allPortfolios, createPortfolio, updatePortfolio, deletePortfolio, setPortfolioHidden, reorderPortfolios } =
    usePortfolio();
  const {
    showChart,
    showTooltip,
    showChartBenchmark,
    chartBenchmarkId,
    hideAmounts,
    showNews,
    showDailyMovers,
    dailyMoversCount,
    showAthPopup,
    showCalendarEventsPopup,
    showAnalystRatingPopup,
    setShowChart,
    setShowTooltip,
    setShowChartBenchmark,
    setChartBenchmarkId,
    setHideAmounts,
    setShowNews,
    setShowDailyMovers,
    setDailyMoversCount,
    setShowAthPopup,
    setShowCalendarEventsPopup,
    setShowAnalystRatingPopup,
  } = useChartSettings();
  const {
    enabled: quickNavEnabled,
    items: quickNavItems,
    setEnabled: setQuickNavEnabled,
    setItemPath: setQuickNavItemPath,
    addItem: addQuickNavItem,
    removeItem: removeQuickNavItem,
    maxItems: quickNavMaxItems,
  } = useQuickNavFab();

  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [newPortfolioBroker, setNewPortfolioBroker] = useState<BrokerCode | undefined>(undefined);
  const [editingPortfolio, setEditingPortfolio] = useState<{
    id: string;
    name: string;
    brokerCode: BrokerCode | null;
  } | null>(null);
  const [deletePortfolioId, setDeletePortfolioId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingHiddenId, setTogglingHiddenId] = useState<string | null>(null);
  const [reorderingPortfolio, setReorderingPortfolio] = useState(false);
  const [wipeDialogOpen, setWipeDialogOpen] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState("");
  const [devSnapshotScope, setDevSnapshotScope] = useState<string>("all");
  const [auditDownloadLoading, setAuditDownloadLoading] = useState(false);
  const [auditHelpOpen, setAuditHelpOpen] = useState(false);
  const [deletingPasskeyId, setDeletingPasskeyId] = useState<string | null>(null);
  const passkeysSupported = typeof window !== "undefined" && "PublicKeyCredential" in window;

  const { data: settings, isLoading } = useQuery<ApiSettings>({
    queryKey: ["/api/settings"],
  });

  const { data: passkeysData, isLoading: passkeysLoading } = useQuery<{ passkeys: PasskeyItem[] }>({
    queryKey: ["/api/auth/passkeys"],
  });

  const { data: exchangeRate } = useQuery<ExchangeRate>({
    queryKey: ["/api/exchange-rate"],
    staleTime: 60 * 60 * 1000,
  });

  const {
    data: snapshotDevData,
    isLoading: snapshotDevLoading,
    refetch: refetchSnapshotDev,
  } = useQuery<SnapshotDevResponse>({
    queryKey: ["/api/portfolio/history", "dev", devSnapshotScope],
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("portfolio", devSnapshotScope);
      p.set("range", "all");
      const res = await fetch(`/api/portfolio/history?${p.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Snapshot debug fetch failed");
      return res.json();
    },
    staleTime: 30 * 1000,
  });

  const backfillSnapshotsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/portfolio/history/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ portfolio: devSnapshotScope }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Backfill snapshotov zlyhal");
      }
      return response.json();
    },
    onSuccess: async () => {
      await refetchSnapshotDev();
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio/history"] });
      toast({ title: "Developer", description: "Snapshot backfill dokončený." });
    },
    onError: (error: Error) => {
      toast({
        title: "Developer",
        description: error.message || "Nepodarilo sa spraviť backfill snapshotov.",
        variant: "destructive",
      });
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: {
      preferredCurrency?: Currency;
      averageCostDisplayCurrency?: Currency | null;
      passkeyStartupLockEnabled?: boolean;
    }) => {
      return apiRequest("POST", "/api/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      toast({ title: "Uložené", description: "Nastavenia boli úspešne uložené." });
    },
    onError: () => {
      toast({ title: "Chyba", description: "Nepodarilo sa uložiť nastavenia.", variant: "destructive" });
    },
  });

  const registerPasskeyMutation = useMutation({
    mutationFn: async () => {
      const optionsResponse = await apiRequest("POST", "/api/auth/passkeys/options/register");
      const optionsPayload = (await optionsResponse.json()) as {
        options?: Parameters<typeof startRegistration>[0]["optionsJSON"];
      };
      if (!optionsPayload.options) {
        throw new Error("Server nevrátil challenge pre registráciu passkey.");
      }
      const passkeyResponse = await startRegistration({ optionsJSON: optionsPayload.options });
      await apiRequest("POST", "/api/auth/passkeys/verify/register", { response: passkeyResponse });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/passkeys"] });
      toast({ title: "Passkey pridaný", description: "Prihlásenie cez WebAuthn je pripravené." });
    },
    onError: (error: Error) => {
      toast({
        title: "Registrácia passkey zlyhala",
        description: error.message || "Skúste to znova.",
        variant: "destructive",
      });
    },
  });

  const deletePasskeyMutation = useMutation({
    mutationFn: async (passkeyId: string) => {
      await apiRequest("DELETE", `/api/auth/passkeys/${passkeyId}`);
    },
    onSuccess: async () => {
      setDeletingPasskeyId(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/passkeys"] });
      toast({ title: "Passkey odstránený", description: "Vybraný passkey bol zmazaný." });
    },
    onError: (error: Error) => {
      toast({
        title: "Odstránenie passkey zlyhalo",
        description: error.message || "Skúste to znova.",
        variant: "destructive",
      });
    },
  });

  const wipeAllDataMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/user/transactions/all", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ confirm: "VYMAZAT VSETKO" }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Nepodarilo sa vymazať dáta");
      }
      return response.json() as Promise<{
        transactionsDeleted: number;
        holdingsDeleted: number;
        optionTradesDeleted: number;
      }>;
    },
    onSuccess: (data) => {
      toast({
        title: "Všetko vymazané",
        description: `Vymazaných ${data.transactionsDeleted} transakcií, ${data.holdingsDeleted} holdingov, ${data.optionTradesDeleted} opčných obchodov.`,
      });
      queryClient.clear();
      setWipeDialogOpen(false);
      setWipeConfirmText("");
    },
    onError: (error: Error) => {
      toast({ title: "Chyba", description: error.message, variant: "destructive" });
    },
  });

  const orphanCleanupMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/portfolios/cleanup-orphans", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Nepodarilo sa vyčistiť záznamy");
      }
      return response.json() as Promise<{
        transactionsDeleted: number;
        holdingsDeleted: number;
        optionTradesDeleted: number;
        message: string;
      }>;
    },
    onSuccess: (data) => {
      toast({ title: "Osireté záznamy odstránené", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dividends"] });
      queryClient.invalidateQueries({ queryKey: ["/api/realized-gains"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pnl-breakdown"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/twr"] });
      queryClient.invalidateQueries({ queryKey: ["/api/options"] });
    },
    onError: (error: Error) => {
      toast({ title: "Chyba", description: error.message, variant: "destructive" });
    },
  });

  const recalculateMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/realized-gains/recalculate");
      return response.json() as Promise<{ message?: string }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/realized-gains"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pnl-breakdown"] });
      queryClient.invalidateQueries({ queryKey: ["/api/portfolio-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/twr"] });
      toast({ title: "Hotovo", description: data.message || "Realizované zisky boli prepočítané." });
    },
    onError: () => {
      toast({
        title: "Chyba",
        description: "Nepodarilo sa prepočítať realizované zisky.",
        variant: "destructive",
      });
    },
  });

  const downloadCalculationAudit = async () => {
    setAuditDownloadLoading(true);
    try {
      const res = await fetch(`/api/dev/calculation-audit?portfolio=${encodeURIComponent(devSnapshotScope)}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message || "Nepodarilo sa stiahnuť audit.");
      }
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition");
      let filename = "moneiqwise-vypocet-audit.xlsx";
      const m = cd?.match(/filename="([^"]+)"/);
      if (m?.[1]) filename = m[1];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Stiahnuté", description: "Auditný Excel je pripravený na kontrolu výpočtov." });
    } catch (e) {
      toast({
        title: "Chyba",
        description: e instanceof Error ? e.message : "Nepodarilo sa stiahnuť súbor.",
        variant: "destructive",
      });
    } finally {
      setAuditDownloadLoading(false);
    }
  };

  const handleMovePortfolio = async (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= allPortfolios.length) return;
    const ids = allPortfolios.map((p) => p.id);
    const tmp = ids[index];
    ids[index] = ids[target]!;
    ids[target] = tmp!;
    setReorderingPortfolio(true);
    try {
      await reorderPortfolios(ids);
    } catch (err) {
      const msg =
        err instanceof Error && err.message.trim() ? err.message : "Nepodarilo sa uložiť poradie portfólií.";
      toast({ title: "Chyba", description: msg, variant: "destructive" });
    } finally {
      setReorderingPortfolio(false);
    }
  };

  const handleCreatePortfolio = async () => {
    if (!newPortfolioName.trim()) return;
    setIsCreating(true);
    try {
      await createPortfolio(newPortfolioName.trim(), newPortfolioBroker);
      toast({ title: "Vytvorené", description: "Nové portfólio bolo úspešne vytvorené." });
      setNewPortfolioName("");
      setNewPortfolioBroker(undefined);
    } catch (error) {
      const msg =
        error instanceof Error && error.message.trim() ? error.message : "Nepodarilo sa vytvoriť portfólio.";
      toast({ title: "Chyba", description: msg, variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdatePortfolio = async () => {
    if (!editingPortfolio || !editingPortfolio.name.trim()) return;
    setIsUpdating(true);
    try {
      await updatePortfolio(editingPortfolio.id, editingPortfolio.name.trim(), editingPortfolio.brokerCode);
      toast({ title: "Uložené", description: "Portfólio bolo úspešne aktualizované." });
      setEditingPortfolio(null);
    } catch {
      toast({ title: "Chyba", description: "Nepodarilo sa aktualizovať portfólio.", variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleHidden = async (id: string, currentlyHidden: boolean) => {
    setTogglingHiddenId(id);
    try {
      await setPortfolioHidden(id, !currentlyHidden);
      toast({
        title: currentlyHidden ? "Odkryté" : "Skryté",
        description: currentlyHidden
          ? "Portfólio je opäť viditeľné v celej aplikácii."
          : "Portfólio je skryté. Transakcie ostávajú uložené a môžete ho kedykoľvek odkryť.",
      });
    } catch {
      toast({ title: "Chyba", description: "Nepodarilo sa zmeniť viditeľnosť portfólia.", variant: "destructive" });
    } finally {
      setTogglingHiddenId(null);
    }
  };

  const handleDeletePortfolio = async () => {
    if (!deletePortfolioId) return;
    setIsDeleting(true);
    try {
      await deletePortfolio(deletePortfolioId);
      toast({ title: "Vymazané", description: "Portfólio a všetky jeho transakcie boli vymazané." });
      setDeletePortfolioId(null);
    } catch {
      toast({ title: "Chyba", description: "Nepodarilo sa vymazať portfólio.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const passkeys = passkeysData?.passkeys ?? [];
  const displayCurrency = settings?.preferredCurrency || "EUR";
  const averageCostValue =
    settings?.averageCostDisplayCurrency === "EUR" || settings?.averageCostDisplayCurrency === "USD"
      ? settings.averageCostDisplayCurrency
      : "same-as-display";
  const deleteTarget = allPortfolios.find((p) => p.id === deletePortfolioId);
  const snapshotPoints = (snapshotDevData?.points ?? []).slice(-120);

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline="Údaje" title="Nastavenia" />
      <PageBody className="pb-8">
        <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
          Portfóliá, zobrazenie, menu a mena pre prehľad.
        </p>

        {isLoading ? (
          <p className="rd-type-body text-[var(--rd-text-secondary)]">Načítavam nastavenia…</p>
        ) : (
          <>
            <SettingsSection title="Passkeys (WebAuthn)">
              <Card className="gap-1.5">
                <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                  Prihlasovanie pomocou odtlačku prsta, Face ID alebo PIN-u zariadenia bez zadávania hesla.
                </p>
                {!passkeysSupported ? (
                  <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                    Tento prehliadač alebo zariadenie nepodporuje WebAuthn passkeys.
                  </p>
                ) : null}
                <SettingToggle
                  label="Vyžadovať passkey pri štarte appky"
                  hint="Po otvorení appky sa pred vstupom vyžiada odtlačok/Face ID/PIN."
                  checked={settings?.passkeyStartupLockEnabled !== false}
                  disabled={updateSettingsMutation.isPending}
                  onCheckedChange={(checked) => updateSettingsMutation.mutate({ passkeyStartupLockEnabled: checked })}
                />
                <div className="h-px bg-[var(--rd-border-subtle)]" />
                <KvRow label="Registrované passkeys" value={String(passkeys.length)} />
                <Button
                  variant="Secondary"
                  className="w-full"
                  onClick={() => registerPasskeyMutation.mutate()}
                  disabled={!passkeysSupported || registerPasskeyMutation.isPending}
                  data-testid="button-register-passkey"
                >
                  {registerPasskeyMutation.isPending ? "Registrujem..." : "Pridať passkey"}
                </Button>
                {passkeysLoading ? (
                  <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">Načítavam passkeys...</p>
                ) : passkeys.length === 0 ? (
                  <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">Zatiaľ nemáte žiadny passkey.</p>
                ) : (
                  <div className="flex flex-col">
                    {passkeys.map((passkey, index) => (
                      <div key={passkey.id} className="border-t border-[var(--rd-border-subtle)] py-3 first:border-t-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="rd-type-body-strong">
                              {passkey.label?.trim() || `Passkey #${index + 1}`}
                            </p>
                            <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                              Typ: {passkey.deviceType === "multiDevice" ? "Synchronizovaný" : "Lokálny"} · Záloha:{" "}
                              {passkey.backedUp ? "áno" : "nie"}
                            </p>
                            <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                              Vytvorený: {formatPasskeyDate(passkey.createdAt)}
                            </p>
                            <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                              Naposledy použitý: {formatPasskeyDate(passkey.lastUsedAt)}
                            </p>
                          </div>
                          <Button
                            variant="Secondary"
                            className="shrink-0"
                            disabled={deletePasskeyMutation.isPending && deletingPasskeyId === passkey.id}
                            onClick={() => {
                              setDeletingPasskeyId(passkey.id);
                              deletePasskeyMutation.mutate(passkey.id);
                            }}
                            data-testid={`button-delete-passkey-${passkey.id}`}
                          >
                            {deletePasskeyMutation.isPending && deletingPasskeyId === passkey.id
                              ? "Mažem..."
                              : "Odstrániť"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </SettingsSection>

            <SettingsSection title="Správa portfólií">
              <Card>
                <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                  Vytvárajte a spravujte svoje investičné portfóliá. Poradie v zozname určuje aj poradie v menu
                  aplikácie.
                </p>
                <Input
                  label="Názov nového portfólia"
                  placeholder="napr. Dlhodobé"
                  value={newPortfolioName}
                  onChange={(e) => setNewPortfolioName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleCreatePortfolio()}
                  data-testid="input-new-portfolio-name"
                />
                <Select
                  label="Broker"
                  value={newPortfolioBroker || "none"}
                  options={BROKER_OPTIONS}
                  onChange={(value) => {
                    const code = value === "none" ? undefined : (value as BrokerCode);
                    setNewPortfolioBroker(code);
                    if (code === "silver" && !newPortfolioName.trim()) setNewPortfolioName("Strieborné mince");
                    if (code === "pokemon" && !newPortfolioName.trim()) setNewPortfolioName("Pokémon TCG");
                  }}
                />
                <Button
                  className="w-full"
                  onClick={() => void handleCreatePortfolio()}
                  disabled={!newPortfolioName.trim() || isCreating}
                  data-testid="button-create-portfolio"
                >
                  {isCreating ? "Vytváram..." : "Vytvoriť portfólio"}
                </Button>
                {allPortfolios.length === 0 ? (
                  <EmptyState title="Zatiaľ nemáte žiadne portfóliá." body="Zadajte názov a vytvorte prvé portfólio." />
                ) : (
                  <div className="flex flex-col gap-3 border-t border-[var(--rd-border-subtle)] pt-3">
                    {allPortfolios.map((portfolio, index) => (
                      <div
                        key={portfolio.id}
                        className="flex items-center gap-1.5"
                        data-testid={`portfolio-item-${portfolio.id}`}
                      >
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate rd-type-body-strong ${
                              portfolio.isHidden ? "line-through opacity-70" : ""
                            }`}
                          >
                            {portfolio.name}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {portfolio.isDefault ? <Badge label="Predvolené" tone="Profit" /> : null}
                            {portfolio.isHidden ? <Badge label="Skryté" tone="Neutral" /> : null}
                            <span className="rd-type-body-sm text-[var(--rd-text-tertiary)]">
                              {brokerLabel(portfolio.brokerCode)}
                            </span>
                          </div>
                        </div>
                        <IconButton
                          label="Posunúť nahor"
                          disabled={index === 0 || reorderingPortfolio}
                          onClick={() => void handleMovePortfolio(index, "up")}
                        >
                          <ChevronUp className="size-4" />
                        </IconButton>
                        <IconButton
                          label="Posunúť nadol"
                          disabled={index === allPortfolios.length - 1 || reorderingPortfolio}
                          onClick={() => void handleMovePortfolio(index, "down")}
                        >
                          <ChevronDown className="size-4" />
                        </IconButton>
                        <IconButton
                          label={portfolio.isHidden ? "Odkryť portfólio" : "Skryť portfólio"}
                          disabled={togglingHiddenId === portfolio.id}
                          onClick={() => void handleToggleHidden(portfolio.id, !!portfolio.isHidden)}
                        >
                          {portfolio.isHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </IconButton>
                        <IconButton
                          label="Upraviť portfólio"
                          onClick={() =>
                            setEditingPortfolio({
                              id: portfolio.id,
                              name: portfolio.name,
                              brokerCode: portfolio.brokerCode,
                            })
                          }
                        >
                          <Pencil className="size-4" />
                        </IconButton>
                        {allPortfolios.length > 1 ? (
                          <IconButton label="Vymazať portfólio" onClick={() => setDeletePortfolioId(portfolio.id)}>
                            <Trash2 className="size-4 text-[var(--rd-loss)]" />
                          </IconButton>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </SettingsSection>

            <SettingsSection title="Mena zobrazenia">
              <Card>
                <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                  Mena, v ktorej sa zobrazujú všetky hodnoty. Ceny amerických akcií sa prepočítajú aktuálnym kurzom.
                </p>
                <Select
                  label="Mena"
                  value={displayCurrency}
                  options={CURRENCY_OPTIONS}
                  onChange={(value) => {
                    if (value === "EUR" || value === "USD") {
                      updateSettingsMutation.mutate({ preferredCurrency: value });
                    }
                  }}
                />
                {exchangeRate ? (
                  <KvRow
                    label="Aktuálny kurz (ECB, každú hodinu)"
                    value={`1 EUR = ${exchangeRate.eurToUsd.toFixed(4)} USD`}
                  />
                ) : (
                  <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">Kurz ECB sa načítava…</p>
                )}
              </Card>
            </SettingsSection>

            <SettingsSection title="Priemerné nákupné ceny">
              <Card>
                <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                  Mena, v ktorej sa zobrazí priemerná nákupná cena (prepočet cez kurz z ECB).
                </p>
                <Select
                  label="Mena nákupných cien"
                  value={averageCostValue}
                  options={[
                    { value: "same-as-display", label: `Rovnaká ako mena zobrazenia (${displayCurrency})` },
                    { value: "EUR", label: "EUR — Euro" },
                    { value: "USD", label: "USD — Americký dolár" },
                  ]}
                  onChange={(value) => {
                    if (value === "same-as-display") {
                      updateSettingsMutation.mutate({ averageCostDisplayCurrency: null });
                    } else if (value === "EUR" || value === "USD") {
                      updateSettingsMutation.mutate({ averageCostDisplayCurrency: value });
                    }
                  }}
                />
              </Card>
            </SettingsSection>

            <SettingsSection title="Rýchla navigácia">
              <Card className="gap-1.5">
                <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                  Spodný panel s až {MAX_QUICK_NAV_ITEMS} skratkami do sekcií z menu. Pozícia 5 (Viac) je vždy pevná.
                </p>
                <SettingToggle
                  label="Vlastné položky spodnej navigácie"
                  hint="Zapnite a vyberte až 4 sekcie. Vypnuté = predvolené (Prehľad, Portfóliá, História, AI)."
                  checked={quickNavEnabled}
                  onCheckedChange={setQuickNavEnabled}
                />
                {quickNavEnabled ? (
                  <>
                    <div className="h-px bg-[var(--rd-border-subtle)]" />
                    <p className="rd-type-body-strong">
                      Položky ({quickNavItems.length}/{quickNavMaxItems})
                    </p>
                    <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                      Priraďte každej pozícii inú sekciu. Zmeny sa hneď prejavia v spodnom paneli.
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {quickNavItems.map((path, index) => (
                        <div key={`${path}-${index}`} className="flex items-center gap-1.5">
                          <span className="w-5 shrink-0 rd-type-body-strong text-[var(--rd-text-tertiary)]">
                            {index + 1}.
                          </span>
                          <div className="min-w-0 flex-1">
                            <Select
                              value={path}
                              options={QUICK_NAV_OPTIONS}
                              onChange={(value) => setQuickNavItemPath(index, value)}
                            />
                          </div>
                          <button
                            type="button"
                            aria-label={`Odstrániť položku ${index + 1}`}
                            disabled={quickNavItems.length <= 1}
                            onClick={() => removeQuickNavItem(index)}
                            className="inline-flex size-9 shrink-0 items-center justify-center text-[var(--rd-text-secondary)] disabled:opacity-40"
                            data-testid={`button-quick-nav-remove-${index}`}
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 shrink-0 rd-type-body-strong text-[var(--rd-text-tertiary)]">5.</span>
                        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface)] px-2 py-2 [background-image:var(--rd-bg-surface-gradient)]">
                          <p className="min-w-0 flex-1 rd-type-body text-[var(--rd-text-tertiary)]">Viac</p>
                          <span className="rd-type-data-micro text-[var(--rd-text-tertiary)]">pevné</span>
                        </div>
                        <div className="size-9 shrink-0" />
                      </div>
                    </div>
                    {quickNavItems.length < quickNavMaxItems ? (
                      <Button
                        variant="Secondary"
                        className="w-full"
                        onClick={addQuickNavItem}
                        data-testid="button-quick-nav-add"
                      >
                        <Plus className="size-4" />
                        Pridať položku
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </Card>
            </SettingsSection>

            <SettingsSection title="Zobrazenie na prehľade">
              <Card className="gap-1">
                <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                  Globálne voľby pre Prehľad. Poradie a zapínanie widgetov upravíte aj priamo na Prehľade (ikona pera).
                </p>
                <SettingToggle
                  label="Zobraziť graf"
                  hint="Graf zobrazuje vývoj hodnoty portfólia v čase"
                  checked={showChart}
                  onCheckedChange={setShowChart}
                />
                {showChart ? (
                  <>
                    <SettingToggle
                      label="Interakcia s grafom"
                      hint="Zobraziť hodnotu pri dotyku/kliknutí na graf"
                      checked={showTooltip}
                      onCheckedChange={setShowTooltip}
                    />
                    <SettingToggle
                      label="Porovnanie s indexom"
                      hint="Oranžová krivka vs. portfólio — obidve v % od začiatku obdobia"
                      checked={showChartBenchmark}
                      onCheckedChange={setShowChartBenchmark}
                    />
                    {showChartBenchmark ? (
                      <Select
                        label="Porovnať s"
                        value={chartBenchmarkId}
                        options={CHART_BENCHMARK_OPTIONS.map((opt) => ({ value: opt.id, label: opt.label }))}
                        onChange={(value) => setChartBenchmarkId(value as ChartBenchmarkId)}
                      />
                    ) : null}
                  </>
                ) : null}
                <SettingToggle
                  label="Novinky k vašim aktívam"
                  hint="Sekcia s aktuálnymi správami pre tickery vo vašom portfóliu"
                  checked={showNews}
                  onCheckedChange={setShowNews}
                />
                <SettingToggle
                  label="Najsilnejšie a najslabšie dnes"
                  hint="Rebríček denných % zmien, iba na hlavnom Prehľade"
                  checked={showDailyMovers}
                  onCheckedChange={setShowDailyMovers}
                />
                {showDailyMovers ? (
                  <div className="border-b border-[var(--rd-border-subtle)] py-2">
                    <Select
                      label="Počet pozícií v rebríčku"
                      value={String(dailyMoversCount)}
                      options={MOVERS_COUNT_OPTIONS}
                      onChange={(value) => {
                        const count = Number(value);
                        if (count === 1 || count === 3 || count === 5) {
                          setDailyMoversCount(count as DailyMoversDisplayCount);
                        }
                      }}
                    />
                  </div>
                ) : null}
                <SettingToggle
                  label="Skryť sumy"
                  hint="Nahradiť peňažné hodnoty hviezdičkami (••••••)"
                  checked={hideAmounts}
                  onCheckedChange={setHideAmounts}
                />
                <SettingToggle
                  label="ATH popup po prihlásení"
                  hint="Gratulačné okno, keď portfólio dosiahne nové ATH"
                  checked={showAthPopup}
                  onCheckedChange={setShowAthPopup}
                />
                <SettingToggle
                  label="Popup dnešných udalostí"
                  hint="Okno s dnešnými udalosťami z trhového kalendára"
                  checked={showCalendarEventsPopup}
                  onCheckedChange={setShowCalendarEventsPopup}
                />
                <SettingToggle
                  label="Popup zmeny analyst ratingu"
                  hint="Okno, keď analytik zmení ohodnotenie aktíva vo vašom portfóliu"
                  checked={showAnalystRatingPopup}
                  onCheckedChange={setShowAnalystRatingPopup}
                />
              </Card>
            </SettingsSection>

            <SettingsSection title="Prepočet realizovaného zisku">
              <Card>
                <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                  Prepočíta realizovaný zisk/stratu pre všetky SELL transakcie podľa histórie nákupov. Potrebné len pre
                  staršie transakcie.
                </p>
                <Button
                  variant="Secondary"
                  className="w-full"
                  disabled={recalculateMutation.isPending}
                  onClick={() => recalculateMutation.mutate()}
                  data-testid="button-recalculate-gains"
                >
                  {recalculateMutation.isPending ? "Prepočítavam..." : "Prepočítať realizovaný zisk"}
                </Button>
              </Card>
            </SettingsSection>

            <SettingsSection title="Údržba údajov">
              <Card>
                <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                  Odstráni transakcie, holdingy a opčné obchody, ktoré nie sú prepojené na žiadne portfólio.
                </p>
                <Button
                  variant="Secondary"
                  className="w-full"
                  disabled={orphanCleanupMutation.isPending}
                  onClick={() => orphanCleanupMutation.mutate()}
                  data-testid="button-cleanup-orphans"
                >
                  {orphanCleanupMutation.isPending ? "Čistím…" : "Odstrániť osireté záznamy"}
                </Button>
              </Card>
            </SettingsSection>

            <SettingsSection title="Developer">
              <Card className="gap-1.5">
                <div className="flex items-center gap-1.5">
                  <p className="min-w-0 flex-1 rd-type-body-strong">Audit výpočtov (Excel)</p>
                  <button
                    type="button"
                    aria-label="Čo obsahuje auditný Excel"
                    onClick={() => setAuditHelpOpen(true)}
                    className="inline-flex size-4 shrink-0 items-center justify-center text-[var(--rd-info)]"
                  >
                    <CircleHelp className="size-4" />
                  </button>
                </div>
                <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                  XLSX so všetkými transakciami, denným priebehom MTM a TWR, kurzami ECB a FIFO súhrnmi.
                </p>
                <Button
                  variant="Secondary"
                  className="w-full"
                  disabled={auditDownloadLoading}
                  onClick={() => void downloadCalculationAudit()}
                  data-testid="button-dev-download-calculation-audit"
                >
                  {auditDownloadLoading ? "Generujem…" : "Stiahnuť audit výpočtov"}
                </Button>
                <div className="h-px bg-[var(--rd-border-subtle)]" />
                <Select
                  label="Snapshoty histórie portfólia"
                  value={devSnapshotScope}
                  options={[
                    { value: "all", label: "Všetky portfóliá (all)" },
                    ...allPortfolios.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  onChange={setDevSnapshotScope}
                />
                <div className="flex gap-1.5">
                  <Button
                    variant="Secondary"
                    className="flex-1"
                    disabled={snapshotDevLoading}
                    onClick={() => void refetchSnapshotDev()}
                    data-testid="button-dev-refresh-snapshots"
                  >
                    {snapshotDevLoading ? "Načítavam…" : "Obnoviť"}
                  </Button>
                  <Button
                    variant="Secondary"
                    className="flex-1"
                    disabled={backfillSnapshotsMutation.isPending}
                    onClick={() => backfillSnapshotsMutation.mutate()}
                    data-testid="button-dev-backfill-snapshots"
                  >
                    {backfillSnapshotsMutation.isPending ? "Backfill…" : "Spustiť backfill"}
                  </Button>
                </div>
                <KvRow label="Source" value={snapshotDevData?.source ?? "—"} />
                <KvRow
                  label="Rozsah"
                  value={`${snapshotDevData?.startIso ?? "—"} → ${snapshotDevData?.endIso ?? "—"}`}
                />
                <KvRow label="Počet bodov" value={String(snapshotDevData?.points?.length ?? 0)} />
                {snapshotPoints.length === 0 ? (
                  <EmptyState title="Zatiaľ žiadne snapshot body." body="Obnovte náhľad alebo spustite backfill." />
                ) : (
                  <div className="max-h-64 overflow-auto rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[var(--rd-bg-surface-raised)]">
                        <tr className="text-left text-[var(--rd-text-tertiary)]">
                          <th className="px-2 py-2 font-medium">Dátum</th>
                          <th className="px-2 py-2 text-right font-medium">Total EUR</th>
                          <th className="px-2 py-2 text-right font-medium">Invested</th>
                          <th className="px-2 py-2 text-right font-medium">Daily</th>
                        </tr>
                      </thead>
                      <tbody>
                        {snapshotPoints.map((point) => (
                          <tr key={point.date} className="border-t border-[var(--rd-border-subtle)]">
                            <td className="px-2 py-1.5 font-mono">{point.date}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{point.totalValueEur.toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{point.investedAmountEur.toFixed(2)}</td>
                            <td className="px-2 py-1.5 text-right font-mono">{point.dailyProfitEur.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </SettingsSection>

            <SettingsSection title="Nebezpečná zóna">
              <Card className="border-[var(--rd-loss-dim)]">
                <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                  Nezvratné operácie nad vašimi dátami. Vymaže všetky transakcie, holdingy a opčné obchody naprieč
                  portfóliami; portfóliá a API kľúče zostanú.
                </p>
                <Button
                  variant="Secondary"
                  className="w-full border-[var(--rd-loss)] bg-[var(--rd-loss-dim)] text-[var(--rd-loss)]"
                  onClick={() => {
                    setWipeConfirmText("");
                    setWipeDialogOpen(true);
                  }}
                  data-testid="button-open-wipe-dialog"
                >
                  Vymazať všetky transakcie
                </Button>
              </Card>
            </SettingsSection>
          </>
        )}
      </PageBody>

      <Dialog
        open={!!editingPortfolio}
        title="Upraviť portfólio"
        body="Upravte názov a brokera pre toto portfólio."
        onClose={() => {
          if (!isUpdating) setEditingPortfolio(null);
        }}
      >
        <div className="mt-3 space-y-3">
          <Input
            label="Názov portfólia"
            value={editingPortfolio?.name || ""}
            onChange={(e) => setEditingPortfolio((prev) => (prev ? { ...prev, name: e.target.value } : null))}
            data-testid="input-edit-portfolio-name"
          />
          <Select
            label="Broker"
            value={editingPortfolio?.brokerCode || "none"}
            options={BROKER_OPTIONS}
            onChange={(value) =>
              setEditingPortfolio((prev) =>
                prev ? { ...prev, brokerCode: value === "none" ? null : (value as BrokerCode) } : null,
              )
            }
          />
          <div className="flex gap-2">
            <Button variant="Secondary" className="flex-1" onClick={() => setEditingPortfolio(null)} disabled={isUpdating}>
              Zrušiť
            </Button>
            <Button
              className="flex-1"
              onClick={() => void handleUpdatePortfolio()}
              disabled={!editingPortfolio?.name.trim() || isUpdating}
              data-testid="button-save-portfolio-name"
            >
              {isUpdating ? "Ukladám..." : "Uložiť"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!deletePortfolioId}
        title="Vymazať portfólio"
        onClose={() => {
          if (!isDeleting) setDeletePortfolioId(null);
        }}
      >
        <div className="mt-3 space-y-3">
          <p className="rd-type-body text-[var(--rd-text-secondary)]">
            Naozaj chcete vymazať {deleteTarget ? `„${deleteTarget.name}"` : "toto portfólio"}? Všetky transakcie,
            holdings a opcie v tomto portfóliu budú natrvalo vymazané. Táto akcia je nevratná.
            {deleteTarget?.isDefault
              ? " Keďže ide o hlavné portfólio, automaticky sa ním stane iné z vašich portfólií."
              : ""}{" "}
            Ak chcete dáta len skryť z prehľadu a zachovať ich, použite ikonu oka.
          </p>
          <div className="flex gap-2">
            <Button variant="Secondary" className="flex-1" onClick={() => setDeletePortfolioId(null)} disabled={isDeleting}>
              Zrušiť
            </Button>
            <Button
              variant="Secondary"
              className="flex-1 border-[var(--rd-loss)] bg-[var(--rd-loss-dim)] text-[var(--rd-loss)]"
              onClick={() => void handleDeletePortfolio()}
              disabled={isDeleting}
              data-testid="button-confirm-delete-portfolio"
            >
              {isDeleting ? "Mažem..." : "Vymazať"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={wipeDialogOpen}
        title="Naozaj vymazať všetky dáta?"
        onClose={() => {
          if (!wipeAllDataMutation.isPending) {
            setWipeDialogOpen(false);
            setWipeConfirmText("");
          }
        }}
      >
        <div className="mt-3 space-y-3">
          <p className="rd-type-body text-[var(--rd-text-secondary)]">Touto akciou natrvalo zmažete:</p>
          <ul className="list-disc space-y-1 pl-5 rd-type-body text-[var(--rd-text-secondary)]">
            <li>všetky transakcie (BUY, SELL, dividendy, dane) zo všetkých portfólií</li>
            <li>všetky holdingy (aktuálne pozície)</li>
            <li>všetky opčné obchody</li>
            <li>aj tzv. nezaradené záznamy bez portfólia</li>
          </ul>
          <p className="rd-type-body text-[var(--rd-text-secondary)]">
            Portfóliá, nastavenia meny, API kľúče a prihlásenie zostanú. Po vymazaní môžete naimportovať dáta odznova.
          </p>
          <p className="rd-type-body text-[var(--rd-loss)]">Túto akciu nie je možné vrátiť späť.</p>
          <Input
            label="Na potvrdenie napíšte: VYMAZAT VSETKO"
            value={wipeConfirmText}
            onChange={(e) => setWipeConfirmText(e.target.value)}
            placeholder="VYMAZAT VSETKO"
            disabled={wipeAllDataMutation.isPending}
            data-testid="input-wipe-confirm"
          />
          <div className="flex gap-2">
            <Button
              variant="Secondary"
              className="flex-1"
              disabled={wipeAllDataMutation.isPending}
              onClick={() => {
                setWipeDialogOpen(false);
                setWipeConfirmText("");
              }}
            >
              Zrušiť
            </Button>
            <Button
              variant="Secondary"
              className="flex-1 border-[var(--rd-loss)] bg-[var(--rd-loss-dim)] text-[var(--rd-loss)]"
              disabled={wipeConfirmText.trim() !== "VYMAZAT VSETKO" || wipeAllDataMutation.isPending}
              onClick={() => wipeAllDataMutation.mutate()}
              data-testid="button-confirm-wipe"
            >
              {wipeAllDataMutation.isPending ? "Mažem..." : "Áno, vymazať všetko"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={auditHelpOpen} title="Čo obsahuje auditný Excel" onClose={() => setAuditHelpOpen(false)}>
        <ul className="mt-3 list-disc space-y-2 pl-5 rd-type-body text-[var(--rd-text-secondary)]">
          <li>Meta – portfólio, mena z nastavení, čas generovania, stručná metodika.</li>
          <li>Kurzy_ECB_snapshot – kurzy použité pri exporte (Frankfurter/ECB logika ako pri prepočtoch).</li>
          <li>
            Transakcie – kompletný výpis z DB (dátum, typ, ticker, množstvo, cena, provízia, meny, kurz,
            baseCurrencyAmount, eurPerUnit, realizedGain, externé ID).
          </li>
          <li>
            Denne_MTMTWR – deň po dni: celková hodnota a čisté vklady v zvolenej mene, denný rozdiel, kumulatívne %
            portfólia a S&amp;P.
          </li>
          <li>FIFO – realizácia podľa roka/mesiaca, súhrn podľa tickeru, otvorené loty, celkový súhrn v EUR.</li>
        </ul>
      </Dialog>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <p className="rd-type-overline text-[var(--rd-text-tertiary)]">{title}</p>
      {children}
    </section>
  );
}

function SettingToggle({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--rd-border-subtle)] py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="rd-type-body">{label}</p>
        <p className="rd-type-body-sm text-[var(--rd-text-tertiary)]">{hint}</p>
      </div>
      <Toggle checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} label={label} />
    </div>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--rd-border-subtle)] bg-[var(--rd-bg-surface-raised)] text-[var(--rd-text-secondary)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}
