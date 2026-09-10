import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Bell,
  CheckCheck,
  ExternalLink,
  Loader2,
  Newspaper,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { format, formatDistanceToNow, parseISO } from "date-fns";
import { sk } from "date-fns/locale";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CompanyLogo } from "@/components/CompanyLogo";
import { HelpTip } from "@/components/HelpTip";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type AlertKind = "price" | "news";

type AlertSettings = {
  userId: string;
  alertsEnabled: boolean;
  priceThresholdPct: number;
  emailEnabled: boolean;
  lastScanAt: string | null;
  updatedAt: string;
  smtpConfigured: boolean;
};

type AlertItem = {
  id: string;
  ticker: string;
  kind: AlertKind;
  title: string;
  body: string;
  changePct: number | null;
  newsTitle: string | null;
  newsLink: string | null;
  readAt: string | null;
  emailStatus: string | null;
  createdAt: string;
};

const THRESHOLD_OPTIONS = ["2", "3", "4", "5", "6", "7", "8", "10"] as const;

function emailStatusLabel(
  settings: AlertSettings | undefined,
): string {
  if (!settings) return "E-mail: —";
  if (!settings.emailEnabled) return "E-mail: vypnutý";
  if (!settings.smtpConfigured) return "E-mail: čaká na SMTP";
  return "E-mail: zapnutý";
}

export default function AiAlerts({ embedded = false }: { embedded?: boolean }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading: settingsLoading } = useQuery<AlertSettings>({
    queryKey: ["/api/ai-bot/alert-settings"],
    queryFn: async () => {
      const res = await fetch("/api/ai-bot/alert-settings", { credentials: "include" });
      if (!res.ok) throw new Error("settings");
      return res.json();
    },
  });

  const { data: alertsPayload, isLoading: alertsLoading, isError: alertsError, refetch: refetchAlerts } = useQuery<{
    alerts: AlertItem[];
  }>({
    queryKey: ["/api/ai-bot/alerts"],
    queryFn: async () => {
      const res = await fetch("/api/ai-bot/alerts?limit=40", { credentials: "include" });
      if (!res.ok) throw new Error("alerts");
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 60_000,
  });

  const saveSettings = useMutation({
    mutationFn: async (patch: Partial<AlertSettings>) => {
      const res = await apiRequest("PUT", "/api/ai-bot/alert-settings", patch);
      return res.json() as Promise<AlertSettings>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/ai-bot/alert-settings"], data);
    },
    onError: () => {
      toast({ title: "Nastavenia sa neuložili", variant: "destructive" });
    },
  });

  const markRead = useMutation({
    mutationFn: async (opts: { alertId?: string; all?: boolean }) => {
      const res = await apiRequest("POST", "/api/ai-bot/alerts/mark-read", opts);
      return res.json() as Promise<{ updated: number; count: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-bot/alerts"] });
      queryClient.setQueryData(["/api/ai-bot/alerts/unread-count"], {
        count: data.count,
      });
    },
    onError: () => {
      toast({ title: "Nepodarilo sa označiť", variant: "destructive" });
    },
  });

  const alerts = alertsPayload?.alerts ?? [];
  const unreadCount = useMemo(
    () => alerts.filter((a) => !a.readAt).length,
    [alerts],
  );

  // Badge na tabe = rovnaký zdroj ako inbox (po načítaní zoznamu).
  useEffect(() => {
    if (!alertsPayload) return;
    queryClient.setQueryData(["/api/ai-bot/alerts/unread-count"], {
      count: unreadCount,
    });
  }, [alertsPayload, unreadCount, queryClient]);

  const lastScanLabel = useMemo(() => {
    if (!settings?.lastScanAt) return "Posledný scan: ešte nebežal";
    try {
      const d = parseISO(settings.lastScanAt);
      const rel = formatDistanceToNow(d, { addSuffix: true, locale: sk });
      return `Posledný scan ${rel}`;
    } catch {
      return "Posledný scan: —";
    }
  }, [settings?.lastScanAt]);

  if (settingsLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className={cn("space-y-3 md:space-y-4", !embedded && "mx-auto max-w-3xl pb-8")}>
      {!embedded ? (
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Alerty</h1>
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-3 p-3 md:p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <p className="text-sm font-medium">Alerty</p>
              <HelpTip title="Čo robia Alerty">
                <p>
                  Počas US obchodných hodín sledujeme holdingy a watchlist: silný
                  intraday pohyb ceny (nad prahom) a material novinky (earnings,
                  guidance, M&A, regulácia…).
                </p>
                <p>
                  Alerty sa ukladajú do appky. E-mail ide len ak máš zapnutý toggle
                  a na serveri je SMTP.
                </p>
              </HelpTip>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Label htmlFor="ai-alerts-enabled" className="text-xs text-muted-foreground">
                Zapnuté
              </Label>
              <Switch
                id="ai-alerts-enabled"
                checked={settings?.alertsEnabled ?? true}
                onCheckedChange={(v) => saveSettings.mutate({ alertsEnabled: v })}
                data-testid="switch-ai-alerts-enabled"
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground md:text-xs">
            {lastScanLabel}
            {" · "}
            {emailStatusLabel(settings)}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Prah ceny (± %)</Label>
              <Select
                value={String(settings?.priceThresholdPct ?? 4)}
                onValueChange={(v) =>
                  saveSettings.mutate({ priceThresholdPct: Number(v) })
                }
              >
                <SelectTrigger className="h-10" data-testid="select-alert-threshold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THRESHOLD_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      ±{t} %
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end justify-between gap-3 rounded-lg border px-3 py-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">E-mail notifikácie</p>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  {settings?.smtpConfigured
                    ? "SMTP je nastavené"
                    : "Po nastavení SMTP na serveri"}
                </p>
              </div>
              <Switch
                checked={settings?.emailEnabled ?? false}
                onCheckedChange={(v) => saveSettings.mutate({ emailEnabled: v })}
                data-testid="switch-ai-alerts-email"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-sm font-semibold">Inbox</p>
        {unreadCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1 px-2 text-xs"
            disabled={markRead.isPending}
            onClick={() => markRead.mutate({ all: true })}
            data-testid="button-alerts-mark-all-read"
          >
            {markRead.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCheck className="h-3.5 w-3.5" />
            )}
            Označiť prečítané
          </Button>
        ) : null}
      </div>

      {alertsLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : alertsError ? (
        <Card>
          <CardContent className="space-y-2 p-4 text-center">
            <p className="text-sm text-muted-foreground">
              Inbox sa nepodarilo načítať.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => void refetchAlerts()}
            >
              Skúsiť znova
            </Button>
          </CardContent>
        </Card>
      ) : alerts.length === 0 ? (
        <Card>
          <CardContent className="space-y-1 p-4 text-center">
            <p className="text-sm text-muted-foreground">
              Zatiaľ žiadne alerty — radar beží v US RTH.
            </p>
            <p className="text-[11px] text-muted-foreground">
              Tip: zníž prah (napr. ±3 %), ak chceš citlivejšie upozornenia.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => {
            const unread = !alert.readAt;
            let timeLabel = "";
            try {
              timeLabel = format(parseISO(alert.createdAt), "d. M. HH:mm", {
                locale: sk,
              });
            } catch {
              /* ignore */
            }
            const isUp = (alert.changePct ?? 0) > 0;
            return (
              <Card
                key={alert.id}
                className={cn(
                  "overflow-hidden transition-colors",
                  unread && "border-primary/40 bg-primary/[0.03]",
                )}
              >
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-start gap-2.5">
                    <CompanyLogo ticker={alert.ticker} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          className="text-sm font-semibold hover:underline"
                          onClick={() =>
                            setLocation(`/asset/${encodeURIComponent(alert.ticker)}`)
                          }
                        >
                          {alert.ticker}
                        </button>
                        <Badge
                          variant="secondary"
                          className="gap-0.5 text-[10px]"
                        >
                          {alert.kind === "price" ? (
                            isUp ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )
                          ) : (
                            <Newspaper className="h-3 w-3" />
                          )}
                          {alert.kind === "price" ? "Cena" : "Novinka"}
                        </Badge>
                        {unread ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                        ) : null}
                        {timeLabel ? (
                          <span className="text-[10px] text-muted-foreground">
                            {timeLabel}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs font-medium leading-snug md:text-sm">
                        {alert.title}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground md:text-xs">
                        {alert.body}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                      onClick={() =>
                        setLocation(`/asset/${encodeURIComponent(alert.ticker)}`)
                      }
                    >
                      Detail
                    </Button>
                    {alert.newsLink ? (
                      <a
                        href={alert.newsLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Článok
                      </a>
                    ) : null}
                    {unread ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        disabled={markRead.isPending}
                        onClick={() => markRead.mutate({ alertId: alert.id })}
                      >
                        Prečítané
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
