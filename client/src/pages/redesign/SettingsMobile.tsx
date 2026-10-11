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
import {
  formatCategoryCashSum,
  groupPortfoliosByCategory,
  PORTFOLIO_CATEGORY_COLORS,
  type PortfolioCategoryColor,
} from "@/lib/portfolioCategories";
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

const NEW_CATEGORY_OPTION = "__new_category__";

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
  const {
    allPortfolios,
    categories,
    createPortfolio,
    updatePortfolio,
    setPortfolioCategory,
    deletePortfolio,
    setPortfolioHidden,
    reorderPortfolios,
    createCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
  } = usePortfolio();
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
  const [newPortfolioCategoryId, setNewPortfolioCategoryId] = useState<string>("none");
  const [editingPortfolio, setEditingPortfolio] = useState<{
    id: string;
    name: string;
    brokerCode: BrokerCode | null;
    categoryId: string | null;
  } | null>(null);
  const [deletePortfolioId, setDeletePortfolioId] = useState<string | null>(null);
  const [movingPortfolioId, setMovingPortfolioId] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] = useState<{
    id: string | null;
    name: string;
    color: PortfolioCategoryColor;
    afterCreateAssignPortfolioId?: string | null;
    afterCreateTarget: "newPortfolio" | "editPortfolio" | "move" | null;
  } | null>(null);
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [reorderingCategory, setReorderingCategory] = useState(false);
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

  const handleMoveCategory = async (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= categories.length) return;
    const ids = categories.map((c) => c.id);
    const tmp = ids[index];
    ids[index] = ids[target]!;
    ids[target] = tmp!;
    setReorderingCategory(true);
    try {
      await reorderCategories(ids);
    } catch (err) {
      const msg =
        err instanceof Error && err.message.trim() ? err.message : "Nepodarilo sa uložiť poradie kategórií.";
      toast({ title: "Chyba", description: msg, variant: "destructive" });
    } finally {
      setReorderingCategory(false);
    }
  };

  const openNewCategory = (opts?: {
    afterCreateAssignPortfolioId?: string | null;
    afterCreateTarget?: "newPortfolio" | "editPortfolio" | "move" | null;
  }) => {
    setCategoryForm({
      id: null,
      name: "",
      color: PORTFOLIO_CATEGORY_COLORS[0],
      afterCreateAssignPortfolioId: opts?.afterCreateAssignPortfolioId ?? null,
      afterCreateTarget: opts?.afterCreateTarget ?? null,
    });
  };

  const handleCreatePortfolio = async () => {
    if (!newPortfolioName.trim()) return;
    setIsCreating(true);
    try {
      const catId = newPortfolioCategoryId === "none" ? null : newPortfolioCategoryId;
      await createPortfolio(newPortfolioName.trim(), newPortfolioBroker, catId);
      toast({ title: "Vytvorené", description: "Nové portfólio bolo úspešne vytvorené." });
      setNewPortfolioName("");
      setNewPortfolioBroker(undefined);
      setNewPortfolioCategoryId("none");
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
      await updatePortfolio(
        editingPortfolio.id,
        editingPortfolio.name.trim(),
        editingPortfolio.brokerCode,
        editingPortfolio.categoryId,
      );
      toast({ title: "Uložené", description: "Portfólio bolo úspešne aktualizované." });
      setEditingPortfolio(null);
    } catch {
      toast({ title: "Chyba", description: "Nepodarilo sa aktualizovať portfólio.", variant: "destructive" });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveCategory = async () => {
    if (!categoryForm || !categoryForm.name.trim()) {
      toast({ title: "Chyba", description: "Zadajte názov kategórie.", variant: "destructive" });
      return;
    }
    setIsSavingCategory(true);
    try {
      if (categoryForm.id) {
        await updateCategory(categoryForm.id, categoryForm.name.trim(), categoryForm.color);
        toast({ title: "Uložené", description: "Kategória bola aktualizovaná." });
      } else {
        const created = await createCategory(categoryForm.name.trim(), categoryForm.color);
        toast({ title: "Vytvorené", description: "Nová kategória bola vytvorená." });
        if (categoryForm.afterCreateTarget === "newPortfolio") {
          setNewPortfolioCategoryId(created.id);
        } else if (categoryForm.afterCreateTarget === "editPortfolio" && editingPortfolio) {
          setEditingPortfolio({ ...editingPortfolio, categoryId: created.id });
        } else if (categoryForm.afterCreateTarget === "move" && categoryForm.afterCreateAssignPortfolioId) {
          await setPortfolioCategory(categoryForm.afterCreateAssignPortfolioId, created.id);
          setMovingPortfolioId(null);
        }
      }
      setCategoryForm(null);
    } catch (error) {
      const msg =
        error instanceof Error && error.message.trim() ? error.message : "Nepodarilo sa uložiť kategóriu.";
      toast({ title: "Chyba", description: msg, variant: "destructive" });
    } finally {
      setIsSavingCategory(false);
    }
  };

  const handleDeleteCategory = async () => {
    if (!deleteCategoryId) return;
    setIsDeleting(true);
    try {
      await deleteCategory(deleteCategoryId);
      toast({
        title: "Vymazané",
        description: "Kategória bola vymazaná. Portfóliá ostali v Bez kategórie.",
      });
      setDeleteCategoryId(null);
    } catch {
      toast({ title: "Chyba", description: "Nepodarilo sa vymazať kategóriu.", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAssignCategory = async (portfolioId: string, categoryId: string | null) => {
    try {
      await setPortfolioCategory(portfolioId, categoryId);
      setMovingPortfolioId(null);
      toast({ title: "Presunuté", description: "Portfólio bolo priradené do kategórie." });
    } catch {
      toast({ title: "Chyba", description: "Nepodarilo sa presunúť portfólio.", variant: "destructive" });
    }
  };

  const categorySelectOptions = [
    { value: "none", label: "Bez kategórie" },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
    { value: NEW_CATEGORY_OPTION, label: "+ Nová kategória..." },
  ];

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
  const movingTarget = allPortfolios.find((p) => p.id === movingPortfolioId);
  const deleteCategoryTarget = categories.find((c) => c.id === deleteCategoryId);
  const categoryGroups = groupPortfoliosByCategory(allPortfolios, categories, {
    includeEmptyCategories: true,
    includeEmptyUncategorized: true,
  });
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

            <SettingsSection
              title="Správa portfólií"
              action={
                <Button
                  variant="Secondary"
                  className="h-8 px-2 text-xs"
                  onClick={() => openNewCategory()}
                  data-testid="button-add-category"
                >
                  <Plus className="mr-1 size-3.5" />
                  Kategória
                </Button>
              }
            >
              <Card>
                <p className="rd-type-body-sm text-[var(--rd-text-secondary)]">
                  Portfóliá sú zoskupené v kategóriách. Poradie kategórií a portfólií určuje aj poradie v prepínači
                  naprieč aplikáciou.
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
                <Select
                  label="Kategória"
                  value={newPortfolioCategoryId}
                  options={categorySelectOptions}
                  onChange={(value) => {
                    if (value === NEW_CATEGORY_OPTION) {
                      openNewCategory({ afterCreateTarget: "newPortfolio" });
                      return;
                    }
                    setNewPortfolioCategoryId(value);
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

                {categories.length === 0 && allPortfolios.length === 0 ? (
                  <EmptyState
                    title="Zatiaľ žiadne kategórie"
                    body="Vytvorte kategóriu (napr. Akcie, Krypto) a priraďte do nej portfóliá."
                  />
                ) : null}

                <div className="flex flex-col gap-4 border-t border-[var(--rd-border-subtle)] pt-3">
                  {categoryGroups.map((group) => {
                    const cat = group.category;
                    const catIndex = cat ? categories.findIndex((c) => c.id === cat.id) : -1;
                    return (
                      <div key={cat?.id ?? "uncategorized"} className="flex flex-col gap-2">
                        <div className="flex items-center gap-1.5">
                          {cat ? (
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: cat.color }}
                              aria-hidden
                            />
                          ) : (
                            <span className="size-2.5 shrink-0 rounded-full bg-[var(--rd-text-tertiary)]" aria-hidden />
                          )}
                          <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--rd-text-secondary)]">
                            {cat?.name ?? "Bez kategórie"}
                          </p>
                          <span className="shrink-0 text-xs text-[var(--rd-text-tertiary)]">
                            {formatCategoryCashSum(group.portfolios)}
                          </span>
                          {cat ? (
                            <>
                              <IconButton
                                label="Posunúť kategóriu nahor"
                                disabled={catIndex <= 0 || reorderingCategory}
                                onClick={() => void handleMoveCategory(catIndex, "up")}
                              >
                                <ChevronUp className="size-3.5" />
                              </IconButton>
                              <IconButton
                                label="Posunúť kategóriu nadol"
                                disabled={catIndex < 0 || catIndex >= categories.length - 1 || reorderingCategory}
                                onClick={() => void handleMoveCategory(catIndex, "down")}
                              >
                                <ChevronDown className="size-3.5" />
                              </IconButton>
                              <IconButton
                                label="Upraviť kategóriu"
                                onClick={() =>
                                  setCategoryForm({
                                    id: cat.id,
                                    name: cat.name,
                                    color: (PORTFOLIO_CATEGORY_COLORS as readonly string[]).includes(cat.color)
                                      ? (cat.color as PortfolioCategoryColor)
                                      : PORTFOLIO_CATEGORY_COLORS[0],
                                    afterCreateTarget: null,
                                  })
                                }
                              >
                                <Pencil className="size-3.5" />
                              </IconButton>
                              <IconButton label="Zmazať kategóriu" onClick={() => setDeleteCategoryId(cat.id)}>
                                <Trash2 className="size-3.5 text-[var(--rd-loss)]" />
                              </IconButton>
                            </>
                          ) : null}
                        </div>

                        {group.portfolios.length === 0 ? (
                          <p className="pl-4 text-xs text-[var(--rd-text-tertiary)]">Žiadne portfóliá</p>
                        ) : (
                          group.portfolios.map((portfolio) => {
                            const globalIndex = allPortfolios.findIndex((p) => p.id === portfolio.id);
                            return (
                              <div
                                key={portfolio.id}
                                className="flex items-start gap-1.5 rounded-[var(--rd-radius-sm)] bg-[var(--rd-bg-surface-raised)] px-2 py-2"
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
                                  <button
                                    type="button"
                                    className="mt-1.5 text-xs font-medium text-[var(--rd-accent)]"
                                    onClick={() => setMovingPortfolioId(portfolio.id)}
                                  >
                                    Presunúť
                                  </button>
                                </div>
                                <IconButton
                                  label="Posunúť nahor"
                                  disabled={globalIndex <= 0 || reorderingPortfolio}
                                  onClick={() => void handleMovePortfolio(globalIndex, "up")}
                                >
                                  <ChevronUp className="size-4" />
                                </IconButton>
                                <IconButton
                                  label="Posunúť nadol"
                                  disabled={
                                    globalIndex < 0 ||
                                    globalIndex >= allPortfolios.length - 1 ||
                                    reorderingPortfolio
                                  }
                                  onClick={() => void handleMovePortfolio(globalIndex, "down")}
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
                                      categoryId: portfolio.categoryId ?? null,
                                    })
                                  }
                                >
                                  <Pencil className="size-4" />
                                </IconButton>
                                {allPortfolios.length > 1 ? (
                                  <IconButton
                                    label="Vymazať portfólio"
                                    onClick={() => setDeletePortfolioId(portfolio.id)}
                                  >
                                    <Trash2 className="size-4 text-[var(--rd-loss)]" />
                                  </IconButton>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </div>
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
        body="Upravte názov, brokera a kategóriu."
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
          <Select
            label="Kategória"
            value={editingPortfolio?.categoryId || "none"}
            options={categorySelectOptions}
            onChange={(value) => {
              if (value === NEW_CATEGORY_OPTION) {
                openNewCategory({ afterCreateTarget: "editPortfolio" });
                return;
              }
              setEditingPortfolio((prev) =>
                prev ? { ...prev, categoryId: value === "none" ? null : value } : null,
              );
            }}
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
        open={!!movingPortfolioId}
        title={movingTarget ? `Presunúť „${movingTarget.name}"` : "Presunúť portfólio"}
        body="Kliknutím priraďte portfólio do kategórie."
        onClose={() => setMovingPortfolioId(null)}
      >
        <div className="mt-3 flex flex-col gap-1">
          <button
            type="button"
            className="flex min-h-[44px] items-center justify-between rounded-[var(--rd-radius-sm)] px-2 text-left text-sm"
            onClick={() => movingPortfolioId && void handleAssignCategory(movingPortfolioId, null)}
          >
            <span>Bez kategórie</span>
            <span className="text-xs text-[var(--rd-text-tertiary)]">
              {allPortfolios.filter((p) => !p.categoryId).length} portf.
            </span>
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className="flex min-h-[44px] items-center justify-between gap-2 rounded-[var(--rd-radius-sm)] px-2 text-left text-sm"
              onClick={() => movingPortfolioId && void handleAssignCategory(movingPortfolioId, cat.id)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} aria-hidden />
                <span className="truncate">{cat.name}</span>
              </span>
              <span className="shrink-0 text-xs text-[var(--rd-text-tertiary)]">
                {allPortfolios.filter((p) => p.categoryId === cat.id).length} portf.
              </span>
            </button>
          ))}
          <Button
            variant="Secondary"
            className="mt-2 w-full"
            onClick={() =>
              openNewCategory({
                afterCreateAssignPortfolioId: movingPortfolioId,
                afterCreateTarget: "move",
              })
            }
          >
            <Plus className="mr-1 size-3.5" />
            Nová kategória...
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={!!categoryForm}
        title={categoryForm?.id ? "Upraviť kategóriu" : "Nová kategória"}
        onClose={() => {
          if (!isSavingCategory) setCategoryForm(null);
        }}
      >
        <div className="mt-3 space-y-3">
          <Input
            label="Názov kategórie"
            placeholder="napr. Akcie"
            value={categoryForm?.name || ""}
            onChange={(e) =>
              setCategoryForm((prev) => (prev ? { ...prev, name: e.target.value } : null))
            }
            data-testid="input-category-name"
          />
          <div>
            <p className="mb-1.5 text-xs font-medium text-[var(--rd-text-secondary)]">Farba</p>
            <div className="flex flex-wrap gap-2">
              {PORTFOLIO_CATEGORY_COLORS.map((color) => {
                const selected = categoryForm?.color === color;
                return (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Farba ${color}`}
                    className={`size-8 rounded-full border-2 ${
                      selected ? "border-[var(--rd-text-primary)]" : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setCategoryForm((prev) => (prev ? { ...prev, color } : null))}
                  />
                );
              })}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="Secondary"
              className="flex-1"
              onClick={() => setCategoryForm(null)}
              disabled={isSavingCategory}
            >
              Zrušiť
            </Button>
            <Button
              className="flex-1"
              onClick={() => void handleSaveCategory()}
              disabled={!categoryForm?.name.trim() || isSavingCategory}
              data-testid="button-save-category"
            >
              {isSavingCategory ? "Ukladám..." : "Uložiť"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!deleteCategoryId}
        title={deleteCategoryTarget ? `Zmazať kategóriu „${deleteCategoryTarget.name}"?` : "Zmazať kategóriu?"}
        onClose={() => {
          if (!isDeleting) setDeleteCategoryId(null);
        }}
      >
        <div className="mt-3 space-y-3">
          <p className="rd-type-body text-[var(--rd-text-secondary)]">
            Portfóliá v tejto kategórii sa nevymažú — presunú sa do skupiny Bez kategórie.
          </p>
          <div className="flex gap-2">
            <Button
              variant="Secondary"
              className="flex-1"
              onClick={() => setDeleteCategoryId(null)}
              disabled={isDeleting}
            >
              Zrušiť
            </Button>
            <Button
              variant="Secondary"
              className="flex-1 border-[var(--rd-loss)] bg-[var(--rd-loss-dim)] text-[var(--rd-loss)]"
              onClick={() => void handleDeleteCategory()}
              disabled={isDeleting}
              data-testid="button-confirm-delete-category"
            >
              {isDeleting ? "Mažem..." : "Zmazať"}
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

function SettingsSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 rd-type-overline text-[var(--rd-text-tertiary)]">{title}</p>
        {action}
      </div>
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
