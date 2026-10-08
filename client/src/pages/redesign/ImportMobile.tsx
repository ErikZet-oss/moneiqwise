import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { usePortfolio } from "@/hooks/usePortfolio";
import { Button, Card, Chip, Select, TopBar } from "@/redesign/ui";
import { PageBody } from "./mobileChrome";

type Broker = "xtb" | "etoro";

export default function ImportMobile() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { portfolios } = usePortfolio();
  const [broker, setBroker] = useState<Broker>("xtb");
  const [portfolioId, setPortfolioId] = useState(() => portfolios[0]?.id || "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: pfList = [] } = useQuery({
    queryKey: ["/api/portfolios"],
    queryFn: async () => {
      const res = await fetch("/api/portfolios", { credentials: "include" });
      if (!res.ok) throw new Error("portfolios");
      return res.json() as Promise<Array<{ id: string; name: string }>>;
    },
  });

  const resolvedPortfolio = portfolioId || pfList[0]?.id || "";

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Vyber súbor");
      if (!resolvedPortfolio) throw new Error("Vyber portfólio");
      const body = new FormData();
      body.append("file", file);
      body.append("portfolioId", resolvedPortfolio);
      const parseRes = await fetch(`/api/import/${broker}/parse`, {
        method: "POST",
        credentials: "include",
        body,
      });
      const parsed = await parseRes.json().catch(() => ({}));
      if (!parseRes.ok) throw new Error(parsed?.message || "Parsovanie zlyhalo");
      const saveRes = await fetch(`/api/import/${broker}/save`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...parsed, portfolioId: resolvedPortfolio }),
      });
      const saved = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) throw new Error(saved?.message || "Uloženie zlyhalo");
      return saved;
    },
    onSuccess: (saved) => {
      toast({
        title: "Import hotový",
        description: saved?.imported != null ? `Importovaných: ${saved.imported}` : "Dáta boli uložené.",
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/holdings"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
      setFile(null);
    },
    onError: (err: Error) => {
      toast({ title: "Import zlyhal", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="bg-[var(--rd-bg-base)] text-[var(--rd-text-primary)]">
      <TopBar overline="XTB · eToro" title="Import brokera" />
      <PageBody>
        <p className="text-xs leading-4 text-[var(--rd-text-secondary)]">
          Nahrajte export z XTB alebo eToro pre automatický import transakcií do portfólia.
        </p>
        <div className="flex gap-1">
          <Chip active={broker === "xtb"} onClick={() => setBroker("xtb")}>
            XTB
          </Chip>
          <Chip active={broker === "etoro"} onClick={() => setBroker("etoro")}>
            eToro
          </Chip>
        </div>
        <Select
          label="Portfólio pre import"
          value={resolvedPortfolio}
          onChange={setPortfolioId}
          options={pfList.map((p) => ({ value: p.id, label: p.name }))}
        />
        <Card>
          <h3 className="text-[15px] font-semibold">Nahrať súbor</h3>
          <p className="text-xs text-[var(--rd-text-tertiary)]">CSV, XLSX, XLS · max 10 MB</p>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            className="mt-2 block w-full text-sm text-[var(--rd-text-secondary)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--rd-profit-dim)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--rd-profit)]"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? <p className="font-mono text-xs text-[var(--rd-text-secondary)]">{file.name}</p> : null}
          <Button
            className="w-full"
            disabled={!file || !resolvedPortfolio || importMutation.isPending || busy}
            onClick={() => {
              setBusy(true);
              importMutation.mutate(undefined, { onSettled: () => setBusy(false) });
            }}
          >
            {importMutation.isPending ? "Importujem…" : "Spustiť import"}
          </Button>
        </Card>
        <Card>
          <h3 className="text-[15px] font-semibold">Formát {broker === "xtb" ? "XTB" : "eToro"} exportu</h3>
          <p className="text-sm leading-5 text-[var(--rd-text-secondary)]">
            {broker === "xtb"
              ? "Nový XTB export (Cash Operations, Open Positions) aj starý formát (Cash operation history)."
              : "eToro Account Statement / closed positions export podľa podporovaného formátu."}
          </p>
        </Card>
      </PageBody>
    </div>
  );
}
