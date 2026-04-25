import {
  users,
  transactions,
  holdings,
  portfolioSnapshots,
  userAssetMetadata,
  userSettings,
  portfolios,
  optionTrades,
  type User,
  type UpsertUser,
  type Transaction,
  type InsertTransaction,
  type Holding,
  type PortfolioSnapshot,
  type InsertHolding,
  type UserSettings,
  type Portfolio,
  type InsertPortfolio,
  type OptionTrade,
  type InsertOptionTrade,
  type UserAssetMetadata,
  type AssetClassValue,
} from "@shared/schema";
import type { AllExchangeRates } from "./convertAmountBetween";
import { netLedgerCashEur } from "./netLedgerCashEur";
import { db } from "./db";
import { buildEurPerUnitByTxnIdForTransactions } from "./eurAtTransactionDate";
import { computeFifoRealizedGainsFromTransactions } from "@shared/fifoRealizedGains";
import { sumCloseTradeCashFlowEurFromRows } from "@shared/cashFromTransactions";
import { dividendNetEur } from "./pnlBreakdown";
import { eq, and, desc, asc, sql, isNull, or, inArray, notInArray } from "drizzle-orm";

export interface IStorage {
  // User operations - required for Replit Auth
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Portfolio operations
  getPortfoliosByUser(userId: string): Promise<Portfolio[]>;
  getVisiblePortfolioIdsByUser(userId: string): Promise<string[]>;
  /** Všetky ID portfólií (vrátane skrytých) — pre históriu transakcií pri zobrazení „všetky“. */
  getAllPortfolioIdsByUser(userId: string): Promise<string[]>;
  getPortfolioById(portfolioId: string, userId: string): Promise<Portfolio | undefined>;
  getDefaultPortfolio(userId: string): Promise<Portfolio | undefined>;
  createPortfolio(portfolio: InsertPortfolio): Promise<Portfolio>;
  getNextPortfolioSortOrder(userId: string): Promise<number>;
  reorderPortfolios(userId: string, orderedIds: string[]): Promise<void>;
  updatePortfolio(portfolioId: string, userId: string, data: Partial<InsertPortfolio>): Promise<Portfolio>;
  deletePortfolioCascade(portfolioId: string, userId: string): Promise<void>;
  deletePortfolio(portfolioId: string, userId: string): Promise<void>;
  ensureDefaultPortfolio(userId: string): Promise<Portfolio>;
  migrateUnassignedToPortfolio(
    userId: string,
    targetPortfolioId: string,
  ): Promise<{
    transactionsMoved: number;
    holdingsMoved: number;
    holdingsMerged: number;
    optionTradesMoved: number;
  }>;
  /** Transakcie/holdingy s portfolio_id NULL alebo odkazom na už neexistujúce portfólio. */
  deleteOrphanPortfolioReferences(userId: string): Promise<{
    transactionsDeleted: number;
    holdingsDeleted: number;
    optionTradesDeleted: number;
  }>;
  deleteAllTransactionData(userId: string): Promise<{
    transactionsDeleted: number;
    holdingsDeleted: number;
    optionTradesDeleted: number;
  }>;
  
  // Transaction operations
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  getTransactionsByUser(userId: string, portfolioId?: string | null): Promise<Transaction[]>;
  getTransactionsByUserAndTicker(userId: string, ticker: string, portfolioId?: string | null): Promise<Transaction[]>;
  updateTransaction(transactionId: string, userId: string, data: Partial<InsertTransaction>): Promise<void>;
  deleteTransaction(transactionId: string, userId: string): Promise<void>;
  getTransactionById(transactionId: string, userId: string): Promise<Transaction | undefined>;
  
  // Holdings operations
  getHoldingsByUser(userId: string, portfolioId?: string | null): Promise<Holding[]>;
  upsertPortfolioSnapshot(row: {
    userId: string;
    scopeKey: string;
    date: string;
    totalValueEur: number;
    investedAmountEur: number;
    dailyProfitEur: number;
  }): Promise<PortfolioSnapshot>;
  getPortfolioSnapshots(
    userId: string,
    scopeKey: string,
    startDateIso?: string,
    endDateIso?: string,
  ): Promise<PortfolioSnapshot[]>;
  getLastPortfolioSnapshot(userId: string, scopeKey: string): Promise<PortfolioSnapshot | undefined>;
  /** Single fetch for Overview page: holdings + totals per visible portfolio (no N× round-trips). */
  getOverviewBundle(
    userId: string,
    rates: AllExchangeRates,
  ): Promise<{
    byPortfolioId: Record<
      string,
      {
        holdings: Holding[];
        totalRealized: number;
        /** Súčet hotovostných riadkov XTB „close trade“ (DEPOSIT/WITHDRAWAL) v EUR — mimo FIFO. */
        closeTradeNetEur: number;
        /** Čisté dividendy v EUR (dividendNetEur), ako v P&amp;L rozklade. */
        dividendNet: number;
        cashEur: number;
      }
    >;
  }>;
  /**
   * Disponibilná hotovosť (EUR) na portfólio: vklady/výbery, nákupy, predaje,
   * dividendy, dane (nie len súčet vkladov, aby nebol dvojpripočet k trh. hodnote).
   */
  getComputedCashEurByPortfolioIds(
    userId: string,
    portfolioIds: string[],
    rates: AllExchangeRates,
  ): Promise<Record<string, number>>;
  /**
   * Rovnaká množina transakcií ako pri výpočte hotovosti pre zvolené portfólio:
   * pri predvolenom portfóliu vrátane riadkov s `portfolio_id` NULL.
   */
  getTransactionsForCashBreakdown(
    userId: string,
    portfolioParam: string,
  ): Promise<Transaction[]>;
  getHoldingByUserAndTicker(userId: string, ticker: string, portfolioId?: string | null): Promise<Holding | undefined>;
  getHoldingsForTickerAcrossPortfolios(userId: string, ticker: string): Promise<Holding[]>;
  getTransactionsForTickerAcrossPortfolios(userId: string, ticker: string): Promise<Transaction[]>;
  upsertHolding(userId: string, ticker: string, companyName: string, shares: string, averageCost: string, totalInvested: string, portfolioId?: string | null): Promise<Holding>;
  deleteHolding(userId: string, ticker: string, portfolioId?: string | null): Promise<void>;
  getUserAssetMetadataMap(
    userId: string,
    tickers?: string[],
  ): Promise<Record<string, { sector: string | null; country: string | null; assetType: AssetClassValue | null }>>;
  upsertUserAssetMetadata(
    userId: string,
    ticker: string,
    data: { sector?: string | null; country?: string | null; assetType?: AssetClassValue | null },
  ): Promise<UserAssetMetadata | null>;
  
  // User settings operations
  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  upsertUserSettings(userId: string, settings: { preferredCurrency?: string | null }): Promise<UserSettings>;
  
  // Option trades operations
  createOptionTrade(trade: InsertOptionTrade): Promise<OptionTrade>;
  getOptionTradesByUser(userId: string, portfolioId?: string | null): Promise<OptionTrade[]>;
  getOptionTradeById(tradeId: string, userId: string): Promise<OptionTrade | undefined>;
  updateOptionTrade(tradeId: string, userId: string, data: Partial<InsertOptionTrade>): Promise<OptionTrade>;
  deleteOptionTrade(tradeId: string, userId: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  // Portfolio operations
  async getPortfoliosByUser(userId: string): Promise<Portfolio[]> {
    return await db
      .select()
      .from(portfolios)
      .where(eq(portfolios.userId, userId))
      .orderBy(asc(portfolios.sortOrder), asc(portfolios.createdAt));
  }

  async getVisiblePortfolioIdsByUser(userId: string): Promise<string[]> {
    const rows = await db
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(
        and(
          eq(portfolios.userId, userId),
          or(isNull(portfolios.isHidden), eq(portfolios.isHidden, false))
        )
      );
    return rows.map((r) => r.id);
  }

  async getAllPortfolioIdsByUser(userId: string): Promise<string[]> {
    const rows = await db
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(eq(portfolios.userId, userId));
    return rows.map((r) => r.id);
  }

  async getPortfolioById(portfolioId: string, userId: string): Promise<Portfolio | undefined> {
    const [portfolio] = await db
      .select()
      .from(portfolios)
      .where(
        and(
          eq(portfolios.id, portfolioId),
          eq(portfolios.userId, userId)
        )
      );
    return portfolio;
  }

  async getDefaultPortfolio(userId: string): Promise<Portfolio | undefined> {
    const [portfolio] = await db
      .select()
      .from(portfolios)
      .where(
        and(
          eq(portfolios.userId, userId),
          eq(portfolios.isDefault, true)
        )
      );
    return portfolio;
  }

  async createPortfolio(portfolio: InsertPortfolio): Promise<Portfolio> {
    const [result] = await db
      .insert(portfolios)
      .values(portfolio)
      .returning();
    return result;
  }

  async getNextPortfolioSortOrder(userId: string): Promise<number> {
    const rows = await db
      .select({ sortOrder: portfolios.sortOrder })
      .from(portfolios)
      .where(eq(portfolios.userId, userId));
    if (rows.length === 0) return 0;
    const max = Math.max(...rows.map((r) => Number(r.sortOrder ?? 0)));
    return (Number.isFinite(max) ? max : 0) + 1;
  }

  async reorderPortfolios(userId: string, orderedIds: string[]): Promise<void> {
    const serverOrdered = await this.getPortfoliosByUser(userId);
    const serverIds = serverOrdered.map((p) => p.id);
    const serverSet = new Set(serverIds);

    const seen = new Set<string>();
    const fromClient: string[] = [];
    for (const id of orderedIds) {
      if (typeof id !== "string" || !serverSet.has(id) || seen.has(id)) continue;
      seen.add(id);
      fromClient.push(id);
    }

    const merged: string[] = [...fromClient];
    for (const id of serverIds) {
      if (!seen.has(id)) {
        merged.push(id);
        seen.add(id);
      }
    }

    await db.transaction(async (tx) => {
      for (let i = 0; i < merged.length; i++) {
        await tx
          .update(portfolios)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(and(eq(portfolios.id, merged[i]!), eq(portfolios.userId, userId)));
      }
    });
  }

  async updatePortfolio(portfolioId: string, userId: string, data: Partial<InsertPortfolio>): Promise<Portfolio> {
    const [result] = await db
      .update(portfolios)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(portfolios.id, portfolioId),
          eq(portfolios.userId, userId)
        )
      )
      .returning();
    if (!result) {
      throw new Error("UPDATE_PORTFOLIO_NO_ROW");
    }
    return result;
  }

  async deletePortfolio(portfolioId: string, userId: string): Promise<void> {
    await db
      .delete(portfolios)
      .where(
        and(
          eq(portfolios.id, portfolioId),
          eq(portfolios.userId, userId)
        )
      );
  }

  async deletePortfolioCascade(portfolioId: string, userId: string): Promise<void> {
    // Remove all data referencing this portfolio, then the portfolio itself.
    await db
      .delete(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.portfolioId, portfolioId)
        )
      );

    await db
      .delete(optionTrades)
      .where(
        and(
          eq(optionTrades.userId, userId),
          eq(optionTrades.portfolioId, portfolioId)
        )
      );

    await db
      .delete(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.portfolioId, portfolioId)
        )
      );

    await db
      .delete(portfolios)
      .where(
        and(
          eq(portfolios.id, portfolioId),
          eq(portfolios.userId, userId)
        )
      );
  }

  async ensureDefaultPortfolio(userId: string): Promise<Portfolio> {
    const existing = await this.getDefaultPortfolio(userId);
    if (existing) return existing;

    const allPortfolios = await this.getPortfoliosByUser(userId);
    if (allPortfolios.length > 0) {
      // Make the first one default
      return await this.updatePortfolio(allPortfolios[0].id, userId, { isDefault: true });
    }

    // Create new default portfolio
    return await this.createPortfolio({
      userId,
      name: "Hlavné portfólio",
      isDefault: true,
    });
  }

  async migrateUnassignedToPortfolio(
    userId: string,
    targetPortfolioId: string,
  ): Promise<{
    transactionsMoved: number;
    holdingsMoved: number;
    holdingsMerged: number;
    optionTradesMoved: number;
  }> {
    // 1) Transactions — straight bulk update.
    const txnResult: any = await db
      .update(transactions)
      .set({ portfolioId: targetPortfolioId })
      .where(and(eq(transactions.userId, userId), isNull(transactions.portfolioId)));

    // 2) Option trades — same.
    const optResult: any = await db
      .update(optionTrades)
      .set({ portfolioId: targetPortfolioId })
      .where(and(eq(optionTrades.userId, userId), isNull(optionTrades.portfolioId)));

    // 3) Holdings need merging if the target portfolio already has a row for
    //    the same ticker (for example when an earlier import dropped one into
    //    portfolio_id = NULL and a later one into the default portfolio).
    const orphans = await db
      .select()
      .from(holdings)
      .where(and(eq(holdings.userId, userId), isNull(holdings.portfolioId)));

    let holdingsMoved = 0;
    let holdingsMerged = 0;
    for (const h of orphans) {
      const [existing] = await db
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.ticker, h.ticker),
            eq(holdings.portfolioId, targetPortfolioId),
          ),
        );

      if (existing) {
        const existingShares = parseFloat(existing.shares);
        const existingInvested = parseFloat(existing.totalInvested);
        const addShares = parseFloat(h.shares);
        const addInvested = parseFloat(h.totalInvested);
        const newShares = existingShares + addShares;
        const newInvested = existingInvested + addInvested;
        const newAvgCost = newShares > 0 ? newInvested / newShares : 0;

        await db
          .update(holdings)
          .set({
            shares: newShares.toFixed(8),
            averageCost: newAvgCost.toFixed(4),
            totalInvested: newInvested.toFixed(4),
            companyName: existing.companyName || h.companyName,
          })
          .where(eq(holdings.id, existing.id));

        await db.delete(holdings).where(eq(holdings.id, h.id));
        holdingsMerged += 1;
      } else {
        await db
          .update(holdings)
          .set({ portfolioId: targetPortfolioId })
          .where(eq(holdings.id, h.id));
        holdingsMoved += 1;
      }
    }

    return {
      transactionsMoved: txnResult?.rowCount ?? 0,
      holdingsMoved,
      holdingsMerged,
      optionTradesMoved: optResult?.rowCount ?? 0,
    };
  }

  async deleteOrphanPortfolioReferences(userId: string): Promise<{
    transactionsDeleted: number;
    holdingsDeleted: number;
    optionTradesDeleted: number;
  }> {
    const rows = await db
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(eq(portfolios.userId, userId));
    const validIds = rows.map((r) => r.id);

    if (validIds.length === 0) {
      return {
        transactionsDeleted: 0,
        holdingsDeleted: 0,
        optionTradesDeleted: 0,
      };
    }

    const txnOrphan = or(
      isNull(transactions.portfolioId),
      notInArray(transactions.portfolioId, validIds),
    );
    const txnResult: any = await db
      .delete(transactions)
      .where(and(eq(transactions.userId, userId), txnOrphan));

    const holdingOrphan = or(
      isNull(holdings.portfolioId),
      notInArray(holdings.portfolioId, validIds),
    );
    const holdingsResult: any = await db
      .delete(holdings)
      .where(and(eq(holdings.userId, userId), holdingOrphan));

    const optOrphan = or(
      isNull(optionTrades.portfolioId),
      notInArray(optionTrades.portfolioId, validIds),
    );
    const optResult: any = await db
      .delete(optionTrades)
      .where(and(eq(optionTrades.userId, userId), optOrphan));

    return {
      transactionsDeleted: txnResult?.rowCount ?? 0,
      holdingsDeleted: holdingsResult?.rowCount ?? 0,
      optionTradesDeleted: optResult?.rowCount ?? 0,
    };
  }

  async deleteAllTransactionData(userId: string): Promise<{
    transactionsDeleted: number;
    holdingsDeleted: number;
    optionTradesDeleted: number;
  }> {
    // Wipes ALL trading data for the user across every portfolio as well as
    // any orphaned rows with portfolio_id = NULL. Portfolios themselves and
    // user settings/API keys are intentionally preserved.
    const holdingsResult: any = await db
      .delete(holdings)
      .where(eq(holdings.userId, userId));

    const optResult: any = await db
      .delete(optionTrades)
      .where(eq(optionTrades.userId, userId));

    const txnResult: any = await db
      .delete(transactions)
      .where(eq(transactions.userId, userId));

    return {
      transactionsDeleted: txnResult?.rowCount ?? 0,
      holdingsDeleted: holdingsResult?.rowCount ?? 0,
      optionTradesDeleted: optResult?.rowCount ?? 0,
    };
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    // Remove empty id to let database generate UUID
    const { id, ...rest } = transaction;
    const dataToInsert = id && id.trim() !== '' ? transaction : rest;
    
    const [result] = await db
      .insert(transactions)
      .values(dataToInsert)
      .returning();
    return result;
  }

  async getTransactionsByUser(userId: string, portfolioId?: string | null): Promise<Transaction[]> {
    if (portfolioId && portfolioId !== "all") {
      return await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.portfolioId, portfolioId)
          )
        )
        .orderBy(desc(transactions.transactionDate));
    }

    // Všetky transakcie používateľa (všetky portfóliá + NULL / „osirelé“ id po zmenách).
    // Predtým: filter inArray(portfolioId, …) vylučoval riadky, ktoré už nepasujú na existujúce id.
    return await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.transactionDate));
  }

  async getTransactionsByUserAndTicker(userId: string, ticker: string, portfolioId?: string | null): Promise<Transaction[]> {
    if (portfolioId && portfolioId !== "all") {
      return await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.ticker, ticker),
            eq(transactions.portfolioId, portfolioId)
          )
        )
        .orderBy(desc(transactions.transactionDate));
    }
    
    return await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.ticker, ticker),
        ),
      )
      .orderBy(desc(transactions.transactionDate));
  }

  async getTransactionById(transactionId: string, userId: string): Promise<Transaction | undefined> {
    const [transaction] = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.userId, userId)
        )
      );
    return transaction;
  }

  async updateTransaction(transactionId: string, userId: string, data: Partial<InsertTransaction>): Promise<void> {
    await db
      .update(transactions)
      .set(data)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.userId, userId)
        )
      );
  }

  async deleteTransaction(transactionId: string, userId: string): Promise<void> {
    await db
      .delete(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.userId, userId)
        )
      );
  }

  async getHoldingsByUser(userId: string, portfolioId?: string | null): Promise<Holding[]> {
    if (portfolioId && portfolioId !== "all") {
      return await db
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.portfolioId, portfolioId)
          )
        );
    }
    
    // When viewing all portfolios, aggregate holdings by ticker (excluding hidden portfolios)
    const visibleIds = await this.getVisiblePortfolioIdsByUser(userId);
    const portfolioFilter = visibleIds.length > 0
      ? or(isNull(holdings.portfolioId), inArray(holdings.portfolioId, visibleIds))
      : isNull(holdings.portfolioId);

    const allHoldings = await db
      .select()
      .from(holdings)
      .where(and(eq(holdings.userId, userId), portfolioFilter));
    
    // Aggregate by ticker
    const aggregatedMap = new Map<string, Holding>();
    
    for (const holding of allHoldings) {
      const existing = aggregatedMap.get(holding.ticker);
      if (existing) {
        const existingShares = parseFloat(existing.shares);
        const existingInvested = parseFloat(existing.totalInvested);
        const newShares = parseFloat(holding.shares);
        const newInvested = parseFloat(holding.totalInvested);
        
        const totalShares = existingShares + newShares;
        const totalInvested = existingInvested + newInvested;
        const avgCost = totalShares > 0 ? totalInvested / totalShares : 0;
        
        aggregatedMap.set(holding.ticker, {
          ...existing,
          shares: totalShares.toString(),
          totalInvested: totalInvested.toString(),
          averageCost: avgCost.toString(),
          portfolioId: null, // Aggregated across portfolios
        });
      } else {
        aggregatedMap.set(holding.ticker, { ...holding, portfolioId: null });
      }
    }
    
    return Array.from(aggregatedMap.values());
  }

  async upsertPortfolioSnapshot(row: {
    userId: string;
    scopeKey: string;
    date: string;
    totalValueEur: number;
    investedAmountEur: number;
    dailyProfitEur: number;
  }): Promise<PortfolioSnapshot> {
    const [saved] = await db
      .insert(portfolioSnapshots)
      .values({
        userId: row.userId,
        scopeKey: row.scopeKey,
        date: row.date,
        totalValueEur: String(row.totalValueEur),
        investedAmountEur: String(row.investedAmountEur),
        dailyProfitEur: String(row.dailyProfitEur),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          portfolioSnapshots.userId,
          portfolioSnapshots.scopeKey,
          portfolioSnapshots.date,
        ],
        set: {
          totalValueEur: String(row.totalValueEur),
          investedAmountEur: String(row.investedAmountEur),
          dailyProfitEur: String(row.dailyProfitEur),
          updatedAt: new Date(),
        },
      })
      .returning();
    return saved;
  }

  async getPortfolioSnapshots(
    userId: string,
    scopeKey: string,
    startDateIso?: string,
    endDateIso?: string,
  ): Promise<PortfolioSnapshot[]> {
    const whereParts = [
      eq(portfolioSnapshots.userId, userId),
      eq(portfolioSnapshots.scopeKey, scopeKey),
    ];
    if (startDateIso) whereParts.push(sql`${portfolioSnapshots.date} >= ${startDateIso}`);
    if (endDateIso) whereParts.push(sql`${portfolioSnapshots.date} <= ${endDateIso}`);
    return await db
      .select()
      .from(portfolioSnapshots)
      .where(and(...whereParts))
      .orderBy(asc(portfolioSnapshots.date));
  }

  async getLastPortfolioSnapshot(userId: string, scopeKey: string): Promise<PortfolioSnapshot | undefined> {
    const [row] = await db
      .select()
      .from(portfolioSnapshots)
      .where(
        and(
          eq(portfolioSnapshots.userId, userId),
          eq(portfolioSnapshots.scopeKey, scopeKey),
        ),
      )
      .orderBy(desc(portfolioSnapshots.date))
      .limit(1);
    return row;
  }

  async getComputedCashEurByPortfolioIds(
    userId: string,
    portfolioIds: string[],
    rates: AllExchangeRates,
  ): Promise<Record<string, number>> {
    if (portfolioIds.length === 0) return {};
    const map: Record<string, number> = Object.fromEntries(
      portfolioIds.map((id) => [id, 0]),
    );
    const defaultPf = await this.getDefaultPortfolio(userId);
    const defaultId = defaultPf?.id;
    const mergeUnassignedToDefault =
      defaultId != null && portfolioIds.includes(defaultId);

    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          mergeUnassignedToDefault
            ? or(
                inArray(transactions.portfolioId, portfolioIds),
                isNull(transactions.portfolioId),
              )
            : inArray(transactions.portfolioId, portfolioIds),
        ),
      );
    const byPid = new Map<string, Transaction[]>();
    for (const id of portfolioIds) byPid.set(id, []);
    for (const t of rows) {
      const pid = t.portfolioId;
      if (pid && byPid.has(pid)) {
        byPid.get(pid)!.push(t);
      } else if (mergeUnassignedToDefault && !pid && defaultId && byPid.has(defaultId)) {
        byPid.get(defaultId)!.push(t);
      }
    }
    const allFlat = portfolioIds.flatMap((id) => byPid.get(id) ?? []);
    const eurM = await buildEurPerUnitByTxnIdForTransactions(allFlat);
    const cashPairs = await Promise.all(
      portfolioIds.map(async (id) => {
        const list = byPid.get(id) ?? [];
        const cash = await netLedgerCashEur(list, rates, eurM);
        return [id, cash] as const;
      }),
    );
    for (const [id, cash] of cashPairs) {
      map[id] = cash;
    }
    return map;
  }

  async getTransactionsForCashBreakdown(
    userId: string,
    portfolioParam: string,
  ): Promise<Transaction[]> {
    const p = (portfolioParam || "all").trim();
    if (p === "all" || p === "") {
      return this.getTransactionsByUser(userId, "all");
    }
    const defaultPf = await this.getDefaultPortfolio(userId);
    if (defaultPf && p === defaultPf.id) {
      return await db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            or(
              eq(transactions.portfolioId, p),
              isNull(transactions.portfolioId),
            ),
          ),
        )
        .orderBy(desc(transactions.transactionDate));
    }
    return this.getTransactionsByUser(userId, p);
  }

  async getOverviewBundle(
    userId: string,
    rates: AllExchangeRates,
  ): Promise<{
    byPortfolioId: Record<
      string,
      {
        holdings: Holding[];
        totalRealized: number;
        closeTradeNetEur: number;
        /** Čisté dividendy v EUR — dividendNetEur(list), nie súčet v pôvodných menách. */
        dividendNet: number;
        cashEur: number;
      }
    >;
  }> {
    const visibleIds = await this.getVisiblePortfolioIdsByUser(userId);
    if (visibleIds.length === 0) {
      return { byPortfolioId: {} };
    }
    const defaultPf = await this.getDefaultPortfolio(userId);
    const defaultId = defaultPf?.id;
    const unassignedHoldingTo =
      defaultId && visibleIds.includes(defaultId) ? defaultId : visibleIds[0];
    const unassignedTxTo =
      defaultId && visibleIds.includes(defaultId) ? defaultId : visibleIds[0];

    const holdingsWhere = and(
      eq(holdings.userId, userId),
      or(
        isNull(holdings.portfolioId),
        inArray(holdings.portfolioId, visibleIds),
      ),
    );
    const holdingsRows = await db
      .select()
      .from(holdings)
      .where(holdingsWhere);

    const txnPortfolioFilter = or(
      isNull(transactions.portfolioId),
      inArray(transactions.portfolioId, visibleIds),
    );
    const txnRows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), txnPortfolioFilter));

    const holdingsByPid = new Map<string, Holding[]>();
    for (const id of visibleIds) holdingsByPid.set(id, []);
    for (const h of holdingsRows) {
      const pid = h.portfolioId;
      if (pid && holdingsByPid.has(pid)) {
        holdingsByPid.get(pid)!.push(h);
      } else if (!pid && unassignedHoldingTo && holdingsByPid.has(unassignedHoldingTo)) {
        holdingsByPid.get(unassignedHoldingTo)!.push(h);
      }
    }

    const txnsByPid = new Map<string, Transaction[]>();
    for (const id of visibleIds) txnsByPid.set(id, []);
    for (const t of txnRows) {
      const pid = t.portfolioId;
      if (pid && txnsByPid.has(pid)) {
        txnsByPid.get(pid)!.push(t);
      } else if (!pid && unassignedTxTo && txnsByPid.has(unassignedTxTo)) {
        txnsByPid.get(unassignedTxTo)!.push(t);
      }
    }

    const allTxFlat = visibleIds.flatMap((id) => txnsByPid.get(id) ?? []);
    const eurM = await buildEurPerUnitByTxnIdForTransactions(allTxFlat);
    const now = new Date();

    const entries = await Promise.all(
      visibleIds.map(async (id) => {
        const list = txnsByPid.get(id) ?? [];

        const totalRealized = computeFifoRealizedGainsFromTransactions(
          list,
          eurM,
          now,
        ).summary.totalRealized;
        const closeTradeNetEur = sumCloseTradeCashFlowEurFromRows(list);

        const dividendNet = dividendNetEur(list, rates);

        const cashEur = await netLedgerCashEur(list, rates, eurM);

        return [
          id,
          {
            holdings: holdingsByPid.get(id) ?? [],
            totalRealized,
            closeTradeNetEur,
            dividendNet,
            cashEur,
          },
        ] as const;
      }),
    );

    const byPortfolioId = Object.fromEntries(entries);

    return { byPortfolioId };
  }

  async getHoldingByUserAndTicker(userId: string, ticker: string, portfolioId?: string | null): Promise<Holding | undefined> {
    if (portfolioId && portfolioId !== "all") {
      const [holding] = await db
        .select()
        .from(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.ticker, ticker),
            eq(holdings.portfolioId, portfolioId)
          )
        );
      return holding;
    }
    
    const visibleIds = await this.getVisiblePortfolioIdsByUser(userId);
    const portfolioFilter = visibleIds.length > 0
      ? or(isNull(holdings.portfolioId), inArray(holdings.portfolioId, visibleIds))
      : isNull(holdings.portfolioId);

    const [holding] = await db
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.ticker, ticker),
          portfolioFilter
        )
      );
    return holding;
  }

  async getHoldingsForTickerAcrossPortfolios(userId: string, ticker: string): Promise<Holding[]> {
    const normalized = ticker.trim().toLowerCase();
    const visibleIds = await this.getVisiblePortfolioIdsByUser(userId);
    const portfolioFilter =
      visibleIds.length > 0
        ? or(isNull(holdings.portfolioId), inArray(holdings.portfolioId, visibleIds))
        : isNull(holdings.portfolioId);

    return await db
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          sql`lower(${holdings.ticker}) = ${normalized}`,
          portfolioFilter
        )
      );
  }

  async getTransactionsForTickerAcrossPortfolios(userId: string, ticker: string): Promise<Transaction[]> {
    const normalized = ticker.trim().toLowerCase();
    return await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          sql`lower(${transactions.ticker}) = ${normalized}`,
        ),
      )
      .orderBy(asc(transactions.transactionDate));
  }

  async upsertHolding(
    userId: string, 
    ticker: string, 
    companyName: string, 
    shares: string, 
    averageCost: string, 
    totalInvested: string,
    portfolioId?: string | null
  ): Promise<Holding> {
    const portfolioIdValue = portfolioId || null;
    
    // Use raw SQL for proper upsert on the unique constraint
    const result = await db.execute(sql`
      INSERT INTO holdings (id, user_id, portfolio_id, ticker, company_name, shares, average_cost, total_invested, updated_at)
      VALUES (gen_random_uuid(), ${userId}, ${portfolioIdValue}, ${ticker}, ${companyName}, ${shares}, ${averageCost}, ${totalInvested}, NOW())
      ON CONFLICT (user_id, portfolio_id, ticker) 
      DO UPDATE SET 
        company_name = EXCLUDED.company_name,
        shares = EXCLUDED.shares,
        average_cost = EXCLUDED.average_cost,
        total_invested = EXCLUDED.total_invested,
        updated_at = NOW()
      RETURNING *
    `);
    return result.rows[0] as Holding;
  }

  async deleteHolding(userId: string, ticker: string, portfolioId?: string | null): Promise<void> {
    if (portfolioId && portfolioId !== "all") {
      await db
        .delete(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.ticker, ticker),
            eq(holdings.portfolioId, portfolioId)
          )
        );
    } else {
      await db
        .delete(holdings)
        .where(
          and(
            eq(holdings.userId, userId),
            eq(holdings.ticker, ticker)
          )
        );
    }
  }

  async getUserAssetMetadataMap(
    userId: string,
    tickers?: string[],
  ): Promise<Record<string, { sector: string | null; country: string | null; assetType: AssetClassValue | null }>> {
    const uniqueTickers = Array.from(new Set((tickers ?? []).map((t) => t.toUpperCase().trim()).filter(Boolean)));
    const whereBase = eq(userAssetMetadata.userId, userId);
    const rows = uniqueTickers.length > 0
      ? await db
          .select()
          .from(userAssetMetadata)
          .where(and(whereBase, inArray(userAssetMetadata.ticker, uniqueTickers)))
      : await db.select().from(userAssetMetadata).where(whereBase);

    const out: Record<string, { sector: string | null; country: string | null; assetType: AssetClassValue | null }> =
      {};
    for (const row of rows) {
      out[row.ticker.toUpperCase()] = {
        sector: row.sector ?? null,
        country: row.country ?? null,
        assetType: (row.assetType as AssetClassValue | null) ?? null,
      };
    }
    return out;
  }

  async upsertUserAssetMetadata(
    userId: string,
    ticker: string,
    data: { sector?: string | null; country?: string | null; assetType?: AssetClassValue | null },
  ): Promise<UserAssetMetadata | null> {
    const t = ticker.toUpperCase().trim();
    const sector = data.sector?.trim() || null;
    const country = data.country?.trim() || null;
    const assetType = data.assetType ?? null;

    if (!sector && !country && !assetType) {
      await db
        .delete(userAssetMetadata)
        .where(and(eq(userAssetMetadata.userId, userId), eq(userAssetMetadata.ticker, t)));
      return null;
    }

    const result = await db.execute(sql`
      INSERT INTO user_asset_metadata (id, user_id, ticker, sector, country, asset_type, updated_at)
      VALUES (gen_random_uuid(), ${userId}, ${t}, ${sector}, ${country}, ${assetType}, NOW())
      ON CONFLICT (user_id, ticker)
      DO UPDATE SET
        sector = EXCLUDED.sector,
        country = EXCLUDED.country,
        asset_type = EXCLUDED.asset_type,
        updated_at = NOW()
      RETURNING *
    `);
    return (result.rows[0] as UserAssetMetadata) ?? null;
  }

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    return settings;
  }

  async upsertUserSettings(userId: string, settings: { preferredCurrency?: string | null }): Promise<UserSettings> {
    const existing = await this.getUserSettings(userId);

    if (existing) {
      const updateData: Partial<UserSettings> = { updatedAt: new Date() };
      if (settings.preferredCurrency !== undefined) {
        updateData.preferredCurrency = settings.preferredCurrency || "EUR";
      }

      const [updated] = await db
        .update(userSettings)
        .set(updateData)
        .where(eq(userSettings.userId, userId))
        .returning();
      return updated!;
    }

    const [created] = await db
      .insert(userSettings)
      .values({
        userId,
        preferredCurrency: settings.preferredCurrency || "EUR",
      })
      .returning();
    return created!;
  }

  // Option trades operations
  async createOptionTrade(trade: InsertOptionTrade): Promise<OptionTrade> {
    const [result] = await db
      .insert(optionTrades)
      .values(trade)
      .returning();
    return result;
  }

  async getOptionTradesByUser(userId: string, portfolioId?: string | null): Promise<OptionTrade[]> {
    if (portfolioId && portfolioId !== "all") {
      return await db
        .select()
        .from(optionTrades)
        .where(
          and(
            eq(optionTrades.userId, userId),
            eq(optionTrades.portfolioId, portfolioId)
          )
        )
        .orderBy(desc(optionTrades.openDate));
    }

    const visibleIds = await this.getVisiblePortfolioIdsByUser(userId);
    const portfolioFilter = visibleIds.length > 0
      ? or(isNull(optionTrades.portfolioId), inArray(optionTrades.portfolioId, visibleIds))
      : isNull(optionTrades.portfolioId);

    return await db
      .select()
      .from(optionTrades)
      .where(and(eq(optionTrades.userId, userId), portfolioFilter))
      .orderBy(desc(optionTrades.openDate));
  }

  async getOptionTradeById(tradeId: string, userId: string): Promise<OptionTrade | undefined> {
    const [trade] = await db
      .select()
      .from(optionTrades)
      .where(
        and(
          eq(optionTrades.id, tradeId),
          eq(optionTrades.userId, userId)
        )
      );
    return trade;
  }

  async updateOptionTrade(tradeId: string, userId: string, data: Partial<InsertOptionTrade>): Promise<OptionTrade> {
    const [result] = await db
      .update(optionTrades)
      .set(data)
      .where(
        and(
          eq(optionTrades.id, tradeId),
          eq(optionTrades.userId, userId)
        )
      )
      .returning();
    return result;
  }

  async deleteOptionTrade(tradeId: string, userId: string): Promise<void> {
    await db
      .delete(optionTrades)
      .where(
        and(
          eq(optionTrades.id, tradeId),
          eq(optionTrades.userId, userId)
        )
      );
  }
}

export const storage = new DatabaseStorage();
