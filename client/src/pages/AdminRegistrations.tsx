import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { sk } from "date-fns/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HelpTip } from "@/components/HelpTip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { X, CheckCircle2, Ban, Clock } from "lucide-react";

type RegistrationFilter = "pending" | "blocked" | "approved" | "all";

type AdminRegistrationRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  registrationStatus: string;
  createdAt: string | null;
};

type StatusCounts = { pending: number; approved: number; blocked: number };

const STATUS_LABELS: Record<string, string> = {
  pending: "Čaká",
  approved: "Schválený",
  blocked: "Zablokovaný",
};

function statusLabel(s: string) {
  return STATUS_LABELS[s] ?? s;
}

function RowActions({
  row,
  busyUserId,
  onApprove,
  onBlock,
  onDismissClick,
}: {
  row: AdminRegistrationRow;
  busyUserId: string | null;
  onApprove: (id: string) => void;
  onBlock: (id: string) => void;
  onDismissClick: (row: AdminRegistrationRow) => void;
}) {
  const isBusy = busyUserId === row.id;
  const isPending = row.registrationStatus === "pending";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
      {row.registrationStatus !== "approved" && (
        <Button size="sm" variant="default" className="h-8 text-xs sm:text-sm" disabled={isBusy} onClick={() => onApprove(row.id)}>
          Schváliť
        </Button>
      )}
      {row.registrationStatus !== "blocked" && (
        <Button size="sm" variant="destructive" className="h-8 text-xs sm:text-sm" disabled={isBusy} onClick={() => onBlock(row.id)}>
          Blokovať
        </Button>
      )}
      {isPending && (
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          disabled={isBusy}
          title="Zrušiť žiadosť"
          aria-label="Zrušiť žiadosť"
          onClick={() => onDismissClick(row)}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export default function AdminRegistrations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<RegistrationFilter>("pending");
  const [dismissTarget, setDismissTarget] = useState<AdminRegistrationRow | null>(null);

  const listQuery = useQuery({
    queryKey: ["/api/admin/registrations", filter],
    queryFn: async () => {
      const u = new URL("/api/admin/registrations", window.location.origin);
      u.searchParams.set("status", filter);
      const res = await fetch(u.toString(), { credentials: "include" });
      if (res.status === 403) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j?.message === "string" ? j.message : "Prístup zamietnutý.");
      }
      if (!res.ok) throw new Error("Nepodarilo sa načítať zoznam.");
      return res.json() as Promise<{ users: AdminRegistrationRow[]; counts: StatusCounts }>;
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/admin/registrations"] });
  };

  const approveMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/admin/registrations/${encodeURIComponent(userId)}/approve`);
    },
    onSuccess: () => {
      toast({ title: "Schválené", description: "Používateľ sa môže prihlásiť." });
      invalidate();
    },
    onError: (e: Error) => {
      toast({ title: "Chyba", description: e.message, variant: "destructive" });
    },
  });

  const blockMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("POST", `/api/admin/registrations/${encodeURIComponent(userId)}/block`);
    },
    onSuccess: () => {
      toast({ title: "Zablokované", description: "Účet nemôže vstúpiť do aplikácie." });
      invalidate();
    },
    onError: (e: Error) => {
      toast({ title: "Chyba", description: e.message, variant: "destructive" });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiRequest("DELETE", `/api/admin/registrations/${encodeURIComponent(userId)}`);
    },
    onSuccess: () => {
      toast({
        title: "Žiadosť zrušená",
        description: "Účet bol odstránený. Ten istý email sa môže znova zaregistrovať.",
      });
      setDismissTarget(null);
      invalidate();
    },
    onError: (e: Error) => {
      toast({ title: "Chyba", description: e.message, variant: "destructive" });
    },
  });

  const rows = listQuery.data?.users ?? [];
  const counts = listQuery.data?.counts ?? { pending: 0, approved: 0, blocked: 0 };

  const busyUserId =
    approveMutation.isPending && approveMutation.variables != null
      ? approveMutation.variables
      : blockMutation.isPending && blockMutation.variables != null
        ? blockMutation.variables
        : dismissMutation.isPending && dismissMutation.variables != null
          ? dismissMutation.variables
          : null;

  return (
    <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6 px-1 sm:px-0 pb-10">
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight leading-tight">Registrácie používateľov</h1>
          <HelpTip title="Ako to funguje">
            <p>
              Zobrazené sú účty s lokálnym prihlásením (email + heslo). Ak máš na serveri zapnuté schvaľovanie, noví
              používatelia sú v stave „čaká“.
            </p>
            <p>
              Prístup majú len emaily v <code className="text-[11px] bg-muted px-1 rounded">LOCAL_AUTH_ADMIN_EMAILS</code>.
            </p>
            <p>
              <strong>Schválení</strong> a <strong>zablokovaní</strong> sú v prehľade nižšie — prepni filter alebo klikni na
              súčty. Krížik pri čakajúcej žiadosti účet zmaže (môže sa znova registrovať).
            </p>
          </HelpTip>
        </div>
        <p className="text-muted-foreground text-xs sm:text-sm">
          Schválení · zablokovaní · čakajúci — podľa filtra. Na mobile potiahni výber do strany.
        </p>
      </div>

      {/* Súčty — rýchly prehľad + skok na filter */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => setFilter("pending")}
          className={cn(
            "rounded-xl border p-3 sm:p-4 text-left transition-colors",
            filter === "pending" ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border hover:bg-muted/50",
          )}
        >
          <div className="flex items-center gap-2 text-muted-foreground text-[11px] sm:text-xs uppercase tracking-wide">
            <Clock className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Čakajú
          </div>
          <div className="text-2xl sm:text-3xl font-semibold tabular-nums mt-1">{counts.pending}</div>
        </button>
        <button
          type="button"
          onClick={() => setFilter("approved")}
          className={cn(
            "rounded-xl border p-3 sm:p-4 text-left transition-colors",
            filter === "approved" ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border hover:bg-muted/50",
          )}
        >
          <div className="flex items-center gap-2 text-muted-foreground text-[11px] sm:text-xs uppercase tracking-wide">
            <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-emerald-600" />
            Schválení
          </div>
          <div className="text-2xl sm:text-3xl font-semibold tabular-nums mt-1">{counts.approved}</div>
        </button>
        <button
          type="button"
          onClick={() => setFilter("blocked")}
          className={cn(
            "rounded-xl border p-3 sm:p-4 text-left transition-colors",
            filter === "blocked" ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border hover:bg-muted/50",
          )}
        >
          <div className="flex items-center gap-2 text-muted-foreground text-[11px] sm:text-xs uppercase tracking-wide">
            <Ban className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-red-500" />
            Zablokovaní
          </div>
          <div className="text-2xl sm:text-3xl font-semibold tabular-nums mt-1">{counts.blocked}</div>
        </button>
      </div>

      <Card>
        <CardHeader className="space-y-3 pb-2 sm:pb-4">
          <div>
            <CardTitle className="text-lg">Zoznam e-mailov</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              {filter === "pending" && "Žiadosti čakajúce na rozhodnutie"}
              {filter === "approved" && "Účty, ktoré si schválil"}
              {filter === "blocked" && "Účty, ktoré si zablokoval"}
              {filter === "all" && "Všetci s lokálnym prihlásením"}
            </CardDescription>
          </div>
          <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain pb-0.5 [-webkit-overflow-scrolling:touch]">
            <ToggleGroup
              type="single"
              value={filter}
              onValueChange={(v) => v && setFilter(v as RegistrationFilter)}
              className="flex w-max min-w-full flex-nowrap justify-start gap-1 sm:justify-center sm:flex-wrap"
            >
              <ToggleGroupItem value="pending" className="shrink-0 text-xs px-2.5 data-[state=on]:z-10">
                Čakajú ({counts.pending})
              </ToggleGroupItem>
              <ToggleGroupItem value="approved" className="shrink-0 text-xs px-2.5 data-[state=on]:z-10">
                Schválení ({counts.approved})
              </ToggleGroupItem>
              <ToggleGroupItem value="blocked" className="shrink-0 text-xs px-2.5 data-[state=on]:z-10">
                Zablokovaní ({counts.blocked})
              </ToggleGroupItem>
              <ToggleGroupItem value="all" className="shrink-0 text-xs px-2.5 data-[state=on]:z-10">
                Všetci
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {listQuery.isLoading ? (
            <Skeleton className="h-40 w-full rounded-lg" />
          ) : listQuery.isError ? (
            <p className="text-sm text-destructive py-4">
              {listQuery.error instanceof Error ? listQuery.error.message : "Chyba načítania."}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Žiadne záznamy pre zvolený filter.</p>
          ) : (
            <>
              {/* Mobile: karty */}
              <div className="md:hidden space-y-3">
                {rows.map((row) => {
                  const name =
                    [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || "—";
                  const created =
                    row.createdAt != null
                      ? format(parseISO(String(row.createdAt)), "d. MMM yyyy HH:mm", { locale: sk })
                      : "—";
                  return (
                    <div
                      key={row.id}
                      className="rounded-xl border bg-card p-3.5 space-y-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-xs sm:text-sm break-all leading-snug">{row.email}</div>
                          <div className="text-xs text-muted-foreground mt-1">{name}</div>
                        </div>
                        <Badge variant="secondary" className="shrink-0 text-[10px]">
                          {statusLabel(row.registrationStatus)}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{created}</div>
                      <RowActions
                        row={row}
                        busyUserId={busyUserId}
                        onApprove={(id) => approveMutation.mutate(id)}
                        onBlock={(id) => blockMutation.mutate(id)}
                        onDismissClick={setDismissTarget}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Desktop: tabuľka */}
              <div className="hidden md:block overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Meno</TableHead>
                      <TableHead>Stav</TableHead>
                      <TableHead>Registrovaný</TableHead>
                      <TableHead className="text-right w-[min(280px,40%)]">Akcie</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const name =
                        [row.firstName, row.lastName].filter(Boolean).join(" ").trim() || "—";
                      const created =
                        row.createdAt != null
                          ? format(parseISO(String(row.createdAt)), "d. MMM yyyy HH:mm", { locale: sk })
                          : "—";
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono text-sm max-w-[220px]">{row.email}</TableCell>
                          <TableCell className="max-w-[140px] truncate">{name}</TableCell>
                          <TableCell className="text-sm">{statusLabel(row.registrationStatus)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{created}</TableCell>
                          <TableCell className="text-right align-top">
                            <RowActions
                              row={row}
                              busyUserId={busyUserId}
                              onApprove={(id) => approveMutation.mutate(id)}
                              onBlock={(id) => blockMutation.mutate(id)}
                              onDismissClick={setDismissTarget}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!dismissTarget} onOpenChange={(open) => !open && setDismissTarget(null)}>
        <AlertDialogContent className="max-w-[min(100vw-2rem,28rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Zrušiť žiadosť?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Účet <span className="font-mono font-medium text-foreground">{dismissTarget?.email}</span> bude úplne
                odstránený. Rozhodnutie nie je blokovanie — ten istý email sa môže znova zaregistrovať.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <AlertDialogCancel className="mt-0">Späť</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (dismissTarget) dismissMutation.mutate(dismissTarget.id);
              }}
              disabled={dismissMutation.isPending}
            >
              {dismissMutation.isPending ? "Mažem…" : "Áno, zrušiť"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
