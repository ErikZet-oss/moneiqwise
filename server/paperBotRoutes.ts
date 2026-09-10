import type { Express, Response } from "express";
import { ensurePaperBotTables } from "./paperBot/store";
import {
  createPaperBot,
  deletePaperBot,
  getPaperBot,
  listEquityTicks,
  listPaperBots,
  listPaperLogs,
  listTrades,
  updatePaperBotStatus,
} from "./paperBot/store";
import {
  computeBotEquity,
  killPaperBot,
  tickPaperBot,
} from "./paperBot/engine";
import { DEFAULT_EXITS, DEFAULT_RISK, PIPELINE_STAGES, STRATEGY_META, type PaperStrategyId } from "./paperBot/types";
import { runPaperBotSchedulerTick } from "./paperBot/scheduler";
import { computePaperBotStats } from "./paperBot/stats";
import { runPaperBacktest } from "./paperBot/backtest";
import { DEFAULT_CUSTOM_STRATEGY, parseCustomStrategy } from "./paperBot/customStrategy";
import { isSmtpConfigured } from "./aiBot/mailer";
import { storage } from "./storage";
import { getUsSession, getPaperBotTickMs } from "./paperBot/session";

type AuthReq = {
  user?: { claims?: { sub?: string } };
  body?: any;
  query?: any;
  params?: any;
};

function requireUserId(req: AuthReq, res: Response): string | null {
  const userId = req.user?.claims?.sub;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return userId;
}

function parseSymbols(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,;\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }
  return [];
}

export function registerPaperBotRoutes(app: Express, isAuthenticated: any) {
  void ensurePaperBotTables().catch((err) =>
    console.error("[paper-bot] ensure tables failed:", err),
  );

  app.get("/api/paper-bots/strategies", isAuthenticated, (_req, res) => {
    res.json({
      strategies: Object.entries(STRATEGY_META).map(([id, meta]) => ({
        id,
        ...meta,
      })),
      defaultRisk: DEFAULT_RISK,
      defaultExits: DEFAULT_EXITS,
      defaultCustomStrategy: DEFAULT_CUSTOM_STRATEGY,
      pipelineStages: PIPELINE_STAGES,
      smtpConfigured: isSmtpConfigured(),
      session: getUsSession(),
      tickMs: getPaperBotTickMs(),
    });
  });

  app.get("/api/paper-bots", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const bots = await listPaperBots(userId);
      res.json({ bots });
    } catch (error) {
      console.error("paper-bots list:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať paper botov." });
    }
  });

  app.post("/api/paper-bots", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const name = String(req.body?.name || "Paper Bot").trim();
      const startingCash = Number(req.body?.startingCash);
      const symbols = parseSymbols(req.body?.symbols);
      const strategyId = (String(req.body?.strategyId || "ema_rsi_trend") ||
        "ema_rsi_trend") as PaperStrategyId;
      if (!Number.isFinite(startingCash) || startingCash < 10) {
        return res
          .status(400)
          .json({ message: "Zadaj počiatočný kapitál (min. 10)." });
      }
      if (symbols.length === 0) {
        return res
          .status(400)
          .json({ message: "Zadaj aspoň jeden ticker (napr. AAPL, MSFT)." });
      }
      if (!(strategyId in STRATEGY_META)) {
        return res.status(400).json({ message: "Neznáma stratégia." });
      }
      const risk = {
        dailyLossLimitPct: Number(
          req.body?.dailyLossLimitPct ?? DEFAULT_RISK.dailyLossLimitPct,
        ),
        maxDrawdownPct: Number(
          req.body?.maxDrawdownPct ?? DEFAULT_RISK.maxDrawdownPct,
        ),
        maxOpenPositions: Number(
          req.body?.maxOpenPositions ?? DEFAULT_RISK.maxOpenPositions,
        ),
        maxPositionPct: Number(
          req.body?.maxPositionPct ?? DEFAULT_RISK.maxPositionPct,
        ),
      };
      const exits = {
        trailingAtrMult: Number(
          req.body?.trailingAtrMult ?? DEFAULT_EXITS.trailingAtrMult,
        ),
        takeProfitPct: Number(
          req.body?.takeProfitPct ?? DEFAULT_EXITS.takeProfitPct,
        ),
        hardStopPct: Number(
          req.body?.hardStopPct ?? DEFAULT_EXITS.hardStopPct,
        ),
      };
      const aiInfluencePct = Number(req.body?.aiInfluencePct ?? 20);
      const aiMinConfidence = Number(req.body?.aiMinConfidence ?? 60);
      let notifyEmail =
        typeof req.body?.notifyEmail === "string"
          ? req.body.notifyEmail.trim()
          : "";
      if (!notifyEmail) {
        try {
          const user = await storage.getUser(userId);
          notifyEmail = String((user as any)?.email || "").trim();
        } catch {
          /* ignore */
        }
      }
      const notifyOnTrade = !!req.body?.notifyOnTrade;
      const customStrategy =
        strategyId === "custom"
          ? parseCustomStrategy(req.body?.customStrategy) ||
            DEFAULT_CUSTOM_STRATEGY
          : req.body?.customStrategy
            ? parseCustomStrategy(req.body.customStrategy)
            : null;
      const bot = await createPaperBot({
        userId,
        name,
        startingCash,
        currency: String(req.body?.currency || "EUR"),
        strategyId,
        customStrategy,
        symbols,
        risk,
        exits,
        aiInfluencePct,
        aiMinConfidence,
        notifyEmail: notifyEmail || null,
        notifyOnTrade,
      });
      res.status(201).json({ bot });
    } catch (error) {
      console.error("paper-bots create:", error);
      res.status(500).json({ message: "Nepodarilo sa vytvoriť paper bota." });
    }
  });

  // Before /:id routes
  app.post(
    "/api/paper-bots/backtest",
    isAuthenticated,
    async (req: AuthReq, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const symbols = parseSymbols(req.body?.symbols);
        const strategyId = String(
          req.body?.strategyId || "ema_rsi_trend",
        ) as PaperStrategyId;
        const startingCash = Number(req.body?.startingCash ?? 10000);
        if (symbols.length === 0) {
          return res.status(400).json({ message: "Zadaj tickery pre backtest." });
        }
        if (!(strategyId in STRATEGY_META)) {
          return res.status(400).json({ message: "Neznáma stratégia." });
        }
        const customStrategy =
          strategyId === "custom"
            ? parseCustomStrategy(req.body?.customStrategy) ||
              DEFAULT_CUSTOM_STRATEGY
            : null;
        const result = await runPaperBacktest({
          symbols,
          strategyId,
          customStrategy,
          startingCash: Number.isFinite(startingCash) ? startingCash : 10000,
          maxPositionPct: Number(
            req.body?.maxPositionPct ?? DEFAULT_RISK.maxPositionPct,
          ),
          maxOpenPositions: Number(
            req.body?.maxOpenPositions ?? DEFAULT_RISK.maxOpenPositions,
          ),
          exits: {
            trailingAtrMult: Number(
              req.body?.trailingAtrMult ?? DEFAULT_EXITS.trailingAtrMult,
            ),
            takeProfitPct: Number(
              req.body?.takeProfitPct ?? DEFAULT_EXITS.takeProfitPct,
            ),
            hardStopPct: Number(
              req.body?.hardStopPct ?? DEFAULT_EXITS.hardStopPct,
            ),
          },
          lookbackBars: Number(req.body?.lookbackBars ?? 180),
        });
        res.json({ result });
      } catch (error) {
        console.error("paper-bots backtest:", error);
        res.status(500).json({ message: "Backtest zlyhal." });
      }
    },
  );

  app.post(
    "/api/paper-bots/scheduler/tick",
    isAuthenticated,
    async (req: AuthReq, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const result = await runPaperBotSchedulerTick();
        res.json(result);
      } catch (error) {
        console.error("paper-bots scheduler:", error);
        res.status(500).json({ message: "Scheduler tick zlyhal." });
      }
    },
  );

  app.get(
    "/api/paper-bots/:id",
    isAuthenticated,
    async (req: AuthReq, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const snapshot = await computeBotEquity(String(req.params.id), userId);
        if (!snapshot) {
          return res.status(404).json({ message: "Bot nenájdený." });
        }
        const [trades, logs, equity, stats] = await Promise.all([
          listTrades(snapshot.bot.id, userId, 80),
          listPaperLogs(snapshot.bot.id, userId, 150),
          listEquityTicks(snapshot.bot.id, userId, 120),
          computePaperBotStats(snapshot.bot, snapshot.equity),
        ]);
        res.json({
          ...snapshot,
          trades,
          logs,
          equityCurve: equity,
          stats,
        });
      } catch (error) {
        console.error("paper-bots get:", error);
        res.status(500).json({ message: "Nepodarilo sa načítať bota." });
      }
    },
  );

  app.post(
    "/api/paper-bots/:id/start",
    isAuthenticated,
    async (req: AuthReq, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const bot = await updatePaperBotStatus(
          String(req.params.id),
          userId,
          "running",
        );
        if (!bot) return res.status(404).json({ message: "Bot nenájdený." });
        // Immediate first tick so user sees activity
        void tickPaperBot(bot.id, userId).catch((err) =>
          console.error("[paper-bot] start tick:", err),
        );
        res.json({ bot });
      } catch (error) {
        console.error("paper-bots start:", error);
        res.status(500).json({ message: "Nepodarilo sa spustiť bota." });
      }
    },
  );

  app.post(
    "/api/paper-bots/:id/pause",
    isAuthenticated,
    async (req: AuthReq, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const bot = await updatePaperBotStatus(
          String(req.params.id),
          userId,
          "paused",
        );
        if (!bot) return res.status(404).json({ message: "Bot nenájdený." });
        res.json({ bot });
      } catch (error) {
        console.error("paper-bots pause:", error);
        res.status(500).json({ message: "Nepodarilo sa pozastaviť bota." });
      }
    },
  );

  app.post(
    "/api/paper-bots/:id/kill",
    isAuthenticated,
    async (req: AuthReq, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const closePositions = req.body?.closePositions !== false;
        const bot = await killPaperBot(
          String(req.params.id),
          userId,
          closePositions,
        );
        if (!bot) return res.status(404).json({ message: "Bot nenájdený." });
        res.json({ bot });
      } catch (error) {
        console.error("paper-bots kill:", error);
        res.status(500).json({ message: "Kill Switch zlyhal." });
      }
    },
  );

  app.post(
    "/api/paper-bots/:id/tick",
    isAuthenticated,
    async (req: AuthReq, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const bot = await getPaperBot(String(req.params.id), userId);
        if (!bot) return res.status(404).json({ message: "Bot nenájdený." });
        if (bot.status === "killed") {
          return res
            .status(400)
            .json({ message: "Bot je zabitý — vytvor nového." });
        }
        const result = await tickPaperBot(bot.id, userId);
        res.json({ result });
      } catch (error) {
        console.error("paper-bots tick:", error);
        res.status(500).json({ message: "Tick zlyhal." });
      }
    },
  );

  app.get(
    "/api/paper-bots/:id/logs",
    isAuthenticated,
    async (req: AuthReq, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const bot = await getPaperBot(String(req.params.id), userId);
        if (!bot) return res.status(404).json({ message: "Bot nenájdený." });
        const limit = Math.min(300, Math.max(20, Number(req.query?.limit) || 150));
        const logs = await listPaperLogs(bot.id, userId, limit);
        res.json({ logs });
      } catch (error) {
        console.error("paper-bots logs:", error);
        res.status(500).json({ message: "Nepodarilo sa načítať log." });
      }
    },
  );

  app.get(
    "/api/paper-bots/:id/positions",
    isAuthenticated,
    async (req: AuthReq, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const snapshot = await computeBotEquity(String(req.params.id), userId);
        if (!snapshot) {
          return res.status(404).json({ message: "Bot nenájdený." });
        }
        res.json({ positions: snapshot.positions });
      } catch (error) {
        console.error("paper-bots positions:", error);
        res.status(500).json({ message: "Nepodarilo sa načítať pozície." });
      }
    },
  );

  app.get(
    "/api/paper-bots/:id/trades",
    isAuthenticated,
    async (req: AuthReq, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const bot = await getPaperBot(String(req.params.id), userId);
        if (!bot) return res.status(404).json({ message: "Bot nenájdený." });
        const trades = await listTrades(bot.id, userId, 100);
        res.json({ trades });
      } catch (error) {
        console.error("paper-bots trades:", error);
        res.status(500).json({ message: "Nepodarilo sa načítať obchody." });
      }
    },
  );

  app.delete(
    "/api/paper-bots/:id",
    isAuthenticated,
    async (req: AuthReq, res) => {
      try {
        const userId = requireUserId(req, res);
        if (!userId) return;
        const ok = await deletePaperBot(String(req.params.id), userId);
        if (!ok) return res.status(404).json({ message: "Bot nenájdený." });
        res.json({ ok: true });
      } catch (error) {
        console.error("paper-bots delete:", error);
        res.status(500).json({ message: "Nepodarilo sa zmazať bota." });
      }
    },
  );

}
