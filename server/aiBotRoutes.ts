import type { Express, Response } from "express";
import { ensureAiBotTables } from "./aiBot/store";
import {
  getAiBotBriefById,
  getAiBotSettings,
  getLatestAiBotBrief,
  listAiBotBriefs,
  saveAiBotSettings,
} from "./aiBot/store";
import { runAiBotForUser } from "./aiBot/runner";
import { storage } from "./storage";

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

export function registerAiBotRoutes(app: Express, isAuthenticated: any) {
  void ensureAiBotTables().catch((err) =>
    console.error("[ai-bot] ensure tables failed:", err),
  );

  app.get("/api/ai-bot/settings", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const settings = await getAiBotSettings(userId);
      res.json(settings);
    } catch (error) {
      console.error("ai-bot settings get:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať nastavenia AI Bota." });
    }
  });

  app.put("/api/ai-bot/settings", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const enabled =
        typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined;
      let portfolioId =
        typeof req.body?.portfolioId === "string"
          ? req.body.portfolioId.trim()
          : undefined;
      if (portfolioId && portfolioId !== "all") {
        const pf = await storage.getPortfolioById(portfolioId, userId);
        if (!pf) {
          // Soft fallback — neblokuj UI pri zmazanom/starom ID.
          portfolioId = "all";
        }
      }
      const settings = await saveAiBotSettings(userId, { enabled, portfolioId });
      res.json(settings);
    } catch (error) {
      console.error("ai-bot settings put:", error);
      res.status(500).json({ message: "Nepodarilo sa uložiť nastavenia AI Bota." });
    }
  });

  app.get("/api/ai-bot/brief/latest", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const portfolioId =
        typeof req.query?.portfolio === "string" ? req.query.portfolio : null;
      const brief = await getLatestAiBotBrief(userId, portfolioId);
      res.json({ brief });
    } catch (error) {
      console.error("ai-bot latest brief:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať brief." });
    }
  });

  app.get("/api/ai-bot/briefs", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const limit = parseInt(String(req.query?.limit ?? "20"), 10);
      const briefs = await listAiBotBriefs(userId, Number.isFinite(limit) ? limit : 20);
      res.json({ briefs });
    } catch (error) {
      console.error("ai-bot briefs:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať históriu briefov." });
    }
  });

  app.get("/api/ai-bot/briefs/:id", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const brief = await getAiBotBriefById(userId, String(req.params?.id || ""));
      if (!brief) return res.status(404).json({ message: "Brief neexistuje." });
      res.json({ brief });
    } catch (error) {
      console.error("ai-bot brief by id:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať brief." });
    }
  });

  app.post("/api/ai-bot/run", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      if (!process.env.ANTHROPIC_API_KEY?.trim()) {
        return res.status(503).json({
          message: "AI Bot nie je nakonfigurovaný. Nastav ANTHROPIC_API_KEY na serveri.",
        });
      }
      let portfolioId =
        typeof req.body?.portfolioId === "string"
          ? req.body.portfolioId.trim()
          : undefined;
      if (!portfolioId) {
        const settings = await getAiBotSettings(userId);
        portfolioId = settings.portfolioId || "all";
      }
      if (portfolioId && portfolioId !== "all") {
        const pf = await storage.getPortfolioById(portfolioId, userId);
        if (!pf) {
          portfolioId = "all";
        }
      }
      const brief = await runAiBotForUser({
        userId,
        portfolioId,
        slot: "manual",
      });
      res.json({ brief });
    } catch (error) {
      console.error("ai-bot run:", error);
      const message =
        error instanceof Error ? error.message : "Nepodarilo sa spustiť AI Bot.";
      const lower = message.toLowerCase();
      const status =
        lower.includes("anthropic") ||
        lower.includes("http 4") ||
        lower.includes("model") ||
        lower.includes("api key") ||
        lower.includes("rate limit")
          ? 502
          : 500;
      res.status(status).json({ message });
    }
  });
}
