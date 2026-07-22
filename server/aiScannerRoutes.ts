import type { Express, Response } from "express";
import { createHash } from "crypto";
import {
  ensureAiScannerCacheTable,
  evaluateCacheKey,
  getCachePayload,
  screenerCacheKey,
  setCachePayload,
  tickerAnalyzeCacheKey,
  type ScreenerCachePayload,
} from "./finviz/cache";
import {
  evaluateStrategyPicks,
  evaluateTickerSnapshot,
  formatAnthropicError,
  type AiStrategyEvaluation,
  type AiTickerVerdict,
} from "./finviz/claudeEvaluator";
import { fetchQuoteSnapshot, fetchScreenerRows } from "./finviz/scraper";
import { getStrategy, listStrategies } from "./finviz/strategies";
import { fetchYahooMetricSnapshot } from "./finviz/yahooFallback";

type AuthReq = {
  user?: { claims?: { sub?: string } };
  body?: any;
};

function requireUserId(req: AuthReq, res: Response): string | null {
  const userId = req.user?.claims?.sub;
  if (!userId) {
    res.status(401).json({ message: "Unauthorized" });
    return null;
  }
  return userId;
}

function tickersFingerprint(tickers: string[]): string {
  return createHash("sha256").update(tickers.slice().sort().join(",")).digest("hex").slice(0, 24);
}

export function registerAiScannerRoutes(app: Express, isAuthenticated: any) {
  app.get("/api/ai-scanner/strategies", isAuthenticated, async (_req, res) => {
    res.json({
      strategies: listStrategies().map((s) => ({
        id: s.id,
        label: s.label,
        shortLabel: s.shortLabel,
        description: s.description,
      })),
    });
  });

  /** Spustí Finviz skener + Claude TOP 3 evaluáciu. */
  app.post("/api/ai-scanner/run", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      await ensureAiScannerCacheTable();

      if (!process.env.ANTHROPIC_API_KEY?.trim()) {
        return res.status(503).json({
          message: "AI Skener nie je nakonfigurovaný. Nastav ANTHROPIC_API_KEY na serveri.",
        });
      }

      const strategyId = String(req.body?.strategyId || "").trim();
      const strategy = getStrategy(strategyId);
      if (!strategy) {
        return res.status(400).json({ message: "Neplatná stratégia." });
      }

      const forceRefresh = req.body?.refresh === true;
      const filterFp = strategy.filters.join(",");
      const scanKey = screenerCacheKey(strategy.id, filterFp);

      let screener: ScreenerCachePayload | null = forceRefresh ? null : await getCachePayload(scanKey);
      if (!screener) {
        try {
          const fetched = await fetchScreenerRows(strategy);
          screener = {
            url: fetched.url,
            rows: fetched.rows.slice(0, 40),
            fetchedAt: new Date().toISOString(),
          };
          await setCachePayload(scanKey, strategy.id, screener);
        } catch (err) {
          console.error("Finviz screener failed:", err);
          return res.status(502).json({
            message: "Nepodarilo sa načítať dáta z Finviz. Skús neskôr.",
          });
        }
      }

      if (!screener.rows.length) {
        return res.json({
          strategy: {
            id: strategy.id,
            label: strategy.label,
            description: strategy.description,
          },
          insight: "Skener nenašiel žiadne akcie pre zvolené filtre. Skús inú stratégiu.",
          topPicks: [],
          scannedCount: 0,
          cached: !forceRefresh,
          finvizUrl: screener.url,
          model: null,
        });
      }

      const rowsForAi = screener.rows.slice(0, 20);
      const evalKey = evaluateCacheKey(strategy.id, tickersFingerprint(rowsForAi.map((r) => r.ticker)));
      let evaluation: AiStrategyEvaluation | null = forceRefresh ? null : await getCachePayload(evalKey);

      if (!evaluation) {
        try {
          evaluation = await evaluateStrategyPicks(strategy, rowsForAi);
          await setCachePayload(evalKey, strategy.id, evaluation);
        } catch (err) {
          console.error("Claude evaluation failed:", err);
          const detail = formatAnthropicError(err);
          if (err instanceof Error && err.message === "ANTHROPIC_API_KEY_MISSING") {
            return res.status(503).json({ message: detail });
          }
          // Soft fallback: top 3 bez AI komentára
          evaluation = {
            insight: `AI evaluácia zlyhala (${detail}). Zobrazujem prvé výsledky zo skenera bez komentára.`,
            topPicks: rowsForAi.slice(0, 3).map((r) => ({
              ticker: r.ticker,
              companyName: r.companyName,
              comment: "Bez AI komentára.",
              risk: "",
              metrics: {
                price: r.price,
                changePercent: r.changePercent,
                pe: r.pe,
                marketCap: r.marketCap,
                sector: r.sector,
              },
            })),
            model: "fallback",
          };
        }
      }

      res.json({
        strategy: {
          id: strategy.id,
          label: strategy.label,
          description: strategy.description,
        },
        insight: evaluation.insight,
        topPicks: evaluation.topPicks,
        scannedCount: screener.rows.length,
        cached: !forceRefresh,
        finvizUrl: screener.url,
        model: evaluation.model,
      });
    } catch (error) {
      console.error("AI scanner run error:", error);
      res.status(500).json({ message: "Nepodarilo sa spustiť AI Skener." });
    }
  });

  /** Vyhodnotenie jednej akcie podľa Finviz quote + Claude. */
  app.post("/api/ai-scanner/analyze-ticker", isAuthenticated, async (req: AuthReq, res) => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      await ensureAiScannerCacheTable();

      if (!process.env.ANTHROPIC_API_KEY?.trim()) {
        return res.status(503).json({
          message: "AI Skener nie je nakonfigurovaný. Nastav ANTHROPIC_API_KEY na serveri.",
        });
      }

      const ticker = String(req.body?.ticker || "").trim().toUpperCase();
      if (!ticker || ticker === "CASH") {
        return res.status(400).json({ message: "Zadaj platný ticker." });
      }

      const forceRefresh = req.body?.refresh === true;
      const cacheKey = tickerAnalyzeCacheKey(ticker);
      let cached: {
        snapshot: Awaited<ReturnType<typeof fetchQuoteSnapshot>>;
        verdict: AiTickerVerdict;
        dataSource?: "finviz" | "yahoo";
      } | null = forceRefresh ? null : await getCachePayload(cacheKey);

      if (!cached) {
        let snapshot: Awaited<ReturnType<typeof fetchQuoteSnapshot>> | null = null;
        let dataSource: "finviz" | "yahoo" = "finviz";

        try {
          snapshot = await fetchQuoteSnapshot(ticker);
          if (!snapshot.metrics || Object.keys(snapshot.metrics).length === 0) {
            snapshot = null;
          }
        } catch (err) {
          console.warn("Finviz quote failed, trying Yahoo fallback:", err);
          snapshot = null;
        }

        if (!snapshot) {
          try {
            const yahoo = await fetchYahooMetricSnapshot(ticker);
            snapshot = {
              ticker: yahoo.ticker,
              companyName: yahoo.companyName,
              metrics: yahoo.metrics,
            };
            dataSource = "yahoo";
          } catch (err) {
            console.error("Yahoo fallback failed:", err);
            return res.status(502).json({
              message: `Nepodarilo sa načítať metriky pre ${ticker} (Finviz aj Yahoo zlyhali).`,
            });
          }
        }

        let verdict: AiTickerVerdict;
        try {
          verdict = await evaluateTickerSnapshot(snapshot);
        } catch (err) {
          console.error("Claude ticker eval failed:", err);
          return res.status(502).json({ message: formatAnthropicError(err) });
        }

        cached = { snapshot, verdict, dataSource };
        await setCachePayload(cacheKey, "ticker", cached);
      }

      const pe = cached.snapshot.metrics["P/E"] ?? null;
      const price = cached.snapshot.metrics["Price"] ?? null;
      const change = cached.snapshot.metrics["Change"] ?? null;
      const rsi = cached.snapshot.metrics["RSI (14)"] ?? null;
      const marketCap = cached.snapshot.metrics["Market Cap"] ?? null;

      res.json({
        ticker: cached.verdict.ticker,
        companyName: cached.verdict.companyName,
        verdict: cached.verdict.verdict,
        summary: cached.verdict.summary,
        pros: cached.verdict.pros,
        cons: cached.verdict.cons,
        metrics: {
          pe,
          price,
          change,
          rsi,
          marketCap,
        },
        model: cached.verdict.model,
        dataSource: cached.dataSource ?? "finviz",
        cached: !forceRefresh,
      });
    } catch (error) {
      console.error("AI scanner analyze-ticker error:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Nepodarilo sa vyhodnotiť ticker.",
      });
    }
  });
}
