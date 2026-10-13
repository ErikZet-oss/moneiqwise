import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { usePortfolio } from "@/hooks/usePortfolio";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { AiChatGem, AiChatListItem, AiChatMessage, AiChatRow } from "./types";

export function useAiChat() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { selectedPortfolioId } = usePortfolio();
  const qc = useQueryClient();
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [chat, setChat] = useState<AiChatRow | null>(null);
  const [activeGem, setActiveGem] = useState<AiChatGem | null>(null);
  const [draft, setDraft] = useState("");
  const [useNews, setUseNews] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [toolSteps, setToolSteps] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsTarget, setActionsTarget] = useState<{
    id: string;
    title: string;
    pinned: boolean;
    gemId: string | null;
  } | null>(null);
  const [moveGemOpen, setMoveGemOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [gemFormOpen, setGemFormOpen] = useState(false);
  const [editingGem, setEditingGem] = useState<AiChatGem | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const greetingName =
    user?.firstName?.trim() ||
    user?.email?.split("@")[0] ||
    "tam";

  const gemsQuery = useQuery<{ gems: AiChatGem[] }>({
    queryKey: ["/api/ai-chat/gems"],
    queryFn: async () => {
      const res = await fetch("/api/ai-chat/gems", { credentials: "include" });
      if (!res.ok) throw new Error("gems");
      return res.json();
    },
  });

  const chatsQuery = useQuery<{ chats: AiChatListItem[] }>({
    queryKey: ["/api/ai-chat/chats", historyQuery],
    queryFn: async () => {
      const q = historyQuery.trim()
        ? `?q=${encodeURIComponent(historyQuery.trim())}`
        : "";
      const res = await fetch(`/api/ai-chat/chats${q}`, { credentials: "include" });
      if (!res.ok) throw new Error("chats");
      return res.json();
    },
  });

  const gems = gemsQuery.data?.gems ?? [];
  const chats = chatsQuery.data?.chats ?? [];

  const loadChat = useCallback(async (id: string) => {
    const res = await fetch(`/api/ai-chat/chats/${id}`, { credentials: "include" });
    if (!res.ok) throw new Error("load");
    const data = await res.json();
    setChatId(data.chat.id);
    setChat(data.chat);
    setActiveGem(data.gem);
    setMessages(data.messages || []);
    setStreamText("");
    setToolSteps([]);
    setHistoryOpen(false);
  }, []);

  const startNewChat = useCallback(
    async (gemId?: string | null) => {
      const res = await apiRequest("POST", "/api/ai-chat/chats", {
        gemId: gemId ?? null,
        portfolioScope: selectedPortfolioId || "all",
        title: "Nový chat",
      });
      const data = await res.json();
      setChatId(data.chat.id);
      setChat(data.chat);
      setActiveGem(data.gem);
      setMessages([]);
      setStreamText("");
      setToolSteps([]);
      setHistoryOpen(false);
      void qc.invalidateQueries({ queryKey: ["/api/ai-chat/chats"] });
      return data.chat as AiChatRow;
    },
    [qc, selectedPortfolioId],
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming) return;

      let id = chatId;
      let currentTitle = chat?.title;
      if (!id) {
        const created = await startNewChat(activeGem?.id ?? null);
        id = created.id;
        currentTitle = created.title;
      }

      const optimistic: AiChatMessage = {
        id: `tmp-${Date.now()}`,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, optimistic]);
      setDraft("");
      setStreaming(true);
      setStreamText("");
      setToolSteps([]);

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const res = await fetch(`/api/ai-chat/chats/${id}/messages`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ content, useNews, stream: true }),
          signal: ac.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.message || "Odoslanie zlyhalo.");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("Stream nie je dostupný.");
        const decoder = new TextDecoder();
        let buffer = "";
        let acc = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const line = part
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!line) continue;
            const payload = JSON.parse(line.slice(6));
            if (payload.type === "start") {
              setMessages((m) => {
                const withoutTmp = m.filter((x) => x.id !== optimistic.id);
                return [...withoutTmp, payload.userMessage];
              });
              setToolSteps(payload.toolSteps || []);
            } else if (payload.type === "delta") {
              acc += payload.text || "";
              setStreamText(acc);
            } else if (payload.type === "done") {
              setMessages((m) => [...m, payload.assistantMessage]);
              setStreamText("");
              setToolSteps(payload.toolSteps || []);
              if (payload.title) {
                setChat((c) => (c ? { ...c, title: payload.title } : c));
              }
              void qc.invalidateQueries({ queryKey: ["/api/ai-chat/chats"] });
            } else if (payload.type === "error") {
              throw new Error(payload.message || "Chyba AI");
            }
          }
        }

        if (acc && !messages.some((m) => m.content === acc && m.role === "assistant")) {
          // if stream ended without done (abort), keep partial as local
        }
        void currentTitle;
      } catch (e: any) {
        if (e?.name === "AbortError") {
          if (streamText) {
            setMessages((m) => [
              ...m,
              {
                id: `partial-${Date.now()}`,
                role: "assistant",
                content: streamText,
                createdAt: new Date().toISOString(),
              },
            ]);
            setStreamText("");
          }
        } else {
          toast({
            title: "AI Chat",
            description: e?.message || "Nepodarilo sa odoslať správu.",
            variant: "destructive",
          });
          setMessages((m) => m.filter((x) => x.id !== optimistic.id));
          setDraft(content);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [
      activeGem?.id,
      chat?.title,
      chatId,
      messages,
      qc,
      startNewChat,
      streamText,
      streaming,
      toast,
      useNews,
    ],
  );

  const openChatActions = useCallback(
    (target?: { id: string; title: string; pinned: boolean; gemId: string | null } | null) => {
      const t =
        target ??
        (chatId && chat
          ? {
              id: chatId,
              title: chat.title,
              pinned: chat.pinned,
              gemId: chat.gemId,
            }
          : null);
      if (!t) return;
      setActionsTarget(t);
      setRenameValue(t.title);
      setActionsOpen(true);
    },
    [chat, chatId],
  );

  const patchChat = useMutation({
    mutationFn: async (patch: {
      chatId?: string;
      title?: string;
      pinned?: boolean;
      gemId?: string | null;
    }) => {
      const id = patch.chatId || actionsTarget?.id || chatId;
      if (!id) throw new Error("no chat");
      const { chatId: _ignore, ...body } = patch;
      const res = await apiRequest("PATCH", `/api/ai-chat/chats/${id}`, body);
      return res.json() as Promise<{ chat: AiChatRow }>;
    },
    onSuccess: (data) => {
      if (chatId === data.chat.id) setChat(data.chat);
      setActionsTarget((t) =>
        t && t.id === data.chat.id
          ? {
              id: data.chat.id,
              title: data.chat.title,
              pinned: data.chat.pinned,
              gemId: data.chat.gemId,
            }
          : t,
      );
      void qc.invalidateQueries({ queryKey: ["/api/ai-chat/chats"] });
    },
  });

  const deleteChat = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ai-chat/chats/${id}`);
    },
    onSuccess: (_d, id) => {
      if (chatId === id) {
        setChatId(null);
        setChat(null);
        setMessages([]);
        setActiveGem(null);
      }
      void qc.invalidateQueries({ queryKey: ["/api/ai-chat/chats"] });
      setActionsOpen(false);
    },
  });

  const saveGem = useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      color: string;
      description: string;
      instructions: string;
      contextFlags: AiChatGem["contextFlags"];
      starters: string[];
    }) => {
      if (input.id) {
        const res = await apiRequest("PATCH", `/api/ai-chat/gems/${input.id}`, input);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/ai-chat/gems", input);
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/ai-chat/gems"] });
      setGemFormOpen(false);
      setEditingGem(null);
    },
  });

  const deleteGem = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/ai-chat/gems/${id}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/ai-chat/gems"] });
      setGemFormOpen(false);
      setEditingGem(null);
    },
  });

  const suggestTitle = useMutation({
    mutationFn: async () => {
      const id = actionsTarget?.id || chatId;
      if (!id) throw new Error("no chat");
      const res = await apiRequest("POST", `/api/ai-chat/chats/${id}/suggest-title`, {});
      return res.json() as Promise<{ title: string; chat: AiChatRow }>;
    },
    onSuccess: (data) => {
      setRenameValue(data.title);
      if (chatId === data.chat.id) setChat(data.chat);
      setActionsTarget((t) =>
        t && t.id === data.chat.id ? { ...t, title: data.chat.title } : t,
      );
      void qc.invalidateQueries({ queryKey: ["/api/ai-chat/chats"] });
    },
  });

  const exportMarkdown = useCallback(() => {
    if (!messages.length) {
      toast({ title: "Export", description: "Chat je prázdny." });
      return;
    }
    const lines = [
      `# ${chat?.title || "AI Chat"}`,
      "",
      ...messages.map((m) => `## ${m.role === "user" ? "Ty" : "AI"}\n\n${m.content}\n`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(chat?.title || "ai-chat").replace(/\s+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [chat?.title, messages, toast]);

  const showSoon = useCallback(
    (label: string) => {
      toast({ title: label, description: "Čoskoro — zatiaľ nie je dostupné." });
    },
    [toast],
  );

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const isWelcome = !chatId || (messages.length === 0 && !streaming && !streamText);

  const chatsByDay = useMemo(() => {
    const groups: Record<string, AiChatListItem[]> = {};
    const now = new Date();
    for (const c of chats) {
      const d = new Date(c.updatedAt);
      const diffDays = Math.floor(
        (now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000,
      );
      let key = "Staršie";
      if (diffDays <= 0) key = "Dnes";
      else if (diffDays === 1) key = "Včera";
      else if (diffDays < 7) key = "Tento týždeň";
      else if (diffDays < 30) key = "Tento mesiac";
      (groups[key] ||= []).push(c);
    }
    return groups;
  }, [chats]);

  return {
    greetingName,
    gems,
    chats,
    chatsByDay,
    chatId,
    chat,
    activeGem,
    messages,
    draft,
    setDraft,
    useNews,
    setUseNews,
    streaming,
    streamText,
    toolSteps,
    historyOpen,
    setHistoryOpen,
    historyQuery,
    setHistoryQuery,
    actionsOpen,
    setActionsOpen,
    actionsTarget,
    setActionsTarget,
    openChatActions,
    moveGemOpen,
    setMoveGemOpen,
    renameOpen,
    setRenameOpen,
    renameValue,
    setRenameValue,
    gemFormOpen,
    setGemFormOpen,
    editingGem,
    setEditingGem,
    isWelcome,
    loadChat,
    startNewChat,
    sendMessage,
    stopStreaming,
    patchChat,
    deleteChat,
    saveGem,
    deleteGem,
    suggestTitle,
    exportMarkdown,
    showSoon,
    gemsLoading: gemsQuery.isLoading,
    chatsLoading: chatsQuery.isLoading,
  };
}

export type AiChatController = ReturnType<typeof useAiChat>;
