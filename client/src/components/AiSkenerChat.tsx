import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { sk } from "date-fns/locale";
import { History, Loader2, MessageSquare, Send, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { FinanceTermText } from "@/components/FinanceTermText";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ChatKind = "strategy" | "ticker";

type ChatListItem = {
  id: string;
  title: string;
  kind: ChatKind;
  updatedAt: string;
  createdAt: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string | Date;
};

type Props = {
  kind: ChatKind;
  context: unknown;
  title: string;
  /** Keď sa zmení kontext (nový skener), resetuje aktívny chat. */
  contextKey: string;
};

export function AiSkenerChat({ kind, context, title, contextKey }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevContextKey = useRef(contextKey);

  useEffect(() => {
    if (prevContextKey.current !== contextKey) {
      prevContextKey.current = contextKey;
      setChatId(null);
      setMessages([]);
      setDraft("");
    }
  }, [contextKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatId]);

  const { data: historyData, isLoading: historyLoading } = useQuery<{ chats: ChatListItem[] }>({
    queryKey: ["/api/ai-scanner/chats"],
    queryFn: async () => {
      const res = await fetch("/api/ai-scanner/chats", { credentials: "include" });
      if (!res.ok) throw new Error("history");
      return res.json();
    },
  });

  const chats = historyData?.chats ?? [];

  const createChatMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/ai-scanner/chats", { kind, title, context });
      return res.json() as Promise<{ chat: { id: string }; messages: ChatMessage[] }>;
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: { chatId: string; content: string }) => {
      const res = await apiRequest("POST", `/api/ai-scanner/chats/${payload.chatId}/messages`, {
        content: payload.content,
      });
      return res.json() as Promise<{ userMessage: ChatMessage; assistantMessage: ChatMessage }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-scanner/chats"] });
    },
  });

  const loadChatMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ai-scanner/chats/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("load");
      return res.json() as Promise<{
        chat: { id: string; title: string; kind: ChatKind };
        messages: ChatMessage[];
      }>;
    },
    onSuccess: (data) => {
      setChatId(data.chat.id);
      setMessages(data.messages);
      setHistoryOpen(false);
    },
    onError: () => toast({ title: "Chat sa nepodarilo načítať", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/ai-scanner/chats/${id}`),
    onSuccess: (_data, id) => {
      if (chatId === id) {
        setChatId(null);
        setMessages([]);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/ai-scanner/chats"] });
      toast({ title: "Chat zmazaný" });
    },
  });

  const sending = createChatMutation.isPending || sendMutation.isPending;

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || sending) return;

    try {
      let id = chatId;
      if (!id) {
        const created = await createChatMutation.mutateAsync();
        id = created.chat.id;
        setChatId(id);
        setMessages([]);
      }

      setDraft("");
      setMessages((prev) => [
        ...prev,
        { id: `tmp-u-${Date.now()}`, role: "user", content, createdAt: new Date().toISOString() },
      ]);

      const result = await sendMutation.mutateAsync({ chatId: id, content });
      setMessages((prev) => {
        const withoutTmp = prev.filter((m) => !m.id.startsWith("tmp-u-"));
        return [...withoutTmp, result.userMessage, result.assistantMessage];
      });
    } catch (err) {
      toast({
        title: "Správa zlyhala",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
      setMessages((prev) => prev.filter((m) => !m.id.startsWith("tmp-u-")));
      setDraft(content);
    }
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-2 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <MessageSquare className="h-3 w-3 text-primary" />
            <span className="font-medium text-foreground">Chat k analýze</span>
            <Badge variant="outline" className="text-[8px] h-4 px-1">
              ukladá sa
            </Badge>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 text-[9px] px-2"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <History className="h-3 w-3 mr-0.5" />
            História
          </Button>
        </div>

        {historyOpen && (
          <div className="rounded-md border border-border/60 max-h-36 overflow-y-auto">
            {historyLoading ? (
              <p className="p-2 text-[10px] text-muted-foreground">Načítavam…</p>
            ) : chats.length === 0 ? (
              <p className="p-2 text-[10px] text-muted-foreground">Zatiaľ žiadna história.</p>
            ) : (
              chats.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-1 border-b border-border/50 last:border-0 px-2 py-1.5"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => loadChatMutation.mutate(c.id)}
                    disabled={loadChatMutation.isPending}
                  >
                    <div className="text-[10px] font-medium truncate">{c.title}</div>
                    <div className="text-[8px] text-muted-foreground">
                      {format(new Date(c.updatedAt), "d.M.yyyy HH:mm", { locale: sk })} ·{" "}
                      {c.kind === "ticker" ? "ticker" : "stratégia"}
                    </div>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMutation.mutate(c.id)}
                    disabled={deleteMutation.isPending}
                    aria-label="Zmazať chat"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))
            )}
          </div>
        )}

        <div className="min-h-[4.5rem] max-h-52 overflow-y-auto rounded-md bg-muted/30 p-2 space-y-2">
          {messages.length === 0 ? (
            <p className="text-[10px] text-muted-foreground text-center py-3">
              Opýtaj sa Claude na výsledok — napr. „Porovnaj riziká TOP 1 a TOP 2“ alebo „Je to vhodné na dlhodobý nákup?“
            </p>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "rounded-md px-2 py-1.5 text-[10px] leading-snug max-w-[92%]",
                  m.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "mr-auto bg-card border border-border/60",
                )}
              >
                {m.role === "assistant" ? (
                  <FinanceTermText text={m.content} className="block" />
                ) : (
                  m.content
                )}
              </div>
            ))
          )}
          {sending && (
            <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Claude píše…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex gap-1.5 items-end">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Napíš správu…"
            className="min-h-[2.25rem] max-h-24 text-xs resize-none py-2"
            rows={1}
            disabled={sending}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-9 w-9 p-0 shrink-0"
            disabled={sending || !draft.trim()}
            onClick={() => void handleSend()}
            aria-label="Odoslať"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
