import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import session from "express-session";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { parseAdminEmailSet } from "./adminAuth";
import { localAuthAccounts, localPasswordResets, users } from "@shared/schema";

type LocalAuthUser = {
  claims: {
    sub: string;
  };
};

type RateLimitState = {
  count: number;
  windowStartMs: number;
};

type LockoutState = {
  failedAttempts: number;
  lockedUntilMs?: number;
};

const endpointRateLimits = new Map<string, RateLimitState>();
const loginLockouts = new Map<string, LockoutState>();

function parseBool(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function getEmailAllowlist() {
  const raw = process.env.LOCAL_AUTH_EMAIL_ALLOWLIST;
  if (!raw) return null;
  const entries = raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
  if (entries.length === 0) return null;
  return new Set(entries);
}

/** True if request is clearly not from loopback (used only in production when LOCAL_AUTH_ALLOW_REMOTE=false). */
function isRemoteIp(ip: string | undefined) {
  if (!ip) return false;
  if (ip === "::1") return false;
  const v4 = ip.replace(/^::ffff:/i, "");
  if (v4.startsWith("127.")) return false;
  return true;
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function evaluatePasswordStrength(password: string) {
  const checks = {
    minLength: password.length >= 8,
    lowercase: /[a-z]/.test(password),
    uppercase: /[A-Z]/.test(password),
    number: /[0-9]/.test(password),
    symbol: /[^A-Za-z0-9]/.test(password),
  };
  const score = Object.values(checks).filter(Boolean).length;
  return { checks, score, isStrong: score >= 4 };
}

function getRateLimitConfig() {
  return {
    windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS || "60000"),
    maxRequests: Number(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS || "25"),
  };
}

function getLockoutConfig() {
  return {
    maxFailedAttempts: Number(process.env.AUTH_LOCKOUT_MAX_ATTEMPTS || "5"),
    lockoutMinutes: Number(process.env.AUTH_LOCKOUT_MINUTES || "15"),
  };
}

function applyRateLimit(req: Request, keyPrefix: string) {
  const { windowMs, maxRequests } = getRateLimitConfig();
  const ipKey = req.ip || "unknown-ip";
  const key = `${keyPrefix}:${ipKey}`;
  const now = Date.now();
  const state = endpointRateLimits.get(key);

  if (!state || now - state.windowStartMs >= windowMs) {
    endpointRateLimits.set(key, { count: 1, windowStartMs: now });
    return { allowed: true as const };
  }

  state.count += 1;
  endpointRateLimits.set(key, state);
  if (state.count <= maxRequests) {
    return { allowed: true as const };
  }

  const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - state.windowStartMs)) / 1000));
  return { allowed: false as const, retryAfterSec };
}

function getLockoutKey(email: string) {
  return email.trim().toLowerCase();
}

function isLoginLocked(email: string) {
  const key = getLockoutKey(email);
  const state = loginLockouts.get(key);
  if (!state?.lockedUntilMs) {
    return { locked: false as const };
  }

  const now = Date.now();
  if (state.lockedUntilMs <= now) {
    loginLockouts.delete(key);
    return { locked: false as const };
  }

  return { locked: true as const, retryAfterSec: Math.ceil((state.lockedUntilMs - now) / 1000) };
}

function registerLoginFailure(email: string) {
  const key = getLockoutKey(email);
  const config = getLockoutConfig();
  const state = loginLockouts.get(key) || { failedAttempts: 0 };
  state.failedAttempts += 1;
  if (state.failedAttempts >= config.maxFailedAttempts) {
    state.lockedUntilMs = Date.now() + config.lockoutMinutes * 60 * 1000;
    state.failedAttempts = 0;
  }
  loginLockouts.set(key, state);
  return state;
}

function clearLoginFailures(email: string) {
  loginLockouts.delete(getLockoutKey(email));
}

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie("moneiqwise.sid", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}

function validateCredentials(req: Request, res: Response, options: { requireStrongPassword?: boolean } = {}) {
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ message: "Email a heslo su povinne." });
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || password.length < 6) {
    res.status(400).json({ message: "Email musi byt vyplneny a heslo aspon 6 znakov." });
    return null;
  }

  if (options.requireStrongPassword) {
    const strength = evaluatePasswordStrength(password);
    if (!strength.isStrong) {
      res.status(400).json({ message: "Heslo je slabe. Pouzi aspon 8 znakov, velke/male pismeno, cislo a symbol." });
      return null;
    }
  }

  return { email: normalizedEmail, password };
}

async function findAccountByEmail(email: string) {
  const [account] = await db
    .select()
    .from(localAuthAccounts)
    .where(eq(localAuthAccounts.email, email));
  return account;
}

async function createAccount(
  email: string,
  password: string,
  firstName?: string,
  lastName?: string,
  registrationStatus: "approved" | "pending" | "blocked" = "approved",
) {
  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);

  const [user] = await db
    .insert(users)
    .values({
      email,
      firstName: firstName?.trim() || null,
      lastName: lastName?.trim() || null,
      profileImageUrl: null,
      registrationStatus,
    })
    .returning();

  await db.insert(localAuthAccounts).values({
    userId: user.id,
    email,
    passwordHash,
    passwordSalt: salt,
  });

  return user;
}

async function createPasswordReset(email: string, userId: string) {
  const token = randomBytes(24).toString("hex");
  const tokenHash = hashResetToken(token);
  const ttlMinutes = Number(process.env.LOCAL_AUTH_RESET_TOKEN_MINUTES || "30");
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  await db.insert(localPasswordResets).values({
    userId,
    email,
    tokenHash,
    expiresAt,
  });

  return { token, expiresAt };
}

async function consumePasswordReset(email: string, token: string) {
  const tokenHash = hashResetToken(token);
  const [record] = await db
    .select()
    .from(localPasswordResets)
    .where(
      and(
        eq(localPasswordResets.email, email),
        eq(localPasswordResets.tokenHash, tokenHash),
        isNull(localPasswordResets.usedAt),
        gt(localPasswordResets.expiresAt, new Date()),
      ),
    );

  if (!record) return null;

  await db
    .update(localPasswordResets)
    .set({ usedAt: new Date() })
    .where(eq(localPasswordResets.id, record.id));

  return record;
}

export async function setupAuth(app: Express) {
  const allowRemote = parseBool(process.env.LOCAL_AUTH_ALLOW_REMOTE, false);
  const sessionSecret = process.env.SESSION_SECRET || process.env.LOCAL_AUTH_SESSION_SECRET || "dev-only-change-me";
  const emailAllowlist = getEmailAllowlist();

  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.trim().length < 32)
  ) {
    throw new Error("SESSION_SECRET musi byt v produkcii nastaveny a mat aspon 32 znakov.");
  }

  app.set("trust proxy", 1);
  app.use(
    session({
      name: "moneiqwise.sid",
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 1000 * 60 * 60 * 24 * 14,
      },
    }),
  );

  const registrationRequiresApproval = parseBool(process.env.LOCAL_AUTH_REGISTRATION_REQUIRES_APPROVAL, false);
  const adminEmailSetForWarn = parseAdminEmailSet();
  if (registrationRequiresApproval && (!adminEmailSetForWarn || adminEmailSetForWarn.size === 0)) {
    console.warn(
      "[auth] LOCAL_AUTH_REGISTRATION_REQUIRES_APPROVAL je zapnuty, ale LOCAL_AUTH_ADMIN_EMAILS je prazdny — schvalovanie registracii nebude dostupne.",
    );
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    // V developmente neblokuj podľa IP (VPN / IPv6 / trust proxy často dajú zlé req.ip).
    // Na produkcii ostáva ochrana, ak LOCAL_AUTH_ALLOW_REMOTE=false.
    if (
      process.env.NODE_ENV === "production" &&
      !allowRemote &&
      isRemoteIp(req.ip)
    ) {
      return res.status(403).json({ message: "Local auth is enabled only for localhost requests." });
    }

    const sessionUserId = req.session?.userId;
    if (!sessionUserId) return next();
    (req as any).user = { claims: { sub: sessionUserId } } as LocalAuthUser;
    (req as any).isAuthenticated = () => true;
    return next();
  });

  app.post("/api/login", async (req: Request, res: Response) => {
    try {
      const values = validateCredentials(req, res);
      if (!values) return;
      const rememberMe = Boolean(req.body?.rememberMe);

      const rate = applyRateLimit(req, "login");
      if (!rate.allowed) {
        res.setHeader("Retry-After", rate.retryAfterSec.toString());
        return res.status(429).json({ message: "Prilis vela pokusov. Skus to o chvilu." });
      }

      const lock = isLoginLocked(values.email);
      if (lock.locked) {
        res.setHeader("Retry-After", lock.retryAfterSec.toString());
        return res.status(429).json({ message: "Ucet je docasne zamknuty po viacerych neuspesnych pokusoch." });
      }

      const account = await findAccountByEmail(values.email);
      if (!account) {
        return res.status(401).json({ message: "Nespravny email alebo heslo." });
      }
      if (!verifyPassword(values.password, account.passwordSalt, account.passwordHash)) {
        registerLoginFailure(values.email);
        return res.status(401).json({ message: "Nespravny email alebo heslo." });
      }

      const [acctUser] = await db
        .select({ registrationStatus: users.registrationStatus })
        .from(users)
        .where(eq(users.id, account.userId))
        .limit(1);
      if (!acctUser) {
        return res.status(401).json({ message: "Nespravny email alebo heslo." });
      }
      if (acctUser.registrationStatus === "pending") {
        return res.status(403).json({
          message: "Ucet este nie je schvaleny. Po schvaleni spravcom sa budes moct prihlasit.",
        });
      }
      if (acctUser.registrationStatus === "blocked") {
        return res.status(403).json({
          message: "Ucet je zablokovany. Kontaktuj spravcu aplikacie.",
        });
      }

      clearLoginFailures(values.email);
      await regenerateSession(req);
      req.session.userId = account.userId;
      if (rememberMe) {
        req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
      } else {
        req.session.cookie.expires = false as any;
      }
      return res.status(200).json({ ok: true });
    } catch (_error) {
      return res.status(500).json({ message: "Prihlasenie zlyhalo. Spusti `npm run db:push` a skus znova." });
    }
  });

  app.post("/api/register", async (req: Request, res: Response) => {
    try {
      const rate = applyRateLimit(req, "register");
      if (!rate.allowed) {
        res.setHeader("Retry-After", rate.retryAfterSec.toString());
        return res.status(429).json({ message: "Prilis vela pokusov o registraciu. Skus to neskor." });
      }

      const values = validateCredentials(req, res, { requireStrongPassword: true });
      if (!values) return;
      const rememberMe = Boolean(req.body?.rememberMe);

      if (emailAllowlist && !emailAllowlist.has(values.email)) {
        return res.status(403).json({ message: "Registracia je povolena iba pre schvalene emaily." });
      }

      const { firstName, lastName } = req.body ?? {};
      const existing = await findAccountByEmail(values.email);
      if (existing) {
        return res.status(409).json({ message: "Ucet s tymto emailom uz existuje." });
      }

      const userCount = await storage.countUsers();
      const isFirstUser = userCount === 0;
      const regStatus: "approved" | "pending" =
        !registrationRequiresApproval || isFirstUser ? "approved" : "pending";

      const user = await createAccount(
        values.email,
        values.password,
        typeof firstName === "string" ? firstName : undefined,
        typeof lastName === "string" ? lastName : undefined,
        regStatus,
      );

      if (regStatus === "pending") {
        return res.status(201).json({ ok: true, pendingApproval: true });
      }

      await regenerateSession(req);
      req.session.userId = user.id;
      if (rememberMe) {
        req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
      } else {
        req.session.cookie.expires = false as any;
      }
      return res.status(201).json({ ok: true });
    } catch (_error) {
      return res.status(500).json({ message: "Registracia zlyhala. Spusti `npm run db:push` a skus znova." });
    }
  });

  app.post("/api/forgot-password", async (req: Request, res: Response) => {
    const rate = applyRateLimit(req, "forgot-password");
    if (!rate.allowed) {
      res.setHeader("Retry-After", rate.retryAfterSec.toString());
      return res.status(429).json({ message: "Prilis vela reset pokusov. Skus to neskor." });
    }

    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email) {
      return res.status(400).json({ message: "Email je povinny." });
    }

    try {
      const account = await findAccountByEmail(email);
      if (!account) {
        return res.status(200).json({ ok: true });
      }

      const reset = await createPasswordReset(email, account.userId);
      const debugToken = process.env.NODE_ENV === "production" ? undefined : reset.token;
      return res.status(200).json({ ok: true, resetToken: debugToken });
    } catch (_error) {
      return res.status(500).json({ message: "Nepodarilo sa vytvorit reset token." });
    }
  });

  app.post("/api/reset-password", async (req: Request, res: Response) => {
    const rate = applyRateLimit(req, "reset-password");
    if (!rate.allowed) {
      res.setHeader("Retry-After", rate.retryAfterSec.toString());
      return res.status(429).json({ message: "Prilis vela pokusov o zmenu hesla. Skus to neskor." });
    }

    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
    if (!email || !token || !newPassword) {
      return res.status(400).json({ message: "Email, token a nove heslo su povinne." });
    }

    const strength = evaluatePasswordStrength(newPassword);
    if (!strength.isStrong) {
      return res.status(400).json({ message: "Nove heslo je slabe." });
    }

    try {
      const reset = await consumePasswordReset(email, token);
      if (!reset) {
        return res.status(400).json({ message: "Reset token je neplatny alebo expirovany." });
      }

      const account = await findAccountByEmail(email);
      if (!account) {
        return res.status(404).json({ message: "Ucet neexistuje." });
      }

      const salt = randomBytes(16).toString("hex");
      const passwordHash = hashPassword(newPassword, salt);
      await db
        .update(localAuthAccounts)
        .set({ passwordSalt: salt, passwordHash })
        .where(eq(localAuthAccounts.id, account.id));

      return res.status(200).json({ ok: true });
    } catch (_error) {
      return res.status(500).json({ message: "Reset hesla zlyhal." });
    }
  });

  app.post("/api/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Odhlasenie zlyhalo." });
      }
      clearSessionCookie(res);
      res.status(200).json({ ok: true });
    });
  });

  // Backward compatibility with old links.
  app.get("/api/login", (_req: Request, res: Response) => res.redirect("/"));
  app.get("/api/callback", (_req: Request, res: Response) => res.redirect("/"));
  app.get("/api/logout", (req: Request, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        return res.redirect("/");
      }
      clearSessionCookie(res);
      res.redirect("/");
    });
  });
}

export const isAuthenticated: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.claims?.sub;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const [u] = await db
      .select({ registrationStatus: users.registrationStatus })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!u) {
      await destroySession(req);
      clearSessionCookie(res);
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (u.registrationStatus === "blocked") {
      await destroySession(req);
      clearSessionCookie(res);
      return res.status(403).json({ message: "Ucet je zablokovany." });
    }
    if (u.registrationStatus === "pending") {
      await destroySession(req);
      clearSessionCookie(res);
      return res.status(403).json({ message: "Ucet caka na schvalenie." });
    }

    return next();
  } catch (err) {
    return next(err);
  }
};

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

declare global {
  namespace Express {
    interface User {
      claims?: {
        sub?: string;
      };
    }
  }
}
