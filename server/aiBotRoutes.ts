import type { Express, Response } from "express";
import { ensureAiBotTables } from "./aiBot/store";
import {
  getAiBotBriefById,
  getAiBotSettings,
  getLatestAiBotBrief,
  listAiBotBriefs,
  saveAiBotSettings,
} from "./aiBot/store";
import {
  countUnreadAiBotAlerts,
  ensureAiAlertTables,
  getAiAlertSettings,
  listAiBotAlerts,
  markAiBotAlertsRead,
  saveAiAlertSettings,
} from "./aiBot/alertsStore";
import { isSmtpConfigured } from "./aiBot/mailer";
import { runAlertRadar } from "./aiBot/alertRadar";
import { runAiBotForUser } from "./aiBot/runner";
import { runDueAiBotSchedule } from "./aiBot/scheduler";
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
  void ensureAiAlertTables().catch((err) =>
    console.error("[ai-alerts] ensure tables failed:", err),
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

  app.get("/api/ai-bot/alert-settings", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const settings = await getAiAlertSettings(userId);
      res.json({
        ...settings,
        smtpConfigured: isSmtpConfigured(),
      });
    } catch (error) {
      console.error("ai-alerts settings get:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať nastavenia alertov." });
    }
  });

  app.put("/api/ai-bot/alert-settings", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const alertsEnabled =
        typeof req.body?.alertsEnabled === "boolean"
          ? req.body.alertsEnabled
          : undefined;
      const emailEnabled =
        typeof req.body?.emailEnabled === "boolean"
          ? req.body.emailEnabled
          : undefined;
      let priceThresholdPct: number | undefined;
      if (req.body?.priceThresholdPct != null) {
        const n = Number(req.body.priceThresholdPct);
        if (Number.isFinite(n)) priceThresholdPct = n;
      }
      const settings = await saveAiAlertSettings(userId, {
        alertsEnabled,
        emailEnabled,
        priceThresholdPct,
      });
      res.json({
        ...settings,
        smtpConfigured: isSmtpConfigured(),
      });
    } catch (error) {
      console.error("ai-alerts settings put:", error);
      res.status(500).json({ message: "Nepodarilo sa uložiť nastavenia alertov." });
    }
  });

  app.get("/api/ai-bot/alerts", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const limit = parseInt(String(req.query?.limit ?? "40"), 10);
      const alerts = await listAiBotAlerts(
        userId,
        Number.isFinite(limit) ? limit : 40,
      );
      res.json({ alerts });
    } catch (error) {
      console.error("ai-alerts list:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať alerty." });
    }
  });

  app.get("/api/ai-bot/alerts/unread-count", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const count = await countUnreadAiBotAlerts(userId);
      res.json({ count });
    } catch (error) {
      console.error("ai-alerts unread:", error);
      res.status(500).json({ message: "Nepodarilo sa spočítať neprečítané." });
    }
  });

  app.post("/api/ai-bot/alerts/mark-read", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const all = req.body?.all === true || req.body?.all === "1";
      const alertId =
        typeof req.body?.alertId === "string" ? req.body.alertId.trim() : undefined;
      if (!all && !alertId) {
        return res.status(400).json({ message: "Chýba alertId alebo all." });
      }
      const updated = await markAiBotAlertsRead(userId, { all, alertId });
      const count = await countUnreadAiBotAlerts(userId);
      res.json({ updated, count });
    } catch (error) {
      console.error("ai-alerts mark-read:", error);
      res.status(500).json({ message: "Nepodarilo sa označiť ako prečítané." });
    }
  });

  app.get("/api/ai-bot/brief/latest", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const portfolioId =
        typeof req.query?.portfolio === "string" ? req.query.portfolio : null;
      const brief = await getLatestAiBotBrief(userId, portfolioId);
      if (brief) {
        if (brief.portfolioId === "all") {
          brief.portfolioLabel = "Všetky portfóliá";
        } else if (!brief.portfolioLabel || brief.portfolioLabel === brief.portfolioId) {
          const pf = await storage.getPortfolioById(brief.portfolioId, userId);
          if (pf) brief.portfolioLabel = pf.name;
        }
      }
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
      const limit = parseInt(String(req.query?.limit ?? "40"), 10);
      const briefs = await listAiBotBriefs(userId, Number.isFinite(limit) ? limit : 40);
      const portfolios = await storage.getPortfoliosByUser(userId);
      const nameById = new Map(portfolios.map((p) => [p.id, p.name]));
      const enriched = briefs.map((b) => ({
        ...b,
        portfolioLabel:
          b.portfolioId === "all"
            ? "Všetky portfóliá"
            : b.portfolioLabel && b.portfolioLabel !== b.portfolioId
              ? b.portfolioLabel
              : nameById.get(b.portfolioId) || b.portfolioLabel || "Portfólio",
      }));
      res.json({ briefs: enriched });
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
      if (brief.portfolioId !== "all" && (!brief.portfolioLabel || brief.portfolioLabel === brief.portfolioId)) {
        const pf = await storage.getPortfolioById(brief.portfolioId, userId);
        if (pf) brief.portfolioLabel = pf.name;
      } else if (brief.portfolioId === "all") {
        brief.portfolioLabel = "Všetky portfóliá";
      }
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
      if (!brief) {
        return res.status(400).json({ message: "Portfólio je prázdne." });
      }
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

  // Kick scheduleru (catch-up / externý cron).
  // 1) Header x-cron-secret = AI_BOT_CRON_SECRET
  // 2) alebo prihlásený user
  app.post(
    "/api/ai-bot/cron",
    (req: any, res: Response, next: any) => {
      const secret = process.env.AI_BOT_CRON_SECRET?.trim();
      const headerSecret = String(req.headers?.["x-cron-secret"] || "");
      if (secret && headerSecret && headerSecret === secret) {
        (req as any).__aiBotCronSecretOk = true;
        return next();
      }
      return isAuthenticated(req, res, next);
    },
    async (req: AuthReq, res) => {
      try {
        const force =
          req.query?.force === "1" ||
          req.body?.force === true ||
          req.body?.force === "1";
        const result = await runDueAiBotSchedule(new Date(), { force });
        const radar = await runAlertRadar(new Date(), { force });
        res.json({ ...result, radar });
      } catch (error) {
        console.error("ai-bot cron:", error);
        res.status(500).json({ message: "Cron beh zlyhal." });
      }
    },
  );
}
