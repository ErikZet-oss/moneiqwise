/**
 * Anglický Cardmarket low je pole „From“ na stránke produktu s language=1.
 * Articles API bez OAuth vracia 403. Bežný fetch stránky často zastaví Cloudflare,
 * preto sa stránka načíta v lokálnom Chrome mimo obrazovky.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const PAGE_TIMEOUT_MS = 22_000;

type PageSnapshot = {
  title: string;
  price: string;
  ready: boolean;
};

type Cdp = {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
};

let browserPromise: Promise<{ port: number; child: ChildProcess }> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function productUrl(productId: string): string {
  return `https://www.cardmarket.com/en/Pokemon/Products?idProduct=${productId}&language=1`;
}

export function parseEuroAmount(raw: string): number | null {
  const compact = raw.replace(/[^\d,.-]/g, "");
  if (!compact) return null;
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");
  let normalized = compact;
  if (lastComma >= 0 && lastComma > lastDot) {
    normalized = compact.replace(/\./g, "").replace(",", ".");
  } else if (lastDot >= 0) {
    normalized = compact.replace(/,/g, "");
  }
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function parseFromPriceHtml(html: string): number | null {
  const match = html.match(/<dt\b[^>]*>\s*From\s*<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/i);
  if (!match) return null;
  return parseEuroAmount(match[1] ?? "");
}

function looksLikeProductHtml(html: string): boolean {
  return /<dt\b[^>]*>\s*From\s*<\/dt>/i.test(html) || />Price Trend</i.test(html);
}

function chromeExecutable(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    process.platform === "win32" ? path.join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe") : null,
    process.platform === "win32"
      ? path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe")
      : null,
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe")
      : null,
    process.platform === "win32"
      ? path.join(process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe")
      : null,
    process.platform === "win32"
      ? path.join(process.env["PROGRAMFILES(X86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe")
      : null,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((item): item is string => Boolean(item));
  return candidates.find((item) => existsSync(item)) ?? null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function connectCdp(url: string): Promise<Cdp> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let nextId = 0;
    const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
    const timer = setTimeout(() => reject(new Error("CDP connect timeout")), 8000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve({
        send(method, params) {
          const id = ++nextId;
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id, method, params: params ?? {} }));
            setTimeout(() => {
              if (!pending.has(id)) return;
              pending.delete(id);
              rej(new Error(`CDP timeout ${method}`));
            }, 15000);
          });
        },
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: Record<string, unknown>;
        error?: { message?: string };
      };
      if (!message.id || !pending.has(message.id)) return;
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (!waiter) return;
      if (message.error) waiter.reject(new Error(message.error.message ?? "CDP error"));
      else waiter.resolve(message.result ?? {});
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP socket error"));
    });
  });
}

async function waitForDebugger(port: number): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      // Chrome ešte nepočúva.
    }
    await sleep(200);
  }
  throw new Error("Chrome debug port did not open");
}

async function startBrowser(): Promise<{ port: number; child: ChildProcess }> {
  const executable = chromeExecutable();
  if (!executable) throw new Error("Chrome/Edge is not installed");
  const port = await freePort();
  const profile = path.join(tmpdir(), "moneiqwise-cm-chrome");
  mkdirSync(profile, { recursive: true });
  const child = spawn(
    executable,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--disable-background-networking",
      "--window-position=-3200,-3200",
      "--window-size=1100,800",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  child.unref();
  child.once("exit", () => {
    browserPromise = null;
  });
  const stop = () => {
    try {
      child.kill();
    } catch {
      // Proces už nebeží.
    }
  };
  process.once("exit", stop);
  try {
    await waitForDebugger(port);
  } catch (error) {
    stop();
    throw error;
  }
  return { port, child };
}

function ensureBrowser(): Promise<{ port: number; child: ChildProcess }> {
  if (!browserPromise) {
    browserPromise = startBrowser().catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

async function pageSocket(port: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error("Chrome target list failed");
  const targets = (await res.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!page?.webSocketDebuggerUrl) throw new Error("Chrome page target missing");
  return page.webSocketDebuggerUrl;
}

async function readSnapshot(cdp: Cdp): Promise<PageSnapshot> {
  const result = await cdp.send("Runtime.evaluate", {
    expression:
      "(() => { const dts = [...document.querySelectorAll('dt')]; const from = dts.find((el) => (el.textContent || '').trim() === 'From'); const trend = dts.find((el) => (el.textContent || '').trim() === 'Price Trend'); const price = from && from.nextElementSibling ? from.nextElementSibling.textContent.trim() : ''; return JSON.stringify({ title: document.title || '', price, ready: Boolean(from || trend) }); })()",
    returnByValue: true,
  });
  const remote = result.result as { value?: string } | undefined;
  if (!remote?.value) return { title: "", price: "", ready: false };
  const parsed = JSON.parse(remote.value) as PageSnapshot;
  return { title: parsed.title ?? "", price: parsed.price ?? "", ready: parsed.ready === true };
}

async function readViaChrome(url: string): Promise<number | null> {
  const { port } = await ensureBrowser();
  const cdp = await connectCdp(await pageSocket(port));
  try {
    await cdp.send("Page.navigate", { url });
    const started = Date.now();
    let lastTitle = "";
    while (Date.now() - started < PAGE_TIMEOUT_MS) {
      await sleep(450);
      const snapshot = await readSnapshot(cdp);
      lastTitle = snapshot.title;
      const price = parseEuroAmount(snapshot.price);
      if (price != null) return price;
      if (/waiting room|access denied|attention required/i.test(snapshot.title) && Date.now() - started > 2500) {
        throw new Error("Cardmarket page blocked");
      }
      if (snapshot.ready && snapshot.price && Date.now() - started > 1500) return null;
    }
    throw new Error(`Cardmarket page timed out (${lastTitle || "empty"})`);
  } finally {
    cdp.close();
  }
}

async function readViaHttp(productId: string): Promise<number | null | "blocked"> {
  const res = await fetch(productUrl(productId), {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  const html = await res.text();
  if (/waiting room powered by cloudflare/i.test(html)) {
    throw new Error("Cardmarket waiting room");
  }
  if (!res.ok || !looksLikeProductHtml(html)) return "blocked";
  return parseFromPriceHtml(html);
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Najlacnejšia anglická ponuka z produktovej stránky (language=1). `null` = stránka sa načítala, ponuka nie je. */
export async function fetchEnglishFromProductPage(productId: string): Promise<number | null> {
  const http = await readViaHttp(productId).catch(() => "blocked" as const);
  if (http !== "blocked") return http;
  return enqueue(() => readViaChrome(productUrl(productId)));
}
