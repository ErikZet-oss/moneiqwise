import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { regenerateSession } from "./replitAuth";

/** Secret path prefix for temporary no-login demo links. */
export const DEMO_LINK_PREFIX = "4d4b";

function isDemoLinkEnabled(): boolean {
  const v = process.env.DEMO_LINK_ENABLED?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/**
 * Resolve userId from a path/token like `4d4brc2b7ik44gdsxvb89thu`
 * or a bare userId that was already stripped of the prefix.
 */
export function resolveDemoUserId(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim().replace(/^\//, "");
  if (!raw) return null;

  if (raw.startsWith(DEMO_LINK_PREFIX) && raw.length > DEMO_LINK_PREFIX.length) {
    const userId = raw.slice(DEMO_LINK_PREFIX.length);
    return /^[a-zA-Z0-9_-]+$/.test(userId) ? userId : null;
  }

  // Bare userId (the part after the prefix).
  if (/^[a-zA-Z0-9_-]+$/.test(raw) && !raw.startsWith(DEMO_LINK_PREFIX)) {
    return raw;
  }

  return null;
}

export function registerDemoLinkRoutes(app: Express) {
  app.post("/api/demo/enter", async (req: Request, res: Response) => {
    if (!isDemoLinkEnabled()) {
      return res.status(403).json({ message: "Demo link je vypnuty." });
    }

    const token =
      (typeof req.body?.path === "string" && req.body.path) ||
      (typeof req.body?.token === "string" && req.body.token) ||
      (typeof req.body?.userId === "string" && req.body.userId) ||
      "";

    const userId = resolveDemoUserId(token);
    if (!userId) {
      return res.status(400).json({ message: "Neplatny demo token." });
    }

    try {
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "Pouzivatel neexistuje." });
      }

      await regenerateSession(req);
      req.session.userId = userId;
      return res.status(200).json({ ok: true, userId });
    } catch (error) {
      console.error("[demo-link] enter failed:", error);
      return res.status(500).json({ message: "Demo prihlasenie zlyhalo." });
    }
  });
}
