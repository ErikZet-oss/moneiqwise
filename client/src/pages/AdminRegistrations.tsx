import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { sk } from "date-fns/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HelpTip } from "@/components/HelpTip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type RegistrationFilter = "pending" | "blocked" | "approved" | "all";

type AdminRegistrationRow = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  registrationStatus: string;
  createdAt: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Čaká na schválenie",
  approved: "Schválený",
  blocked: "Zablokovaný",
};

function statusLabel(s: string) {
  return STATUS_LABELS[s] ?? s;
}

export default function AdminRegistrations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<RegistrationFilter>("pending");

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
      return res.json() as Promise<{ users: AdminRegistrationRow[] }>;
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

  const rows = listQuery.data?.users ?? [];
  const busyUserId =
    approveMutation.isPending && approveMutation.variables != null
      ? approveMutation.variables
      : blockMutation.isPending && blockMutation.variables != null
        ? blockMutation.variables
        : null;

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-10">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">Registrácie používateľov</h1>
            <HelpTip title="Ako to funguje">
              <p>
                Zobrazené sú účty s lokálnym prihlásením (email + heslo). Ak máš na serveri zapnuté{" "}
                <code className="text-[11px] bg-muted px-1 rounded">LOCAL_AUTH_REGISTRATION_REQUIRES_APPROVAL</code>,
                noví používatelia sú v stave „čaká“ kým ich neschváliš.
              </p>
              <p>
                Prístup k tejto stránke majú len emaily v{" "}
                <code className="text-[11px] bg-muted px-1 rounded">LOCAL_AUTH_ADMIN_EMAILS</code> (oddelené čiarkou).
              </p>
              <p>Prvý účet v databáze je vždy automaticky schválený (bootstrap).</p>
            </HelpTip>
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Schválenie alebo blokovanie registrácií — zmena platí okamžite.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between space-y-0">
          <div>
            <CardTitle>Zoznam</CardTitle>
            <CardDescription>Filtrovanie podľa stavu registrácie</CardDescription>
          </div>
          <Select
            value={filter}
            onValueChange={(v) => setFilter(v as RegistrationFilter)}
          >
            <SelectTrigger className="w-full sm:w-[220px]" data-testid="admin-reg-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">{STATUS_LABELS.pending}</SelectItem>
              <SelectItem value="blocked">{STATUS_LABELS.blocked}</SelectItem>
              <SelectItem value="approved">{STATUS_LABELS.approved}</SelectItem>
              <SelectItem value="all">Všetci (lokálna auth)</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {listQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : listQuery.isError ? (
            <p className="text-sm text-destructive">
              {listQuery.error instanceof Error ? listQuery.error.message : "Chyba načítania."}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Žiadne záznamy pre zvolený filter.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Meno</TableHead>
                    <TableHead>Stav</TableHead>
                    <TableHead>Registrovaný</TableHead>
                    <TableHead className="text-right">Akcie</TableHead>
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
                    const isBusy = busyUserId === row.id;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-sm">{row.email}</TableCell>
                        <TableCell className="max-w-[160px] truncate">{name}</TableCell>
                        <TableCell className="text-sm">{statusLabel(row.registrationStatus)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{created}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            {row.registrationStatus !== "approved" && (
                              <Button
                                size="sm"
                                variant="default"
                                disabled={isBusy}
                                onClick={() => approveMutation.mutate(row.id)}
                              >
                                Schváliť
                              </Button>
                            )}
                            {row.registrationStatus !== "blocked" && (
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={isBusy}
                                onClick={() => blockMutation.mutate(row.id)}
                              >
                                Blokovať
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
