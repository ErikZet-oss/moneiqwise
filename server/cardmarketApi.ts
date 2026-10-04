/**
 * Cardmarket Marketplace API 2.0.
 * Anglický low (idLanguage=1) pre raw, graded aj sealed.
 * Dedicated app: Account → API na cardmarket.com, štyri tokeny do prostredia.
 */

import { createHmac, randomBytes } from "node:crypto";

const API_ROOT = "https://apiv2.cardmarket.com/ws/v2.0";
const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 15 * 60 * 1000;
const PAGE_SIZE = 100;
const GRADED_MAX_PAGES = 8;

export type CardmarketLowKind =
  | { kind: "raw" }
  | { kind: "sealed" }
  | { kind: "graded"; company: string; grade: string };

export type CardmarketLowResult =
  | { status: "ok"; low: number | null }
  | { status: "unavailable" }
  | { status: "unconfigured" };

type Article = {
  price?: number | string;
  comments?: string;
  comment?: string;
  isSigned?: boolean | string | number;
  isAltered?: boolean | string | number;
  language?: { idLanguage?: number | string };
};

type CacheEntry = { at: number; result: CardmarketLowResult };

const cache = new Map<string, CacheEntry>();
let unconfiguredLogged = false;
let failureLoggedAt = 0;

export function cardmarketCredentials(): {
  appToken: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
} | null {
  const appToken = process.env.CARDMARKET_APP_TOKEN?.trim() ?? "";
  const appSecret = process.env.CARDMARKET_APP_SECRET?.trim() ?? "";
  const accessToken = process.env.CARDMARKET_ACCESS_TOKEN?.trim() ?? "";
  const accessSecret = process.env.CARDMARKET_ACCESS_TOKEN_SECRET?.trim() ?? "";
  if (!appToken || !appSecret || !accessToken || !accessSecret) return null;
  return { appToken, appSecret, accessToken, accessSecret };
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** OAuth 1.0a hlavička podľa Cardmarket dokumentácie. `url` je bez query. */
export function cardmarketAuthorizationHeader(input: {
  method: string;
  url: string;
  query?: Record<string, string>;
  appToken: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
  nonce: string;
  timestamp: string;
}): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: input.appToken,
    oauth_nonce: input.nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: input.timestamp,
    oauth_token: input.accessToken,
    oauth_version: "1.0",
  };
  const pairs = Object.entries({ ...oauth, ...(input.query ?? {}) })
    .map(([key, value]) => [rfc3986(key), rfc3986(value)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const paramString = pairs.map(([key, value]) => `${key}=${value}`).join("&");
  const base = `${input.method.toUpperCase()}&${rfc3986(input.url)}&${rfc3986(paramString)}`;
  const signingKey = `${rfc3986(input.appSecret)}&${rfc3986(input.accessSecret)}`;
  const signature = createHmac("sha1", signingKey).update(base).digest("base64");
  const headerPairs = [
    `realm="${input.url}"`,
    `oauth_consumer_key="${rfc3986(input.appToken)}"`,
    `oauth_token="${rfc3986(input.accessToken)}"`,
    `oauth_nonce="${rfc3986(input.nonce)}"`,
    `oauth_timestamp="${input.timestamp}"`,
    `oauth_signature_method="HMAC-SHA1"`,
    `oauth_version="1.0"`,
    `oauth_signature="${signature}"`,
  ];
  return `OAuth ${headerPairs.join(", ")}`;
}

function flagOn(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function articlePrice(article: Article): number | null {
  if (flagOn(article.isSigned) || flagOn(article.isAltered)) return null;
  const languageId = article.language?.idLanguage;
  if (languageId != null && Number(languageId) !== 1) return null;
  const price = typeof article.price === "number" ? article.price : Number(article.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return price;
}

function articleComment(article: Article): string {
  return `${article.comments ?? ""} ${article.comment ?? ""}`.trim();
}

const GRADE_MENTION = /\b(PSA|BGS|CGC|ACE|SGC|TAG)\s*\d/i;

function gradePattern(company: string, grade: string): RegExp {
  const companySafe = company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const gradeSafe = grade.replace(".", "\\.");
  const tail = grade.endsWith(".5") ? "(?!\\d)" : "(?!\\d|\\.5)";
  return new RegExp(`\\b${companySafe}\\s*${gradeSafe}${tail}`, "i");
}

function articleList(body: unknown): Article[] {
  if (!body || typeof body !== "object") return [];
  const raw = (body as { article?: unknown }).article;
  if (Array.isArray(raw)) return raw.filter((row): row is Article => !!row && typeof row === "object");
  if (raw && typeof raw === "object") return [raw as Article];
  return [];
}

function wantsArticle(article: Article, filter: CardmarketLowKind): boolean {
  const comment = articleComment(article);
  if (filter.kind === "graded") return gradePattern(filter.company, filter.grade).test(comment);
  if (filter.kind === "sealed" && /\b(opened|not sealed)\b/i.test(comment)) return false;
  return !GRADE_MENTION.test(comment);
}

async function fetchArticlePage(
  productId: string,
  start: number,
): Promise<{ articles: Article[]; total: number | null }> {
  const creds = cardmarketCredentials();
  if (!creds) throw new Error("Cardmarket API is not configured");
  const path = `${API_ROOT}/output.json/articles/${productId}`;
  const query = { idLanguage: "1", maxResults: String(PAGE_SIZE), start: String(start) };
  const search = new URLSearchParams(query).toString();
  const nonce = randomBytes(8).toString("hex");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const authorization = cardmarketAuthorizationHeader({
    method: "GET",
    url: path,
    query,
    ...creds,
    nonce,
    timestamp,
  });
  const res = await fetch(`${path}?${search}`, {
    headers: { Authorization: authorization, Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204 || res.status === 404) return { articles: [], total: 0 };
  if (!res.ok) throw new Error(`Cardmarket articles ${res.status}`);
  const range = res.headers.get("content-range") ?? "";
  const totalMatch = /(\d+)\+?$/.exec(range);
  const total = totalMatch ? Number(totalMatch[1]) : null;
  return { articles: articleList(await res.json()), total };
}

async function lowestMatching(productId: string, filter: CardmarketLowKind): Promise<number | null> {
  const pages = filter.kind === "graded" ? GRADED_MAX_PAGES : 1;
  let best: number | null = null;
  for (let page = 0; page < pages; page += 1) {
    const { articles, total } = await fetchArticlePage(productId, page * PAGE_SIZE);
    for (const article of articles) {
      if (!wantsArticle(article, filter)) continue;
      const price = articlePrice(article);
      if (price == null) continue;
      if (best == null || price < best) best = price;
    }
    if (articles.length < PAGE_SIZE) break;
    if (total != null && (page + 1) * PAGE_SIZE >= total) break;
    if (filter.kind !== "graded") break;
  }
  return best;
}

/** Najlacnejšia anglická ponuka. `unconfigured` = chýbajú tokeny, `unavailable` = API neodpovedalo. */
export async function fetchCardmarketEnglishLow(
  productId: string,
  filter: CardmarketLowKind,
): Promise<CardmarketLowResult> {
  const id = productId.trim();
  if (!/^\d{1,12}$/.test(id)) return { status: "ok", low: null };
  if (!cardmarketCredentials()) {
    if (!unconfiguredLogged) {
      unconfiguredLogged = true;
      console.warn(
        "Cardmarket API nie je nastavené. Doplň CARDMARKET_APP_TOKEN, CARDMARKET_APP_SECRET, CARDMARKET_ACCESS_TOKEN a CARDMARKET_ACCESS_TOKEN_SECRET.",
      );
    }
    return { status: "unconfigured" };
  }
  const cacheKey = `${id}:${filter.kind}:${filter.kind === "graded" ? `${filter.company}${filter.grade}` : ""}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    const ttl = cached.result.status === "ok" ? SUCCESS_TTL_MS : FAILURE_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.result;
  }
  try {
    const result: CardmarketLowResult = { status: "ok", low: await lowestMatching(id, filter) };
    cache.set(cacheKey, { at: Date.now(), result });
    return result;
  } catch (error) {
    if (Date.now() - failureLoggedAt > FAILURE_TTL_MS) {
      failureLoggedAt = Date.now();
      console.warn("Cardmarket API articles failed:", error);
    }
    const result: CardmarketLowResult = { status: "unavailable" };
    cache.set(cacheKey, { at: Date.now(), result });
    return result;
  }
}
