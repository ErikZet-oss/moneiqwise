import type { Express, Response } from "express";
import {
  ensureAiAuditorTables,
  getAiAuditorUsage,
  getLatestAiAuditorRun,
} from "./aiAuditor/store";
import {
  resolveAuditorPortfolioId,
  runAiAuditorForUser,
} from "./aiAuditor/runner";

type AuthReq = {
  user?: { claims?: { sub?: string } };
  body?: any;
  query?: any;
};

function requireUserId(req: AuthReq, res: Response): string | null {
  const userId = req.user?.claims?.sub;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return userId;
}

function portfolioFromReq(req: AuthReq): string {
  const q = req.query?.portfolioId ?? req.query?.portfolio;
  const b = req.body?.portfolioId ?? req.body?.portfolio;
  const raw = typeof b === "string" && b.trim() ? b : typeof q === "string" ? q : "all";
  return raw.trim() || "all";
}

export function registerAiAuditorRoutes(app: Express, isAuthenticated: any) {
  void ensureAiAuditorTables().catch((err) =>
    console.error("[ai-auditor] ensure tables failed:", err),
  );

  app.get("/api/ai-auditor/usage", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const portfolioId = await resolveAuditorPortfolioId(
        userId,
        portfolioFromReq(req),
      );
      const usage = await getAiAuditorUsage(userId, portfolioId);
      res.json(usage);
    } catch (error) {
      console.error("ai-auditor usage:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať limit analýz." });
    }
  });

  app.get("/api/ai-auditor/latest", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const portfolioId = await resolveAuditorPortfolioId(
        userId,
        portfolioFromReq(req),
      );
      const [run, usage] = await Promise.all([
        getLatestAiAuditorRun(userId, portfolioId),
        getAiAuditorUsage(userId, portfolioId),
      ]);
      res.json({ run, usage });
    } catch (error) {
      console.error("ai-auditor latest:", error);
      res.status(500).json({ message: "Nepodarilo sa načítať posledný audit." });
    }
  });

  app.post("/api/ai-auditor/run", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const portfolioId = await resolveAuditorPortfolioId(
        userId,
        portfolioFromReq(req),
      );
      const { run, usage } = await runAiAuditorForUser({ userId, portfolioId });
      res.json({ run, usage });
    } catch (error: any) {
      if (error?.message === "AI_AUDITOR_LIMIT") {
        return res.status(429).json({
          message: "Denný limit 3 analýz pre toto portfólio je vyčerpaný.",
          usage: error.usage ?? null,
        });
      }
      console.error("ai-auditor run:", error);
      const msg =
        error instanceof Error && error.message
          ? error.message
          : "Nepodarilo sa spustiť AI Macro Audit.";
      res.status(502).json({ message: msg });
    }
  });
}
