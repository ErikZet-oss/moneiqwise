import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { storage } from "./storage";
type LocalAuthUser = {
  claims: {
    sub: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    profile_image_url?: string;
  };
};

let localUserReady: Promise<void> | null = null;

function getLocalClaims() {
  return {
    sub: process.env.LOCAL_USER_ID || "local-user",
    email: process.env.LOCAL_USER_EMAIL || "local@example.com",
    first_name: process.env.LOCAL_USER_FIRST_NAME || "Local",
    last_name: process.env.LOCAL_USER_LAST_NAME || "User",
    profile_image_url: process.env.LOCAL_USER_PROFILE_IMAGE_URL || undefined,
  };
}

async function ensureLocalUserExists() {
  if (!localUserReady) {
    const claims = getLocalClaims();
    localUserReady = storage
      .upsertUser({
        id: claims.sub,
        email: claims.email,
        firstName: claims.first_name,
        lastName: claims.last_name,
        profileImageUrl: claims.profile_image_url,
      })
      .then(() => undefined);
  }
  await localUserReady;
}

export async function setupAuth(app: Express) {
  await ensureLocalUserExists();

  app.use(async (req: Request, _res: Response, next: NextFunction) => {
    try {
      await ensureLocalUserExists();
      (req as any).user = { claims: getLocalClaims() } as LocalAuthUser;
      (req as any).isAuthenticated = () => true;
      next();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/login", (_req: Request, res: Response) => {
    res.redirect("/");
  });

  app.get("/api/callback", (_req: Request, res: Response) => {
    res.redirect("/");
  });

  app.get("/api/logout", (_req: Request, res: Response) => {
    res.redirect("/");
  });
}

export const isAuthenticated: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const userId = (req as any).user?.claims?.sub;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  return next();
};

declare global {
  namespace Express {
    interface User {
      claims?: {
        sub?: string;
      };
    }
  }
}
