import type { Express, Request, Response } from "express";
import {
  CLAUDE_DISABLED_MESSAGE,
  isClaudeFeatureEnabled,
} from "../claudeFeatures";
import { buildAiChatContext } from "./context";
import {
  buildAiChatSystemPrompt,
  streamAiChatReply,
  suggestChatTitle,
} from "./claudeChat";
import {
  createChat,
  createGem,
  deleteChatForUser,
  deleteGemForUser,
  ensureAiChatTables,
  getChatForUser,
  getGemForUser,
  insertMessage,
  listChatsForUser,
  listGemsForUser,
  updateChat,
  updateGem,
} from "./store";
import { GEM_COLORS } from "./types";

type AuthReq = Request & {
  user?: { claims?: { sub?: string } };
};

function requireUserId(req: AuthReq, res: Response): string | null {
  const userId = req.user?.claims?.sub;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return userId;
}

function writeSse(res: Response, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function registerAiChatRoutes(
  app: Express,
  isAuthenticated: any,
) {
  app.get("/api/ai-chat/gems", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiChatTables();
      const gems = await listGemsForUser(userId);
      res.json({ gems, colors: GEM_COLORS });
    } catch (error) {
      console.error("List AI chat gems error:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať Gemy." });
    }
  });

  app.post("/api/ai-chat/gems", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiChatTables();
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (!name) return res.status(400).json({ message: "Chýba názov Gemu." });
      const gem = await createGem({
        userId,
        name,
        color: typeof req.body?.color === "string" ? req.body.color : undefined,
        instructions:
          typeof req.body?.instructions === "string" ? req.body.instructions : undefined,
        contextFlags:
          req.body?.contextFlags && typeof req.body.contextFlags === "object"
            ? req.body.contextFlags
            : undefined,
        starters: Array.isArray(req.body?.starters) ? req.body.starters : undefined,
      });
      res.status(201).json({ gem });
    } catch (error) {
      console.error("Create AI chat gem error:", error);
      res.status(500).json({ message: "Nepodarilo sa vytvoriť Gem." });
    }
  });

  app.patch("/api/ai-chat/gems/:id", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiChatTables();
      const gemId = String(req.params?.id || "");
      const gem = await updateGem(userId, gemId, {
        name: typeof req.body?.name === "string" ? req.body.name : undefined,
        color: typeof req.body?.color === "string" ? req.body.color : undefined,
        instructions:
          typeof req.body?.instructions === "string" ? req.body.instructions : undefined,
        contextFlags:
          req.body?.contextFlags && typeof req.body.contextFlags === "object"
            ? req.body.contextFlags
            : undefined,
        starters: Array.isArray(req.body?.starters) ? req.body.starters : undefined,
      });
      if (!gem) return res.status(404).json({ message: "Gem neexistuje." });
      res.json({ gem });
    } catch (error) {
      console.error("Update AI chat gem error:", error);
      res.status(500).json({ message: "Nepodarilo sa upraviť Gem." });
    }
  });

  app.delete("/api/ai-chat/gems/:id", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiChatTables();
      const ok = await deleteGemForUser(userId, String(req.params?.id || ""));
      if (!ok) return res.status(404).json({ message: "Gem neexistuje." });
      res.json({ ok: true });
    } catch (error) {
      console.error("Delete AI chat gem error:", error);
      res.status(500).json({ message: "Nepodarilo sa zmazať Gem." });
    }
  });

  app.get("/api/ai-chat/chats", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiChatTables();
      const q = typeof req.query?.q === "string" ? req.query.q : undefined;
      const chats = await listChatsForUser(userId, { q });
      res.json({ chats });
    } catch (error) {
      console.error("List AI chats error:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať chaty." });
    }
  });

  app.post("/api/ai-chat/chats", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiChatTables();
      const chat = await createChat({
        userId,
        title: typeof req.body?.title === "string" ? req.body.title : undefined,
        gemId:
          req.body?.gemId === null
            ? null
            : typeof req.body?.gemId === "string"
              ? req.body.gemId
              : undefined,
        portfolioScope:
          typeof req.body?.portfolioScope === "string"
            ? req.body.portfolioScope
            : undefined,
      });
      const gem = chat.gemId ? await getGemForUser(userId, chat.gemId) : null;
      res.status(201).json({ chat, gem, messages: [] });
    } catch (error) {
      console.error("Create AI chat error:", error);
      res.status(500).json({ message: "Nepodarilo sa vytvoriť chat." });
    }
  });

  app.get("/api/ai-chat/chats/:id", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiChatTables();
      const loaded = await getChatForUser(userId, String(req.params?.id || ""));
      if (!loaded) return res.status(404).json({ message: "Chat neexistuje." });
      res.json({
        chat: loaded.chat,
        gem: loaded.gem,
        messages: loaded.messages,
      });
    } catch (error) {
      console.error("Get AI chat error:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať chat." });
    }
  });

  app.patch("/api/ai-chat/chats/:id", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiChatTables();
      const chat = await updateChat(userId, String(req.params?.id || ""), {
        title: typeof req.body?.title === "string" ? req.body.title : undefined,
        pinned: typeof req.body?.pinned === "boolean" ? req.body.pinned : undefined,
        gemId:
          req.body?.gemId === null
            ? null
            : typeof req.body?.gemId === "string"
              ? req.body.gemId
              : undefined,
      });
      if (!chat) return res.status(404).json({ message: "Chat neexistuje." });
      res.json({ chat });
    } catch (error) {
      console.error("Patch AI chat error:", error);
      res.status(500).json({ message: "Nepodarilo sa upraviť chat." });
    }
  });

  app.delete("/api/ai-chat/chats/:id", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiChatTables();
      const ok = await deleteChatForUser(userId, String(req.params?.id || ""));
      if (!ok) return res.status(404).json({ message: "Chat neexistuje." });
      res.json({ ok: true });
    } catch (error) {
      console.error("Delete AI chat error:", error);
      res.status(500).json({ message: "Nepodarilo sa zmazať chat." });
    }
  });

  app.post(
    "/api/ai-chat/chats/:id/suggest-title",
    isAuthenticated,
    async (req: AuthReq, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        await ensureAiChatTables();
        if (!isClaudeFeatureEnabled("ai-chat")) {
          return res.status(503).json({ message: CLAUDE_DISABLED_MESSAGE });
        }
        const loaded = await getChatForUser(userId, String(req.params?.id || ""));
        if (!loaded) return res.status(404).json({ message: "Chat neexistuje." });
        const userMsg =
          typeof req.body?.userMessage === "string"
            ? req.body.userMessage
            : loaded.messages.find((m) => m.role === "user")?.content || "";
        const assistantPreview =
          typeof req.body?.assistantPreview === "string"
            ? req.body.assistantPreview
            : loaded.messages.filter((m) => m.role === "assistant").at(-1)?.content ||
              "";
        if (!userMsg.trim()) {
          return res.status(400).json({ message: "Chýba správa na návrh názvu." });
        }
        const title = await suggestChatTitle({ userMessage: userMsg, assistantPreview });
        const chat = await updateChat(userId, loaded.chat.id, { title });
        res.json({ title, chat });
      } catch (error) {
        console.error("Suggest AI chat title error:", error);
        const msg = error instanceof Error ? error.message : "Nepodarilo sa navrhnúť názov.";
        res.status(502).json({ message: msg });
      }
    },
  );

  app.post(
    "/api/ai-chat/chats/:id/messages",
    isAuthenticated,
    async (req: AuthReq, res) => {
      const userId = requireUserId(req, res);
      if (!userId) return;

      try {
        await ensureAiChatTables();
        if (!isClaudeFeatureEnabled("ai-chat")) {
          return res.status(503).json({ message: CLAUDE_DISABLED_MESSAGE });
        }
        if (!process.env.ANTHROPIC_API_KEY?.trim()) {
          return res.status(503).json({
            message: "AI Chat nie je nakonfigurovaný. Nastav ANTHROPIC_API_KEY na serveri.",
          });
        }

        const chatId = String(req.params?.id || "");
        const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
        if (!content) return res.status(400).json({ message: "Správa je prázdna." });
        if (content.length > 8000) {
          return res.status(400).json({ message: "Správa je príliš dlhá." });
        }

        const loaded = await getChatForUser(userId, chatId);
        if (!loaded) return res.status(404).json({ message: "Chat neexistuje." });

        const useNews =
          typeof req.body?.useNews === "boolean" ? req.body.useNews : undefined;
        const ctx = await buildAiChatContext({
          userId,
          portfolioScope: loaded.chat.portfolioScope,
          gem: loaded.gem,
          useNews,
        });

        const userMessage = await insertMessage({
          chatId,
          role: "user",
          content,
        });

        const history = [
          ...loaded.messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          { role: "user" as const, content },
        ];

        const wantsStream = String(req.headers.accept || "").includes("text/event-stream")
          || req.body?.stream === true;

        if (!wantsStream) {
          let assistantText = "";
          assistantText = await streamAiChatReply({
            history,
            system: buildAiChatSystemPrompt(ctx),
            onDelta: (t) => {
              assistantText += t;
            },
          });
          const assistantMessage = await insertMessage({
            chatId,
            role: "assistant",
            content: assistantText,
            meta: { toolSteps: ctx.toolSteps },
          });
          if (loaded.chat.title === "Nový chat") {
            try {
              const title = await suggestChatTitle({
                userMessage: content,
                assistantPreview: assistantText,
              });
              await updateChat(userId, chatId, { title });
            } catch {
              /* non-fatal */
            }
          }
          return res.json({
            userMessage,
            assistantMessage,
            toolSteps: ctx.toolSteps,
          });
        }

        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        const ac = new AbortController();
        req.on?.("close", () => ac.abort());

        writeSse(res, {
          type: "start",
          userMessage,
          toolSteps: ctx.toolSteps,
        });

        let assistantText = "";
        try {
          assistantText = await streamAiChatReply({
            history,
            system: buildAiChatSystemPrompt(ctx),
            signal: ac.signal,
            onDelta: (text) => {
              writeSse(res, { type: "delta", text });
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Chyba generovania.";
          writeSse(res, { type: "error", message: msg });
          res.end();
          return;
        }

        const assistantMessage = await insertMessage({
          chatId,
          role: "assistant",
          content: assistantText,
          meta: { toolSteps: ctx.toolSteps },
        });

        let title: string | undefined;
        if (loaded.chat.title === "Nový chat" && !ac.signal.aborted) {
          try {
            title = await suggestChatTitle({
              userMessage: content,
              assistantPreview: assistantText,
            });
            await updateChat(userId, chatId, { title });
          } catch {
            /* non-fatal */
          }
        }

        writeSse(res, {
          type: "done",
          assistantMessage,
          title,
          toolSteps: ctx.toolSteps,
        });
        res.end();
      } catch (error) {
        console.error("AI chat message error:", error);
        if (!res.headersSent) {
          const msg =
            error instanceof Error ? error.message : "Nepodarilo sa odoslať správu.";
          res.status(502).json({ message: msg });
        } else {
          try {
            writeSse(res, {
              type: "error",
              message: error instanceof Error ? error.message : "Chyba",
            });
            res.end();
          } catch {
            /* ignore */
          }
        }
      }
    },
  );

}
