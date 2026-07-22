import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, RotateCcw, Save } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type PromptKey = "strategy" | "ticker" | "chat";

type PromptsResponse = {
  prompts: Record<PromptKey, string>;
  isCustom: Record<PromptKey, boolean>;
  defaults: Record<PromptKey, string>;
  meta: Record<
    PromptKey,
    { label: string; description: string; placeholders: string[] }
  >;
};

const KEYS: PromptKey[] = ["strategy", "ticker", "chat"];

export function AiSkenerPromptsEditor() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<PromptKey>("strategy");
  const [drafts, setDrafts] = useState<Record<PromptKey, string>>({
    strategy: "",
    ticker: "",
    chat: "",
  });

  const { data, isLoading } = useQuery<PromptsResponse>({
    queryKey: ["/api/ai-scanner/prompts"],
    queryFn: async () => {
      const res = await fetch("/api/ai-scanner/prompts", { credentials: "include" });
      if (!res.ok) throw new Error("prompts");
      return res.json();
    },
    enabled: open,
  });

  useEffect(() => {
    if (data?.prompts) {
      setDrafts({
        strategy: data.prompts.strategy,
        ticker: data.prompts.ticker,
        chat: data.prompts.chat,
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/ai-scanner/prompts", {
        strategy: drafts.strategy,
        ticker: drafts.ticker,
        chat: drafts.chat,
      });
      return res.json() as Promise<PromptsResponse>;
    },
    onSuccess: (res) => {
      queryClient.setQueryData(["/api/ai-scanner/prompts"], res);
      toast({ title: "Prompty uložené" });
    },
    onError: (err: Error) => {
      toast({ title: "Uloženie zlyhalo", description: err.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (keys?: PromptKey[]) => {
      const res = await apiRequest("POST", "/api/ai-scanner/prompts/reset", keys ? { keys } : {});
      return res.json() as Promise<PromptsResponse>;
    },
    onSuccess: (res) => {
      queryClient.setQueryData(["/api/ai-scanner/prompts"], res);
      setDrafts({
        strategy: res.prompts.strategy,
        ticker: res.prompts.ticker,
        chat: res.prompts.chat,
      });
      toast({ title: "Obnovené predvolené prompty" });
    },
    onError: (err: Error) => {
      toast({ title: "Obnova zlyhala", description: err.message, variant: "destructive" });
    },
  });

  const meta = data?.meta?.[active];
  const dirty = data
    ? KEYS.some((k) => drafts[k] !== data.prompts[k])
    : false;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 text-[10px] px-2.5"
        onClick={() => setOpen(true)}
      >
        <FileText className="h-3 w-3 mr-1" />
        Prompty
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-xl">
          <SheetHeader>
            <SheetTitle className="text-base">AI prompty</SheetTitle>
            <SheetDescription className="text-xs">
              Uprav texty, ktoré Claude používa pri stratégii, ticker analýze a chate. Placeholdery
              nechaj v texte — appka ich nahradí dátami.
            </SheetDescription>
          </SheetHeader>

          {isLoading || !data ? (
            <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Načítavam…
            </div>
          ) : (
            <div className="space-y-3 py-3">
              <div className="flex flex-wrap gap-1.5">
                {KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActive(key)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
                      active === key
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted/50 text-muted-foreground border-border",
                    )}
                  >
                    {data.meta[key].label}
                    {data.isCustom[key] && (
                      <span className="ml-1 opacity-80">•</span>
                    )}
                  </button>
                ))}
              </div>

              {meta && (
                <Card>
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Label className="text-xs">{meta.label}</Label>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{meta.description}</p>
                      </div>
                      {data.isCustom[active] ? (
                        <Badge variant="secondary" className="text-[8px] shrink-0">
                          Upravené
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[8px] shrink-0">
                          Predvolené
                        </Badge>
                      )}
                    </div>
                    <p className="text-[9px] text-muted-foreground">
                      Placeholdery:{" "}
                      {meta.placeholders.map((p) => (
                        <code key={p} className="mx-0.5 rounded bg-muted px-1 py-0.5 text-[9px]">
                          {p}
                        </code>
                      ))}
                    </p>
                    <Textarea
                      value={drafts[active]}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [active]: e.target.value }))
                      }
                      className="min-h-[220px] text-[11px] font-mono leading-relaxed resize-y"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-[10px]"
                        disabled={resetMutation.isPending}
                        onClick={() => resetMutation.mutate([active])}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Obnoviť tento
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  type="button"
                  className="h-9 text-xs flex-1"
                  disabled={saveMutation.isPending || !dirty}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Uložiť všetky
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9 text-xs flex-1"
                  disabled={resetMutation.isPending}
                  onClick={() => resetMutation.mutate(undefined)}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Obnoviť všetky pôvodné
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
