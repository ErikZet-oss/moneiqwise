import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import session from "express-session";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  Base64URLString,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from "@simplewebauthn/server";
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

type PasskeyRecord = {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  transports: string[];
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

let passkeyTableReady: Promise<void> | null = null;

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

function asRows<T = any>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = result as { rows?: T[] };
  return Array.isArray(r?.rows) ? r.rows : [];
}

function parseTransports(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return [];
}

function mapPasskeyRow(row: any): PasskeyRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    credentialId: String(row.credential_id),
    publicKey: String(row.public_key),
    counter: Number(row.counter || 0),
    deviceType: row.device_type === "multiDevice" ? "multiDevice" : "singleDevice",
    backedUp: row.backed_up === true,
    transports: parseTransports(row.transports),
    label: row.label != null ? String(row.label) : null,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  };
}

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

async function ensurePasskeyTable() {
  if (!passkeyTableReady) {
    passkeyTableReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS webauthn_passkeys (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid()::text,
          user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          credential_id TEXT NOT NULL UNIQUE,
          public_key TEXT NOT NULL,
          counter BIGINT NOT NULL DEFAULT 0,
          device_type TEXT NOT NULL DEFAULT 'singleDevice',
          backed_up BOOLEAN NOT NULL DEFAULT false,
          transports JSONB,
          label TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_used_at TIMESTAMPTZ
        );
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS webauthn_passkeys_user_idx
          ON webauthn_passkeys (user_id, created_at DESC);
      `);
    })();
  }
  return passkeyTableReady;
}

async function listPasskeysForUser(userId: string): Promise<PasskeyRecord[]> {
  await ensurePasskeyTable();
  const result = await db.execute(sql`
    SELECT id, user_id, credential_id, public_key, counter, device_type, backed_up, transports, label, created_at, last_used_at
    FROM webauthn_passkeys
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `);
  return asRows(result).map(mapPasskeyRow);
}

async function getPasskeyByCredentialId(credentialId: string): Promise<PasskeyRecord | null> {
  await ensurePasskeyTable();
  const result = await db.execute(sql`
    SELECT id, user_id, credential_id, public_key, counter, device_type, backed_up, transports, label, created_at, last_used_at
    FROM webauthn_passkeys
    WHERE credential_id = ${credentialId}
    LIMIT 1
  `);
  const row = asRows(result)[0];
  return row ? mapPasskeyRow(row) : null;
}

async function findAccountByUserId(userId: string) {
  const [account] = await db
    .select()
    .from(localAuthAccounts)
    .where(eq(localAuthAccounts.userId, userId))
    .limit(1);
  return account;
}

function firstHeaderValue(input: string | undefined): string {
  if (!input) return "";
  return input.split(",")[0]?.trim() ?? "";
}

function inferRequestOrigin(req: Request): string {
  const origin = firstHeaderValue(req.get("origin"));
  if (origin) return origin;
  const proto =
    firstHeaderValue(req.get("x-forwarded-proto")) || req.protocol || "http";
  const host =
    firstHeaderValue(req.get("x-forwarded-host")) ||
    firstHeaderValue(req.get("host"));
  if (!host) return "";
  return `${proto}://${host}`;
}

function getWebAuthnExpectedOrigins(req: Request): string[] {
  const set = new Set<string>();
  const envRaw = process.env.WEBAUTHN_ORIGIN || process.env.WEBAUTHN_ORIGINS || "";
  for (const part of envRaw.split(",")) {
    const value = part.trim();
    if (value) set.add(value);
  }
  const inferred = inferRequestOrigin(req);
  if (inferred) set.add(inferred);
  if (process.env.NODE_ENV !== "production") {
    set.add("http://localhost:5000");
    set.add("http://127.0.0.1:5000");
  }
  return Array.from(set);
}

function getWebAuthnRpID(req: Request): string {
  const configured = process.env.WEBAUTHN_RP_ID?.trim();
  if (configured) return configured;
  const host =
    firstHeaderValue(req.get("x-forwarded-host")) ||
    firstHeaderValue(req.get("host")) ||
    "localhost";
  return host.split(":")[0] || "localhost";
}

function getWebAuthnRpName(): string {
  return process.env.WEBAUTHN_RP_NAME?.trim() || "Moneiqwise";
}

function requireSessionUserId(req: Request, res: Response): string | null {
  const userId = req.session?.userId || (req as any).user?.claims?.sub;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return String(userId);
}

function clearPasskeyFlow(req: Request) {
  delete req.session.passkeyFlow;
}

function getPasskeyFlow(
  req: Request,
  action: "register" | "login",
): { action: "register" | "login"; challenge: string; userId: string | null; issuedAt: number } | null {
  const flow = req.session.passkeyFlow;
  if (!flow || flow.action !== action || !flow.challenge) return null;
  // Expire challenge after 5 minutes.
  if (!Number.isFinite(flow.issuedAt) || Date.now() - flow.issuedAt > 5 * 60 * 1000) {
    clearPasskeyFlow(req);
    return null;
  }
  return flow;
}

export function regenerateSession(req: Request): Promise<void> {
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

  void ensurePasskeyTable().catch((err) =>
    console.error("[auth] ensure passkey table failed:", err),
  );

  app.get("/api/auth/passkeys", async (req: Request, res: Response) => {
    try {
      const userId = requireSessionUserId(req, res);
      if (!userId) return;
      const passkeys = await listPasskeysForUser(userId);
      return res.json({
        passkeys: passkeys.map((p) => ({
          id: p.id,
          label: p.label,
          createdAt: p.createdAt,
          lastUsedAt: p.lastUsedAt,
          deviceType: p.deviceType,
          backedUp: p.backedUp,
          transports: p.transports,
        })),
      });
    } catch (error) {
      console.error("[auth] list passkeys failed:", error);
      return res.status(500).json({ message: "Nepodarilo sa načítať passkeys." });
    }
  });

  app.delete("/api/auth/passkeys/:id", async (req: Request, res: Response) => {
    try {
      const userId = requireSessionUserId(req, res);
      if (!userId) return;
      const passkeyId = String(req.params?.id || "").trim();
      if (!passkeyId) {
        return res.status(400).json({ message: "Chýba passkey identifikátor." });
      }
      const result = await db.execute(sql`
        DELETE FROM webauthn_passkeys
        WHERE id = ${passkeyId} AND user_id = ${userId}
        RETURNING id
      `);
      const deleted = asRows(result).length;
      if (!deleted) {
        return res.status(404).json({ message: "Passkey sa nenašiel." });
      }
      return res.json({ ok: true });
    } catch (error) {
      console.error("[auth] delete passkey failed:", error);
      return res.status(500).json({ message: "Nepodarilo sa zmazať passkey." });
    }
  });

  app.post("/api/auth/passkeys/options/register", async (req: Request, res: Response) => {
    try {
      const userId = requireSessionUserId(req, res);
      if (!userId) return;

      const [profile] = await db
        .select({
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          registrationStatus: users.registrationStatus,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      const account = await findAccountByUserId(userId);
      const email = account?.email?.trim() || profile?.email?.trim() || "";
      if (!email) {
        return res.status(400).json({ message: "K tomuto účtu nie je možné pridať passkey." });
      }
      if (!profile || profile.registrationStatus !== "approved") {
        return res.status(403).json({ message: "Účet nie je pripravený na passkey registráciu." });
      }

      const displayName =
        [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || email;
      const existingPasskeys = await listPasskeysForUser(userId);
      const options: PublicKeyCredentialCreationOptionsJSON =
        await generateRegistrationOptions({
          rpName: getWebAuthnRpName(),
          rpID: getWebAuthnRpID(req),
          userName: email,
          userID: new TextEncoder().encode(userId),
          userDisplayName: displayName,
          attestationType: "none",
          excludeCredentials: existingPasskeys.map((credential) => ({
            id: credential.credentialId as Base64URLString,
            transports: credential.transports,
          })),
          authenticatorSelection: {
            residentKey: "required",
            userVerification: "preferred",
          },
        });

      req.session.passkeyFlow = {
        action: "register",
        challenge: options.challenge,
        userId,
        issuedAt: Date.now(),
      };
      return res.json({ options });
    } catch (error) {
      console.error("[auth] passkey register options failed:", error);
      return res.status(500).json({ message: "Nepodarilo sa pripraviť registráciu passkey." });
    }
  });

  app.post("/api/auth/passkeys/verify/register", async (req: Request, res: Response) => {
    try {
      const userId = requireSessionUserId(req, res);
      if (!userId) return;
      const flow = getPasskeyFlow(req, "register");
      if (!flow || flow.userId !== userId) {
        return res.status(400).json({ message: "Registrácia passkey vypršala. Skúste to znova." });
      }

      const responseJSON = req.body?.response as RegistrationResponseJSON | undefined;
      if (!responseJSON || typeof responseJSON !== "object") {
        return res.status(400).json({ message: "Neplatná odpoveď autentifikátora." });
      }

      const verification: VerifiedRegistrationResponse =
        await verifyRegistrationResponse({
          response: responseJSON,
          expectedChallenge: flow.challenge,
          expectedOrigin: getWebAuthnExpectedOrigins(req),
          expectedRPID: getWebAuthnRpID(req),
          requireUserVerification: true,
        });

      if (!verification.verified || !verification.registrationInfo) {
        clearPasskeyFlow(req);
        return res.status(400).json({ message: "Registráciu passkey sa nepodarilo overiť." });
      }

      const credential = verification.registrationInfo.credential;
      const existing = await getPasskeyByCredentialId(credential.id);
      if (existing && existing.userId !== userId) {
        clearPasskeyFlow(req);
        return res.status(409).json({ message: "Táto passkey už patrí inému účtu." });
      }

      const label =
        typeof req.body?.label === "string" && req.body.label.trim()
          ? req.body.label.trim().slice(0, 80)
          : null;

      await db.execute(sql`
        INSERT INTO webauthn_passkeys (
          user_id, credential_id, public_key, counter, device_type, backed_up, transports, label, last_used_at
        ) VALUES (
          ${userId},
          ${credential.id},
          ${toBase64Url(credential.publicKey)},
          ${credential.counter},
          ${verification.registrationInfo.credentialDeviceType},
          ${verification.registrationInfo.credentialBackedUp},
          ${JSON.stringify(credential.transports ?? [])}::jsonb,
          ${label},
          NOW()
        )
        ON CONFLICT (credential_id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          public_key = EXCLUDED.public_key,
          counter = EXCLUDED.counter,
          device_type = EXCLUDED.device_type,
          backed_up = EXCLUDED.backed_up,
          transports = EXCLUDED.transports,
          label = COALESCE(EXCLUDED.label, webauthn_passkeys.label),
          last_used_at = NOW()
      `);

      clearPasskeyFlow(req);
      return res.json({ ok: true });
    } catch (error) {
      console.error("[auth] passkey register verify failed:", error);
      clearPasskeyFlow(req);
      return res.status(400).json({ message: "Overenie passkey zlyhalo." });
    }
  });

  app.post("/api/auth/passkeys/options/login", async (req: Request, res: Response) => {
    try {
      const rate = applyRateLimit(req, "passkey-login-options");
      if (!rate.allowed) {
        res.setHeader("Retry-After", rate.retryAfterSec.toString());
        return res.status(429).json({ message: "Príliš veľa pokusov. Skúste to neskôr." });
      }

      const emailInput =
        typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const account = emailInput ? await findAccountByEmail(emailInput) : null;
      const userPasskeys = account ? await listPasskeysForUser(account.userId) : [];
      const options: PublicKeyCredentialRequestOptionsJSON =
        await generateAuthenticationOptions({
          rpID: getWebAuthnRpID(req),
          userVerification: "preferred",
          allowCredentials:
            userPasskeys.length > 0
              ? userPasskeys.map((credential) => ({
                  id: credential.credentialId as Base64URLString,
                  transports: credential.transports,
                }))
              : undefined,
        });

      req.session.passkeyFlow = {
        action: "login",
        challenge: options.challenge,
        userId: account?.userId ?? null,
        issuedAt: Date.now(),
      };

      return res.json({ options });
    } catch (error) {
      console.error("[auth] passkey login options failed:", error);
      return res.status(500).json({ message: "Nepodarilo sa pripraviť passkey prihlásenie." });
    }
  });

  app.post("/api/auth/passkeys/verify/login", async (req: Request, res: Response) => {
    try {
      const flow = getPasskeyFlow(req, "login");
      if (!flow) {
        return res.status(400).json({ message: "Passkey prihlásenie vypršalo. Skúste to znova." });
      }

      const responseJSON = req.body?.response as AuthenticationResponseJSON | undefined;
      if (!responseJSON || typeof responseJSON !== "object") {
        return res.status(400).json({ message: "Neplatná passkey odpoveď." });
      }

      const stored = await getPasskeyByCredentialId(String(responseJSON.id || "").trim());
      if (!stored) {
        clearPasskeyFlow(req);
        return res.status(401).json({ message: "Passkey sa nenašla pre tento účet." });
      }
      if (flow.userId && flow.userId !== stored.userId) {
        clearPasskeyFlow(req);
        return res.status(401).json({ message: "Passkey nepatrí k zadanému účtu." });
      }

      const [acctUser] = await db
        .select({ registrationStatus: users.registrationStatus })
        .from(users)
        .where(eq(users.id, stored.userId))
        .limit(1);
      if (!acctUser) {
        clearPasskeyFlow(req);
        return res.status(401).json({ message: "Účet neexistuje." });
      }
      if (acctUser.registrationStatus === "pending") {
        clearPasskeyFlow(req);
        return res.status(403).json({ message: "Účet ešte nie je schválený." });
      }
      if (acctUser.registrationStatus === "blocked") {
        clearPasskeyFlow(req);
        return res.status(403).json({ message: "Účet je zablokovaný." });
      }

      const credential: WebAuthnCredential = {
        id: stored.credentialId as Base64URLString,
        publicKey: fromBase64Url(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports,
      };
      const verification: VerifiedAuthenticationResponse =
        await verifyAuthenticationResponse({
          response: responseJSON,
          expectedChallenge: flow.challenge,
          expectedOrigin: getWebAuthnExpectedOrigins(req),
          expectedRPID: getWebAuthnRpID(req),
          credential,
          requireUserVerification: true,
        });

      if (!verification.verified) {
        clearPasskeyFlow(req);
        return res.status(401).json({ message: "Passkey overenie zlyhalo." });
      }

      await db.execute(sql`
        UPDATE webauthn_passkeys
        SET
          counter = ${verification.authenticationInfo.newCounter},
          device_type = ${verification.authenticationInfo.credentialDeviceType},
          backed_up = ${verification.authenticationInfo.credentialBackedUp},
          last_used_at = NOW()
        WHERE id = ${stored.id}
      `);

      const account = await findAccountByUserId(stored.userId);
      if (account?.email) clearLoginFailures(account.email);

      await regenerateSession(req);
      req.session.userId = stored.userId;
      if (req.body?.rememberMe === true) {
        req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 30;
      } else {
        req.session.cookie.expires = false as any;
      }
      clearPasskeyFlow(req);
      return res.status(200).json({ ok: true });
    } catch (error) {
      console.error("[auth] passkey login verify failed:", error);
      clearPasskeyFlow(req);
      return res.status(401).json({ message: "Passkey prihlásenie zlyhalo." });
    }
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
      clearPasskeyFlow(req);
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
      clearPasskeyFlow(req);
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
    /** Temporary no-login demo session (secret /4d4b… link). */
    isDemo?: boolean;
    passkeyFlow?: {
      action: "register" | "login";
      challenge: string;
      userId: string | null;
      issuedAt: number;
    };
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
