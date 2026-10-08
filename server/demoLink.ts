import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { regenerateSession } from "./replitAuth";

/** Secret path prefix for temporary no-login demo links. */
export const DEMO_LINK_PREFIX = "4d4b";

/** Fixed demo account id (created on first enter if missing). */
export const DEMO_USER_ID = "rc2b7ik44gdsxvb89thu";

function isDemoLinkEnabled(): boolean {
  const v = process.env.DEMO_LINK_ENABLED?.trim().toLowerCase();
  // Default ON so the secret URL works on Render without extra env.
  // Turn off with DEMO_LINK_ENABLED=0 / false / off.
  if (v === undefined || v === "") return true;
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

/**
 * Valid demo path tokens: full `4d4brc2b7ik44gdsxvb89thu` or any `4d4b…`
 * that maps to the fixed demo user (path is just the secret, not a real user lookup).
 */
export function isValidDemoPathToken(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const raw = input.trim().replace(/^\//, "");
  if (!raw.startsWith(DEMO_LINK_PREFIX)) return false;
  if (raw.length <= DEMO_LINK_PREFIX.length) return false;
  return /^4d4b[a-zA-Z0-9_-]+$/.test(raw);
}

async function ensureDemoUser() {
  const existing = await storage.getUser(DEMO_USER_ID);
  if (existing) {
    if (existing.registrationStatus !== "approved") {
      await storage.updateUserRegistrationStatus(DEMO_USER_ID, "approved");
    }
    return existing;
  }

  const user = await storage.upsertUser({
    id: DEMO_USER_ID,
    email: "demo@moneiqwise.local",
    firstName: "Demo",
    lastName: "Účet",
    profileImageUrl: null,
    registrationStatus: "approved",
  });

  // Empty starter portfolio so dashboard has something to show / rename later.
  const portfolios = await storage.getPortfoliosByUser(DEMO_USER_ID);
  if (portfolios.length === 0) {
    await storage.createPortfolio({
      userId: DEMO_USER_ID,
      name: "Demo portfólio",
    });
  }

  return user;
}

export function registerDemoLinkRoutes(app: Express) {
  app.post("/api/demo/enter", async (req: Request, res: Response) => {
    if (!isDemoLinkEnabled()) {
      return res.status(403).json({ message: "Demo link je vypnuty." });
    }

    const token =
      (typeof req.body?.path === "string" && req.body.path) ||
      (typeof req.body?.token === "string" && req.body.token) ||
      "";

    if (!isValidDemoPathToken(token)) {
      return res.status(400).json({ message: "Neplatny demo token." });
    }

    try {
      await ensureDemoUser();
      await regenerateSession(req);
      req.session.userId = DEMO_USER_ID;
      return res.status(200).json({ ok: true, userId: DEMO_USER_ID });
    } catch (error) {
      console.error("[demo-link] enter failed:", error);
      return res.status(500).json({ message: "Demo prihlasenie zlyhalo." });
    }
  });
}
