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
  Trash2,
} from "lucide-react";
import { BROKER_CATALOG } from "@/components/BrokerLogo";
import { useChartSettings, type ChartBenchmarkId, type DailyMoversDisplayCount } from "@/hooks/useChartSettings";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useToast } from "@/hooks/use-toast";
import { CHART_BENCHMARK_OPTIONS } from "@/lib/chartBenchmarks";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  ListRow,
  SectionHeader,
  Select,
  Toggle,
  TopBar,
} from "@/redesign/ui";
import { BROKER_CODES, type BrokerCode, type Currency } from "@shared/schema";

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
  { value: "none", label: "Ĺ˝iadny broker" },
  ...BROKER_CODES.map((code) => ({ value: code, label: BROKER_CATALOG[code].name })),
];

const CURRENCY_OPTIONS = [
  { value: "EUR", label: "EUR - Euro" },
  { value: "USD", label: "USD - AmerickĂ˝ dolĂˇr" },
];

const MOVERS_COUNT_OPTIONS = [
  { value: "1", label: "1" },
  { value: "3", label: "3" },
  { value: "5", label: "5" },
];

function formatPasskeyDate(value: string | null) {
  if (!value) return "â€”";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "â€”";
  return date.toLocaleString("sk-SK", { dateStyle: "medium", timeStyle: "short" });
}

function brokerLabel(code: BrokerCode | null) {
  if (!code) return "Ĺ˝iadny broker";
  return BROKER_CATALOG[code]?.name ?? code;
}

export default function SettingsMobile() {
  const { toast } = useToast();
  const { allPortfolios, createPortfolio, updatePortfolio, deletePortfolio, setPortfolioHidden, reorderPortfolios } = usePortfolio();
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

  const [newPortfolioName, setNewPortfolioName] = useState("");
  const [newPortfolioBroker, setNewPortfolioBroker] = useState<BrokerCode | undefined>(undefined);
  const [editingPortfolio, setEditingPortfolio] = useState<{ id: string; name: string; brokerCode: BrokerCode | null } | null>(null);
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
      toast({ title: "Developer", description: "Snapshot backfill dokonÄŤenĂ˝." });
    },
    onError: (error: Error) => {
      toast({
        title: "Developer",
        description: error.message || "Nepodarilo sa spraviĹĄ backfill snapshotov.",
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
      toast({ title: "UloĹľenĂ©", description: "Nastavenia boli ĂşspeĹˇne uloĹľenĂ©." });
    },
    onError: () => {
      toast({ title: "Chyba", description: "Nepodarilo sa uloĹľiĹĄ nastavenia.", variant: "destructive" });
    },
  });

  const registerPasskeyMutation = useMutation({
    mutationFn: async () => {
      const optionsResponse = await apiRequest("POST", "/api/auth/passkeys/options/register");
      const optionsPayload = (await optionsResponse.json()) as {
        options?: Parameters<typeof startRegistration>[0]["optionsJSON"];
      };
      if (!optionsPayload.options) {
        throw new Error("Server nevrĂˇtil challenge pre registrĂˇciu passkey.");
      }
      const passkeyResponse = await startRegistration({ optionsJSON: optionsPayload.options });
      await apiRequest("POST", "/api/auth/passkeys/verify/register", { response: passkeyResponse });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/passkeys"] });
      toast({ title: "Passkey pridanĂ˝", description: "PrihlĂˇsenie cez WebAuthn je pripravenĂ©." });
    },
    onError: (error: Error) => {
      toast({
        title: "RegistrĂˇcia passkey zlyhala",
        description: error.message || "SkĂşste to znova.",
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
      toast({ title: "Passkey odstrĂˇnenĂ˝", description: "VybranĂ˝ passkey bol zmazanĂ˝." });
    },
    onError: (error: Error) => {
      toast({
        title: "OdstrĂˇnenie passkey zlyhalo",
        description: error.message || "SkĂşste to znova.",
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
        throw new Error(error.message || "Nepodarilo sa vymazaĹĄ dĂˇta");
      }
      return response.json() as Promise<{
        transactionsDeleted: number;
        holdingsDeleted: number;
        optionTradesDeleted: number;
      }>;
    },
    onSuccess: (data) => {
      toast({
        title: "VĹˇetko vymazanĂ©",
        description: `VymazanĂ˝ch ${data.transactionsDeleted} transakciĂ­, ${data.holdingsDeleted} holdingov, ${data.optionTradesDeleted} opÄŤnĂ˝ch obchodov.`,
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
        throw new Error((err as { message?: string }).message || "Nepodarilo sa vyÄŤistiĹĄ zĂˇznamy");
      }
      return response.json() as Promise<{
        transactionsDeleted: number;
        holdingsDeleted: number;
        optionTradesDeleted: number;
        message: string;
      }>;
    },
    onSuccess: (data) => {
      toast({ title: "OsiretĂ© zĂˇznamy odstrĂˇnenĂ©", description: data.message });
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
      toast({ title: "Hotovo", description: data.message || "RealizovanĂ© zisky boli prepoÄŤĂ­tanĂ©." });
    },
    onError: () => {
      toast({
        title: "Chyba",
        description: "Nepodarilo sa prepoÄŤĂ­taĹĄ realizovanĂ© zisky.",
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
        throw new Error((err as { message?: string }).message || "Nepodarilo sa stiahnuĹĄ audit.");
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
      toast({ title: "StiahnutĂ©", description: "AuditnĂ˝ Excel je pripravenĂ˝ na kontrolu vĂ˝poÄŤtov." });
    } catch (e) {
      toast({
        title: "Chyba",
        description: e instanceof Error ? e.message : "Nepodarilo sa stiahnuĹĄ sĂşbor.",
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
      const msg = err instanceof Error && err.message.trim() ? err.message : "Nepodarilo sa uloĹľiĹĄ poradie portfĂłliĂ­.";
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
      toast({ title: "VytvorenĂ©", description: "NovĂ© portfĂłlio bolo ĂşspeĹˇne vytvorenĂ©." });
      setNewPortfolioName("");
      setNewPortfolioBroker(undefined);
    } catch (error) {
      const msg = error instanceof Error && error.message.trim() ? error.message : "Nepodarilo sa vytvoriĹĄ portfĂłlio.";
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
      toast({ title: "UloĹľenĂ©", description: "PortfĂłlio bolo ĂşspeĹˇne aktualizovanĂ©." });
      setEditingPortfolio(null);
    } catch {
      toast({ title: "Chyba", description: "Nepodarilo sa aktualizovaĹĄ portfĂłlio.", variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggleHidden = async (id: string, currentlyHidden: boolean) => {
    setTogglingHiddenId(id);
    try {
      await setPortfolioHidden(id, !currentlyHidden);
      toast({
        title: currentlyHidden ? "OdkrytĂ©" : "SkrytĂ©",
        description: currentlyHidden
          ? "PortfĂłlio je opĂ¤ĹĄ viditeÄľnĂ© v celej aplikĂˇcii."
          : "PortfĂłlio je skrytĂ©. Transakcie ostĂˇvajĂş uloĹľenĂ© a mĂ´Ĺľete ho kedykoÄľvek odkryĹĄ.",
      });
    } catch {
      toast({ title: "Chyba", description: "Nepodarilo sa zmeniĹĄ viditeÄľnosĹĄ portfĂłlia.", variant: "destructive" });
    } finally {
      setTogglingHiddenId(null);
    }
  };

  const handleDeletePortfolio = async () => {
    if (!deletePortfolioId) return;
    setIsDeleting(true);
    try {
      await deletePortfolio(deletePortfolioId);
      toast({ title: "VymazanĂ©", description: "PortfĂłlio a vĹˇetky jeho transakcie boli vymazanĂ©." });
      setDeletePortfolioId(null);
    } catch {
      toast({ title: "Chyba", description: "Nepodarilo sa vymazaĹĄ portfĂłlio.", variant: "destructive" });
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
      <TopBar overline="Ăšdaje" title="Nastavenia" />
      <div className="space-y-4 px-4 pb-6">
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
          PortfĂłliĂˇ, zobrazenie a mena pre prehÄľad.
        </p>

        {isLoading ? (
          <p className="text-sm leading-5 text-[var(--rd-text-secondary)]">NaÄŤĂ­tavam nastaveniaâ€¦</p>
        ) : (
          <>
            <section className="space-y-2">
              <SectionHeader title="Passkeys (WebAuthn)" />
              <Card>
                <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
                  Prihlasovanie pomocou odtlaÄŤku prsta, Face ID alebo PIN-u zariadenia bez zadĂˇvania hesla.
                </p>
                {!passkeysSupported ? (
                  <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
                    Tento prehliadaÄŤ alebo zariadenie nepodporuje WebAuthn passkeys.
                  </p>
                ) : null}
                <SettingToggle
                  label="VyĹľadovaĹĄ passkey pri Ĺˇtarte appky"
                  hint="Po otvorenĂ­ appky sa pred vstupom vyĹľiada odtlaÄŤok/Face ID/PIN."
                  checked={settings?.passkeyStartupLockEnabled !== false}
                  disabled={updateSettingsMutation.isPending}
                  onCheckedChange={(checked) => updateSettingsMutation.mutate({ passkeyStartupLockEnabled: checked })}
                />
                <ListRow label="RegistrovanĂ© passkeys" value={String(passkeys.length)} showChevron={false} />
                <Button
                  variant="Secondary"
                  className="w-full"
                  onClick={() => registerPasskeyMutation.mutate()}
                  disabled={!passkeysSupported || registerPasskeyMutation.isPending}
                  data-testid="button-register-passkey"
                >
                  {registerPasskeyMutation.isPending ? "Registrujem..." : "PridaĹĄ passkey"}
                </Button>
                {passkeysLoading ? (
                  <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">NaÄŤĂ­tavam passkeys...</p>
                ) : passkeys.length === 0 ? (
                  <EmptyState title="ZatiaÄľ nemĂˇte Ĺľiadny passkey." body="Pridajte passkey tlaÄŤidlom vyĹˇĹˇie." />
                ) : (
                  <div className="flex flex-col">
                    {passkeys.map((passkey, index) => (
                      <div key={passkey.id} className="border-t border-[var(--rd-border-subtle)] py-3 first:border-t-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold leading-5">{passkey.label?.trim() || `Passkey #${index + 1}`}</p>
                            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
                              Typ: {passkey.deviceType === "multiDevice" ? "SynchronizovanĂ˝" : "LokĂˇlny"} Â· ZĂˇloha:{" "}
                              {passkey.backedUp ? "Ăˇno" : "nie"}
                            </p>
                            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
                              VytvorenĂ˝: {formatPasskeyDate(passkey.createdAt)}
                            </p>
                            <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">
                              Naposledy pouĹľitĂ˝: {formatPasskeyDate(passkey.lastUsedAt)}
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
                            {deletePasskeyMutation.isPending && deletingPasskeyId === passkey.id ? "MaĹľem..." : "OdstrĂˇniĹĄ"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </section>

            <section className="space-y-2">
              <SectionHeader title="SprĂˇva portfĂłliĂ­" />
              <Card>
                <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
                  VytvĂˇrajte a spravujte svoje investiÄŤnĂ© portfĂłliĂˇ. Poradie v zozname urÄŤuje aj poradie v menu aplikĂˇcie.
                </p>
                <Input
                  label="NĂˇzov novĂ©ho portfĂłlia"
                  placeholder="napr. DlhodobĂ©"
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
                    if (code === "silver" && !newPortfolioName.trim()) setNewPortfolioName("StriebornĂ© mince");
                    if (code === "pokemon" && !newPortfolioName.trim()) setNewPortfolioName("PokĂ©mon TCG");
                  }}
                />
                <Button
                  className="w-full"
                  onClick={() => void handleCreatePortfolio()}
                  disabled={!newPortfolioName.trim() || isCreating}
                  data-testid="button-create-portfolio"
                >
                  {isCreating ? "VytvĂˇram..." : "VytvoriĹĄ portfĂłlio"}
                </Button>
                {allPortfolios.length === 0 ? (
                  <EmptyState title="ZatiaÄľ nemĂˇte Ĺľiadne portfĂłliĂˇ." body="Zadajte nĂˇzov a vytvorte prvĂ© portfĂłlio." />
                ) : (
                  <div className="flex flex-col gap-3 border-t border-[var(--rd-border-subtle)] pt-3">
                    {allPortfolios.map((portfolio, index) => (
                      <div key={portfolio.id} className="flex items-center gap-2" data-testid={`portfolio-item-${portfolio.id}`}>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm font-semibold leading-5 ${portfolio.isHidden ? "line-through opacity-70" : ""}`}>
                            {portfolio.name}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {portfolio.isDefault ? <Badge label="PredvolenĂ©" tone="Profit" /> : null}
                            {portfolio.isHidden ? <Badge label="SkrytĂ©" tone="Neutral" /> : null}
                            <span className="text-xs leading-4 text-[var(--rd-text-tertiary)]">{brokerLabel(portfolio.brokerCode)}</span>
                          </div>
                        </div>
                        <IconButton
                          label="PosunĂşĹĄ nahor"
                          disabled={index === 0 || reorderingPortfolio}
                          onClick={() => void handleMovePortfolio(index, "up")}
                        >
                          <ChevronUp className="size-4" />
                        </IconButton>
                        <IconButton
                          label="PosunĂşĹĄ nadol"
                          disabled={index === allPortfolios.length - 1 || reorderingPortfolio}
                          onClick={() => void handleMovePortfolio(index, "down")}
                        >
                          <ChevronDown className="size-4" />
                        </IconButton>
                        <IconButton
                          label={portfolio.isHidden ? "OdkryĹĄ portfĂłlio" : "SkryĹĄ portfĂłlio"}
                          disabled={togglingHiddenId === portfolio.id}
                          onClick={() => void handleToggleHidden(portfolio.id, !!portfolio.isHidden)}
                        >
                          {portfolio.isHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </IconButton>
                        <IconButton
                          label="UpraviĹĄ portfĂłlio"
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
                          <IconButton label="VymazaĹĄ portfĂłlio" onClick={() => setDeletePortfolioId(portfolio.id)}>
                            <Trash2 className="size-4 text-[var(--rd-loss)]" />
                          </IconButton>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </section>

            <section className="space-y-2">
              <SectionHeader title="Mena zobrazenia" />
              <Card>
                <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
                  Mena, v ktorej sa zobrazujĂş vĹˇetky hodnoty. Ceny americkĂ˝ch akciĂ­ sa prepoÄŤĂ­tajĂş aktuĂˇlnym kurzom.
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
                  <ListRow
                    label="AktuĂˇlny kurz (ECB, kaĹľdĂş hodinu)"
                    value={`1 EUR = ${exchangeRate.eurToUsd.toFixed(4)} USD`}
                    showChevron={false}
                  />
                ) : (
                  <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">Kurz ECB sa naÄŤĂ­tavaâ€¦</p>
                )}
              </Card>
            </section>

            <section className="space-y-2">
              <SectionHeader title="PriemernĂ© nĂˇkupnĂ© ceny" />
              <Card>
                <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
                  Mena, v ktorej sa zobrazĂ­ priemernĂˇ nĂˇkupnĂˇ cena (prepoÄŤet cez kurz z ECB).
                </p>
                <Select
                  label="Mena nĂˇkupnĂ˝ch cien"
                  value={averageCostValue}
                  options={[
                    { value: "same-as-display", label: `RovnakĂˇ ako mena zobrazenia (${displayCurrency})` },
                    { value: "EUR", label: "EUR â€” Euro" },
                    { value: "USD", label: "USD â€” AmerickĂ˝ dolĂˇr" },
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
            </section>

            <section className="space-y-2">
              <SectionHeader title="Zobrazenie na prehÄľade" />
              <Card>
                <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
                  GlobĂˇlne voÄľby pre PrehÄľad. Poradie a zapĂ­nanie widgetov upravĂ­te aj priamo na PrehÄľade (ikona pera).
                </p>
                <SettingToggle
                  label="ZobraziĹĄ graf"
                  hint="Graf zobrazuje vĂ˝voj hodnoty portfĂłlia v ÄŤase"
                  checked={showChart}
                  onCheckedChange={setShowChart}
                />
                {showChart ? (
                  <>
                    <SettingToggle
                      label="Interakcia s grafom"
                      hint="ZobraziĹĄ hodnotu pri dotyku/kliknutĂ­ na graf"
                      checked={showTooltip}
                      onCheckedChange={setShowTooltip}
                    />
                    <SettingToggle
                      label="Porovnanie s indexom"
                      hint="OranĹľovĂˇ krivka vs. portfĂłlio â€” obidve v % od zaÄŤiatku obdobia"
                      checked={showChartBenchmark}
                      onCheckedChange={setShowChartBenchmark}
                    />
                    {showChartBenchmark ? (
                      <Select
                        label="PorovnaĹĄ s"
                        value={chartBenchmarkId}
                        options={CHART_BENCHMARK_OPTIONS.map((opt) => ({ value: opt.id, label: opt.label }))}
                        onChange={(value) => setChartBenchmarkId(value as ChartBenchmarkId)}
                      />
                    ) : null}
                  </>
                ) : null}
                <SettingToggle
                  label="Novinky k vaĹˇim aktĂ­vam"
                  hint="Sekcia s aktuĂˇlnymi sprĂˇvami pre tickery vo vaĹˇom portfĂłliu"
                  checked={showNews}
                  onCheckedChange={setShowNews}
                />
                <SettingToggle
                  label="NajsilnejĹˇie a najslabĹˇie dnes"
                  hint="RebrĂ­ÄŤek dennĂ˝ch % zmien, iba na hlavnom PrehÄľade"
                  checked={showDailyMovers}
                  onCheckedChange={setShowDailyMovers}
                />
                {showDailyMovers ? (
                  <Select
                    label="PoÄŤet pozĂ­ciĂ­ v rebrĂ­ÄŤku"
                    value={String(dailyMoversCount)}
                    options={MOVERS_COUNT_OPTIONS}
                    onChange={(value) => {
                      const count = Number(value);
                      if (count === 1 || count === 3 || count === 5) {
                        setDailyMoversCount(count as DailyMoversDisplayCount);
                      }
                    }}
                  />
                ) : null}
                <SettingToggle
                  label="SkryĹĄ sumy"
                  hint="NahradiĹĄ peĹaĹľnĂ© hodnoty hviezdiÄŤkami (â€˘â€˘â€˘â€˘â€˘â€˘)"
                  checked={hideAmounts}
                  onCheckedChange={setHideAmounts}
                />
                <SettingToggle
                  label="ATH popup po prihlĂˇsenĂ­"
                  hint="GratulaÄŤnĂ© okno, keÄŹ portfĂłlio dosiahne novĂ© ATH"
                  checked={showAthPopup}
                  onCheckedChange={setShowAthPopup}
                />
                <SettingToggle
                  label="Popup dneĹˇnĂ˝ch udalostĂ­"
                  hint="Okno s dneĹˇnĂ˝mi udalosĹĄami z trhovĂ©ho kalendĂˇra"
                  checked={showCalendarEventsPopup}
                  onCheckedChange={setShowCalendarEventsPopup}
                />
                <SettingToggle
                  label="Popup zmeny analyst ratingu"
                  hint="Okno, keÄŹ analytik zmenĂ­ ohodnotenie aktĂ­va vo vaĹˇom portfĂłliu"
                  checked={showAnalystRatingPopup}
                  onCheckedChange={setShowAnalystRatingPopup}
                />
              </Card>
            </section>

            <section className="space-y-2">
              <SectionHeader title="PrepoÄŤet realizovanĂ©ho zisku" />
              <Card>
                <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
                  PrepoÄŤĂ­ta realizovanĂ˝ zisk/stratu pre vĹˇetky SELL transakcie podÄľa histĂłrie nĂˇkupov. PotrebnĂ© len pre starĹˇie transakcie.
                </p>
                <Button
                  variant="Secondary"
                  className="w-full"
                  disabled={recalculateMutation.isPending}
                  onClick={() => recalculateMutation.mutate()}
                  data-testid="button-recalculate-gains"
                >
                  {recalculateMutation.isPending ? "PrepoÄŤĂ­tavam..." : "PrepoÄŤĂ­taĹĄ realizovanĂ˝ zisk"}
                </Button>
              </Card>
            </section>

            <section className="space-y-2">
              <SectionHeader title="ĂšdrĹľba Ăşdajov" />
              <Card>
                <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
                  OdstrĂˇni transakcie, holdingy a opÄŤnĂ© obchody, ktorĂ© nie sĂş prepojenĂ© na Ĺľiadne portfĂłlio. AktĂ­vne portfĂłliĂˇ a ich riadky ostanĂş.
                </p>
                <Button
                  variant="Secondary"
                  className="w-full"
                  disabled={orphanCleanupMutation.isPending}
                  onClick={() => orphanCleanupMutation.mutate()}
                  data-testid="button-cleanup-orphans"
                >
                  {orphanCleanupMutation.isPending ? "ÄŚistĂ­mâ€¦" : "OdstrĂˇniĹĄ osiretĂ© zĂˇznamy"}
                </Button>
              </Card>
            </section>

            <section className="space-y-2">
              <SectionHeader title="Developer" />
              <Card>
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 text-sm font-semibold leading-5">Audit vĂ˝poÄŤtov (Excel)</p>
                  <button
                    type="button"
                    aria-label="ÄŚo obsahuje auditnĂ˝ Excel"
                    onClick={() => setAuditHelpOpen(true)}
                    className="inline-flex size-[30px] items-center justify-center text-[var(--rd-info)]"
                  >
                    <CircleHelp className="size-4" />
                  </button>
                </div>
                <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
                  XLSX so vĹˇetkĂ˝mi transakciami, dennĂ˝m priebehom MTM a TWR, kurzami ECB a FIFO sĂşhrnmi.
                </p>
                <Button
                  variant="Secondary"
                  className="w-full"
                  disabled={auditDownloadLoading}
                  onClick={() => void downloadCalculationAudit()}
                  data-testid="button-dev-download-calculation-audit"
                >
                  {auditDownloadLoading ? "Generujemâ€¦" : "StiahnuĹĄ audit vĂ˝poÄŤtov"}
                </Button>
                <Select
                  label="Snapshoty histĂłrie portfĂłlia"
                  value={devSnapshotScope}
                  options={[
                    { value: "all", label: "VĹˇetky portfĂłliĂˇ (all)" },
                    ...allPortfolios.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  onChange={setDevSnapshotScope}
                />
                <div className="flex gap-2">
                  <Button
                    variant="Secondary"
                    className="flex-1"
                    disabled={snapshotDevLoading}
                    onClick={() => void refetchSnapshotDev()}
                    data-testid="button-dev-refresh-snapshots"
                  >
                    {snapshotDevLoading ? "NaÄŤĂ­tavamâ€¦" : "ObnoviĹĄ"}
                  </Button>
                  <Button
                    variant="Secondary"
                    className="flex-1"
                    disabled={backfillSnapshotsMutation.isPending}
                    onClick={() => backfillSnapshotsMutation.mutate()}
                    data-testid="button-dev-backfill-snapshots"
                  >
                    {backfillSnapshotsMutation.isPending ? "Backfillâ€¦" : "SpustiĹĄ backfill"}
                  </Button>
                </div>
                <ListRow label="Source" value={snapshotDevData?.source ?? "â€”"} showChevron={false} />
                <ListRow
                  label="Rozsah"
                  value={`${snapshotDevData?.startIso ?? "â€”"} â†’ ${snapshotDevData?.endIso ?? "â€”"}`}
                  showChevron={false}
                />
                <ListRow label="PoÄŤet bodov" value={String(snapshotDevData?.points?.length ?? 0)} showChevron={false} />
                {snapshotPoints.length === 0 ? (
                  <EmptyState title="ZatiaÄľ Ĺľiadne snapshot body." body="Obnovte nĂˇhÄľad alebo spustite backfill." />
                ) : (
                  <div className="max-h-64 overflow-auto rounded-[var(--rd-radius-sm)] border border-[var(--rd-border-subtle)]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-[var(--rd-bg-surface-raised)]">
                        <tr className="text-left text-[var(--rd-text-tertiary)]">
                          <th className="px-2 py-2 font-medium">DĂˇtum</th>
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
            </section>

            <section className="space-y-2">
              <SectionHeader title="NebezpeÄŤnĂˇ zĂłna" />
              <Card className="border-[var(--rd-loss-dim)]">
                <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
                  NezvratnĂ© operĂˇcie nad vaĹˇimi dĂˇtami. VymaĹľe vĹˇetky transakcie, holdingy a opÄŤnĂ© obchody naprieÄŤ portfĂłliami; portfĂłliĂˇ a API kÄľĂşÄŤe zostanĂş.
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
                  VymazaĹĄ vĹˇetky transakcie
                </Button>
              </Card>
            </section>
          </>
        )}
      </div>

      <Dialog
        open={!!editingPortfolio}
        title="UpraviĹĄ portfĂłlio"
        body="Upravte nĂˇzov a brokera pre toto portfĂłlio."
        onClose={() => {
          if (!isUpdating) setEditingPortfolio(null);
        }}
      >
        <div className="mt-3 space-y-3">
          <Input
            label="NĂˇzov portfĂłlia"
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
              ZruĹˇiĹĄ
            </Button>
            <Button
              className="flex-1"
              onClick={() => void handleUpdatePortfolio()}
              disabled={!editingPortfolio?.name.trim() || isUpdating}
              data-testid="button-save-portfolio-name"
            >
              {isUpdating ? "UkladĂˇm..." : "UloĹľiĹĄ"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!deletePortfolioId}
        title="VymazaĹĄ portfĂłlio"
        onClose={() => {
          if (!isDeleting) setDeletePortfolioId(null);
        }}
      >
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-5 text-[var(--rd-text-secondary)]">
            Naozaj chcete vymazaĹĄ {deleteTarget ? `â€ž${deleteTarget.name}"` : "toto portfĂłlio"}? VĹˇetky transakcie, holdings a opcie v tomto portfĂłliu budĂş natrvalo vymazanĂ©. TĂˇto akcia je nevratnĂˇ.
            {deleteTarget?.isDefault
              ? " KeÄŹĹľe ide o hlavnĂ© portfĂłlio, automaticky sa nĂ­m stane inĂ© z vaĹˇich portfĂłliĂ­."
              : ""}{" "}
            Ak chcete dĂˇta len skryĹĄ z prehÄľadu a zachovaĹĄ ich, pouĹľite ikonu oka.
          </p>
          <div className="flex gap-2">
            <Button variant="Secondary" className="flex-1" onClick={() => setDeletePortfolioId(null)} disabled={isDeleting}>
              ZruĹˇiĹĄ
            </Button>
            <Button
              variant="Secondary"
              className="flex-1 border-[var(--rd-loss)] bg-[var(--rd-loss-dim)] text-[var(--rd-loss)]"
              onClick={() => void handleDeletePortfolio()}
              disabled={isDeleting}
              data-testid="button-confirm-delete-portfolio"
            >
              {isDeleting ? "MaĹľem..." : "VymazaĹĄ"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={wipeDialogOpen}
        title="Naozaj vymazaĹĄ vĹˇetky dĂˇta?"
        onClose={() => {
          if (!wipeAllDataMutation.isPending) {
            setWipeDialogOpen(false);
            setWipeConfirmText("");
          }
        }}
      >
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-5 text-[var(--rd-text-secondary)]">Touto akciou natrvalo zmaĹľete:</p>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-5 text-[var(--rd-text-secondary)]">
            <li>vĹˇetky transakcie (BUY, SELL, dividendy, dane) zo vĹˇetkĂ˝ch portfĂłliĂ­</li>
            <li>vĹˇetky holdingy (aktuĂˇlne pozĂ­cie)</li>
            <li>vĹˇetky opÄŤnĂ© obchody</li>
            <li>aj tzv. nezaradenĂ© zĂˇznamy bez portfĂłlia</li>
          </ul>
          <p className="text-sm leading-5 text-[var(--rd-text-secondary)]">
            PortfĂłliĂˇ, nastavenia meny, API kÄľĂşÄŤe a prihlĂˇsenie zostanĂş. Po vymazanĂ­ mĂ´Ĺľete naimportovaĹĄ dĂˇta odznova.
          </p>
          <p className="text-sm leading-5 text-[var(--rd-loss)]">TĂşto akciu nie je moĹľnĂ© vrĂˇtiĹĄ spĂ¤ĹĄ.</p>
          <Input
            label="Na potvrdenie napĂ­Ĺˇte: VYMAZAT VSETKO"
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
              ZruĹˇiĹĄ
            </Button>
            <Button
              variant="Secondary"
              className="flex-1 border-[var(--rd-loss)] bg-[var(--rd-loss-dim)] text-[var(--rd-loss)]"
              disabled={wipeConfirmText.trim() !== "VYMAZAT VSETKO" || wipeAllDataMutation.isPending}
              onClick={() => wipeAllDataMutation.mutate()}
              data-testid="button-confirm-wipe"
            >
              {wipeAllDataMutation.isPending ? "MaĹľem..." : "Ăno, vymazaĹĄ vĹˇetko"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={auditHelpOpen} title="ÄŚo obsahuje auditnĂ˝ Excel" onClose={() => setAuditHelpOpen(false)}>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-5 text-[var(--rd-text-secondary)]">
          <li>Meta â€“ portfĂłlio, mena z nastavenĂ­, ÄŤas generovania, struÄŤnĂˇ metodika.</li>
          <li>Kurzy_ECB_snapshot â€“ kurzy pouĹľitĂ© pri exporte (Frankfurter/ECB logika ako pri prepoÄŤtoch).</li>
          <li>
            Transakcie â€“ kompletnĂ˝ vĂ˝pis z DB (dĂˇtum, typ, ticker, mnoĹľstvo, cena, provĂ­zia, meny, kurz, baseCurrencyAmount, eurPerUnit, realizedGain, externĂ© ID).
          </li>
          <li>
            Denne_MTMTWR â€“ deĹ po dni: celkovĂˇ hodnota a ÄŤistĂ© vklady v zvolenej mene, dennĂ˝ rozdiel, kumulatĂ­vne % portfĂłlia a S&amp;P.
          </li>
          <li>FIFO â€“ realizĂˇcia podÄľa roka/mesiaca, sĂşhrn podÄľa tickeru, otvorenĂ© loty, celkovĂ˝ sĂşhrn v EUR.</li>
        </ul>
      </Dialog>
    </div>
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
    <div className="flex items-center gap-3 border-b border-[var(--rd-border-subtle)] py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5">{label}</p>
        <p className="text-xs leading-4 text-[var(--rd-text-tertiary)]">{hint}</p>
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
