import type { Express, Response } from "express";
import { createHash } from "crypto";
import {
  ensureAiScannerCacheTable,
  evaluateCacheKey,
  getCachePayload,
  screenerCacheKey,
  setCachePayload,
  tickerAnalyzeCacheKey,
  type ScreenerCachePayload,
} from "./finviz/cache";
import {
  evaluateStrategyPicks,
  evaluateTickerSnapshot,
  formatAnthropicError,
  type AiStrategyEvaluation,
  type AiTickerVerdict,
} from "./finviz/claudeEvaluator";
import { fetchQuoteSnapshot, fetchScreenerRows } from "./finviz/scraper";
import { getStrategy, listStrategies } from "./finviz/strategies";
import { fetchYahooMetricSnapshot } from "./finviz/yahooFallback";
import { fetchYahooStrategyScreen } from "./finviz/yahooStrategyScreen";
import {
  appendUserMessageAndReply,
  createChat,
  deleteChatForUser,
  ensureAiScannerChatTables,
  getChatForUser,
  listChatsByUser,
} from "./finviz/chatStore";
import { AI_PROMPT_META, DEFAULT_AI_PROMPTS } from "./finviz/defaultPrompts";
import {
  getPromptsForUser,
  resetPromptsForUser,
  savePromptsForUser,
} from "./finviz/promptStore";
import type { AiPromptKey } from "./finviz/defaultPrompts";

type AuthReq = {
  user?: { claims?: { sub?: string } };
  body?: any;
};

function requireUserId(req: AuthReq, res: Response): string | null {
  const userId = req.user?.claims?.sub;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return userId;
}

function tickersFingerprint(tickers: string[]): string {
  return createHash("sha256").update(tickers.slice().sort().join(",")).digest("hex").slice(0, 24);
}

export function registerAiScannerRoutes(app: Express, isAuthenticated: any) {
  app.get("/api/ai-scanner/strategies", isAuthenticated, async (_req, res) => {
    res.json({
      strategies: listStrategies().map((s) => ({
        id: s.id,
        label: s.label,
        shortLabel: s.shortLabel,
        description: s.description,
      })),
    });
  });

  /** Spustí Finviz skener + Claude TOP 3 evaluáciu. */
  app.post("/api/ai-scanner/run", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      await ensureAiScannerCacheTable();

      if (!process.env.ANTHROPIC_API_KEY?.trim()) {
        return res.status(503).json({
          message: "AI Skener nie je nakonfigurovaný. Nastav ANTHROPIC_API_KEY na serveri.",
        });
      }

      const strategyId = String(req.body?.strategyId || "").trim();
      const strategy = getStrategy(strategyId);
      if (!strategy) {
        return res.status(400).json({ message: "Neplatná stratégia." });
      }

      const forceRefresh = req.body?.refresh === true;
      const filterFp = strategy.filters.join(",");
      const scanKey = screenerCacheKey(strategy.id, filterFp);

      let screener: ScreenerCachePayload | null = forceRefresh ? null : await getCachePayload(scanKey);
      let dataSource: "finviz" | "yahoo" = "finviz";
      if (!screener) {
        try {
          const fetched = await fetchScreenerRows(strategy);
          if (!fetched.rows.length) {
            throw new Error("Finviz returned 0 rows");
          }
          screener = {
            url: fetched.url,
            rows: fetched.rows.slice(0, 40),
            fetchedAt: new Date().toISOString(),
          };
          dataSource = "finviz";
        } catch (err) {
          console.warn("Finviz screener failed, using Yahoo fallback:", err);
          try {
            const yahoo = await fetchYahooStrategyScreen(strategy);
            if (!yahoo.rows.length) {
              return res.status(502).json({
                message:
                  "Skener nenašiel vhodné akcie (Finviz nedostupný z servera, Yahoo fallback bez výsledkov). Skús neskôr alebo inú stratégiu.",
              });
            }
            screener = {
              url: yahoo.url,
              rows: yahoo.rows.slice(0, 40),
              fetchedAt: new Date().toISOString(),
            };
            dataSource = "yahoo";
          } catch (yahooErr) {
            console.error("Yahoo strategy fallback failed:", yahooErr);
            return res.status(502).json({
              message: "Nepodarilo sa načítať dáta skenera (Finviz aj Yahoo zlyhali). Skús neskôr.",
            });
          }
        }
        await setCachePayload(scanKey, strategy.id, { ...screener, dataSource });
      } else {
        dataSource = screener.dataSource ?? "finviz";
      }

      if (!screener.rows.length) {
        return res.json({
          strategy: {
            id: strategy.id,
            label: strategy.label,
            description: strategy.description,
          },
          insight: "Skener nenašiel žiadne akcie pre zvolené filtre. Skús inú stratégiu.",
          topPicks: [],
          scannedCount: 0,
          cached: !forceRefresh,
          finvizUrl: screener.url,
          dataSource,
          model: null,
        });
      }

      const rowsForAi = screener.rows.slice(0, 20);
      const { prompts } = await getPromptsForUser(userId);
      const promptFp = createHash("sha256").update(prompts.strategy).digest("hex").slice(0, 12);
      const evalKey = evaluateCacheKey(
        strategy.id,
        `${tickersFingerprint(rowsForAi.map((r) => r.ticker))}|${promptFp}`,
      );
      let evaluation: AiStrategyEvaluation | null = forceRefresh ? null : await getCachePayload(evalKey);

      if (!evaluation) {
        try {
          evaluation = await evaluateStrategyPicks(strategy, rowsForAi, prompts.strategy);
          await setCachePayload(evalKey, strategy.id, evaluation);
        } catch (err) {
          console.error("Claude evaluation failed:", err);
          const detail = formatAnthropicError(err);
          if (err instanceof Error && err.message === "ANTHROPIC_API_KEY_MISSING") {
            return res.status(503).json({ message: detail });
          }
          // Soft fallback: top 3 bez AI komentára
          evaluation = {
            insight: `AI evaluácia zlyhala (${detail}). Zobrazujem prvé výsledky zo skenera bez komentára.`,
            topPicks: rowsForAi.slice(0, 3).map((r) => ({
              ticker: r.ticker,
              companyName: r.companyName,
              comment: "Bez AI komentára.",
              risk: "",
              metrics: {
                price: r.price,
                changePercent: r.changePercent,
                pe: r.pe,
                marketCap: r.marketCap,
                sector: r.sector,
              },
            })),
            model: "fallback",
          };
        }
      }

      res.json({
        strategy: {
          id: strategy.id,
          label: strategy.label,
          description: strategy.description,
        },
        insight:
          dataSource === "yahoo"
            ? `Finviz na serveri nie je dostupný, použil som Yahoo fallback skener. ${evaluation.insight}`
            : evaluation.insight,
        topPicks: evaluation.topPicks,
        scannedCount: screener.rows.length,
        cached: !forceRefresh,
        finvizUrl: screener.url,
        dataSource,
        model: evaluation.model,
      });
    } catch (error) {
      console.error("AI scanner run error:", error);
      res.status(500).json({ message: "Nepodarilo sa spustiť AI Skener." });
    }
  });

  /** Vyhodnotenie jednej akcie podľa Finviz quote + Claude. */
  app.post("/api/ai-scanner/analyze-ticker", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      await ensureAiScannerCacheTable();

      if (!process.env.ANTHROPIC_API_KEY?.trim()) {
        return res.status(503).json({
          message: "AI Skener nie je nakonfigurovaný. Nastav ANTHROPIC_API_KEY na serveri.",
        });
      }

      const ticker = String(req.body?.ticker || "").trim().toUpperCase();
      if (!ticker || ticker === "CASH") {
        return res.status(400).json({ message: "Zadaj platný ticker." });
      }

      const forceRefresh = req.body?.refresh === true;
      const { prompts } = await getPromptsForUser(userId);
      const promptFp = createHash("sha256").update(prompts.ticker).digest("hex").slice(0, 12);
      const cacheKey = `${tickerAnalyzeCacheKey(ticker)}|${promptFp}`;
      let cached: {
        snapshot: Awaited<ReturnType<typeof fetchQuoteSnapshot>>;
        verdict: AiTickerVerdict;
        dataSource?: "finviz" | "yahoo";
      } | null = forceRefresh ? null : await getCachePayload(cacheKey);

      if (!cached) {
        let snapshot: Awaited<ReturnType<typeof fetchQuoteSnapshot>> | null = null;
        let dataSource: "finviz" | "yahoo" = "finviz";

        try {
          snapshot = await fetchQuoteSnapshot(ticker);
          if (!snapshot.metrics || Object.keys(snapshot.metrics).length === 0) {
            snapshot = null;
          }
        } catch (err) {
          console.warn("Finviz quote failed, trying Yahoo fallback:", err);
          snapshot = null;
        }

        if (!snapshot) {
          try {
            const yahoo = await fetchYahooMetricSnapshot(ticker);
            snapshot = {
              ticker: yahoo.ticker,
              companyName: yahoo.companyName,
              metrics: yahoo.metrics,
            };
            dataSource = "yahoo";
          } catch (err) {
            console.error("Yahoo fallback failed:", err);
            return res.status(502).json({
              message: `Nepodarilo sa načítať metriky pre ${ticker} (Finviz aj Yahoo zlyhali).`,
            });
          }
        }

        let verdict: AiTickerVerdict;
        try {
          verdict = await evaluateTickerSnapshot(snapshot, prompts.ticker);
        } catch (err) {
          console.error("Claude ticker eval failed:", err);
          return res.status(502).json({ message: formatAnthropicError(err) });
        }

        cached = { snapshot, verdict, dataSource };
        await setCachePayload(cacheKey, "ticker", cached);
      }

      const pe = cached.snapshot.metrics["P/E"] ?? null;
      const price = cached.snapshot.metrics["Price"] ?? null;
      const change = cached.snapshot.metrics["Change"] ?? null;
      const rsi = cached.snapshot.metrics["RSI (14)"] ?? null;
      const marketCap = cached.snapshot.metrics["Market Cap"] ?? null;

      res.json({
        ticker: cached.verdict.ticker,
        companyName: cached.verdict.companyName,
        verdict: cached.verdict.verdict,
        summary: cached.verdict.summary,
        pros: cached.verdict.pros,
        cons: cached.verdict.cons,
        metrics: {
          pe,
          price,
          change,
          rsi,
          marketCap,
        },
        model: cached.verdict.model,
        dataSource: cached.dataSource ?? "finviz",
        cached: !forceRefresh,
      });
    } catch (error) {
      console.error("AI scanner analyze-ticker error:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Nepodarilo sa vyhodnotiť ticker.",
      });
    }
  });

  app.get("/api/ai-scanner/prompts", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const data = await getPromptsForUser(userId);
      res.json({
        prompts: data.prompts,
        isCustom: data.isCustom,
        defaults: DEFAULT_AI_PROMPTS,
        meta: AI_PROMPT_META,
      });
    } catch (error) {
      console.error("Get AI prompts error:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať prompty." });
    }
  });

  app.put("/api/ai-scanner/prompts", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const body = req.body ?? {};
      const patch: Partial<{ strategy: string; ticker: string; chat: string }> = {};
      if (typeof body.strategy === "string") patch.strategy = body.strategy;
      if (typeof body.ticker === "string") patch.ticker = body.ticker;
      if (typeof body.chat === "string") patch.chat = body.chat;

      if (!Object.keys(patch).length) {
        return res.status(400).json({ message: "Nič na uloženie." });
      }

      for (const [key, value] of Object.entries(patch)) {
        if (value.trim().length < 20) {
          return res.status(400).json({ message: `Prompt „${key}“ je príliš krátky.` });
        }
        if (value.length > 20000) {
          return res.status(400).json({ message: `Prompt „${key}“ je príliš dlhý.` });
        }
      }

      const prompts = await savePromptsForUser(userId, patch);
      const data = await getPromptsForUser(userId);
      res.json({
        prompts,
        isCustom: data.isCustom,
        defaults: DEFAULT_AI_PROMPTS,
        meta: AI_PROMPT_META,
      });
    } catch (error) {
      console.error("Save AI prompts error:", error);
      res.status(500).json({ message: "Nepodarilo sa uložiť prompty." });
    }
  });

  app.post("/api/ai-scanner/prompts/reset", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const keysRaw = req.body?.keys;
      let keys: AiPromptKey[] | undefined;
      if (Array.isArray(keysRaw)) {
        keys = keysRaw.filter(
          (k): k is AiPromptKey => k === "strategy" || k === "ticker" || k === "chat",
        );
      }

      const prompts = await resetPromptsForUser(userId, keys);
      const data = await getPromptsForUser(userId);
      res.json({
        prompts,
        isCustom: data.isCustom,
        defaults: DEFAULT_AI_PROMPTS,
        meta: AI_PROMPT_META,
      });
    } catch (error) {
      console.error("Reset AI prompts error:", error);
      res.status(500).json({ message: "Nepodarilo sa obnoviť prompty." });
    }
  });

  app.get("/api/ai-scanner/chats", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiScannerChatTables();
      const chats = await listChatsByUser(userId);
      res.json({ chats });
    } catch (error) {
      console.error("List AI chats error:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať históriu chatu." });
    }
  });

  app.get("/api/ai-scanner/chats/:id", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiScannerChatTables();
      const chatId = String((req as any).params?.id || "");
      const loaded = await getChatForUser(userId, chatId);
      if (!loaded) return res.status(404).json({ message: "Chat neexistuje." });
      res.json({
        chat: {
          id: loaded.chat.id,
          title: loaded.chat.title,
          kind: loaded.chat.kind,
          context: loaded.chat.context,
          createdAt: loaded.chat.createdAt,
          updatedAt: loaded.chat.updatedAt,
        },
        messages: loaded.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        })),
      });
    } catch (error) {
      console.error("Get AI chat error:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať chat." });
    }
  });

  app.post("/api/ai-scanner/chats", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiScannerChatTables();

      const kind = String(req.body?.kind || "").trim();
      if (kind !== "strategy" && kind !== "ticker") {
        return res.status(400).json({ message: "Neplatný typ chatu." });
      }
      const context = req.body?.context;
      if (context == null || typeof context !== "object") {
        return res.status(400).json({ message: "Chýba kontext analýzy." });
      }

      let title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
      if (!title) {
        title =
          kind === "ticker"
            ? `Ticker ${(context as any).ticker || "analýza"}`
            : `Stratégia ${(context as any).strategy?.label || (context as any).strategyId || "skener"}`;
      }

      const chat = await createChat({ userId, title, kind, context });
      res.status(201).json({
        chat: {
          id: chat.id,
          title: chat.title,
          kind: chat.kind,
          context: chat.context,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
        },
        messages: [],
      });
    } catch (error) {
      console.error("Create AI chat error:", error);
      res.status(500).json({ message: "Nepodarilo sa vytvoriť chat." });
    }
  });

  app.post("/api/ai-scanner/chats/:id/messages", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiScannerChatTables();

      if (!process.env.ANTHROPIC_API_KEY?.trim()) {
        return res.status(503).json({
          message: "AI Skener nie je nakonfigurovaný. Nastav ANTHROPIC_API_KEY na serveri.",
        });
      }

      const chatId = String((req as any).params?.id || "");
      const content = typeof req.body?.content === "string" ? req.body.content : "";
      if (!content.trim()) {
        return res.status(400).json({ message: "Správa je prázdna." });
      }

      const result = await appendUserMessageAndReply({ userId, chatId, content });
      res.json({
        userMessage: {
          id: result.userMessage.id,
          role: result.userMessage.role,
          content: result.userMessage.content,
          createdAt: result.userMessage.createdAt,
        },
        assistantMessage: {
          id: result.assistantMessage.id,
          role: result.assistantMessage.role,
          content: result.assistantMessage.content,
          createdAt: result.assistantMessage.createdAt,
        },
      });
    } catch (error) {
      console.error("AI chat message error:", error);
      const msg = error instanceof Error ? error.message : "Nepodarilo sa odoslať správu.";
      if (msg === "CHAT_NOT_FOUND") return res.status(404).json({ message: "Chat neexistuje." });
      if (msg === "EMPTY_MESSAGE") return res.status(400).json({ message: "Správa je prázdna." });
      if (msg === "MESSAGE_TOO_LONG") return res.status(400).json({ message: "Správa je príliš dlhá." });
      res.status(502).json({ message: msg });
    }
  });

  app.delete("/api/ai-scanner/chats/:id", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      await ensureAiScannerChatTables();
      const chatId = String((req as any).params?.id || "");
      const ok = await deleteChatForUser(userId, chatId);
      if (!ok) return res.status(404).json({ message: "Chat neexistuje." });
      res.json({ ok: true });
    } catch (error) {
      console.error("Delete AI chat error:", error);
      res.status(500).json({ message: "Nepodarilo sa zmazať chat." });
    }
  });
}
