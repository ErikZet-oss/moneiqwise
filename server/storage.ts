import {
  users,
  transactions,
  holdings,
  userSettings,
  portfolios,
  optionTrades,
  type User,
  type UpsertUser,
  type Transaction,
  type InsertTransaction,
  type Holding,
  type InsertHolding,
  type UserSettings,
  type Portfolio,
  type InsertPortfolio,
  type OptionTrade,
  type InsertOptionTrade,
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, asc, sql, isNull, or, inArray } from "drizzle-orm";

export interface IStorage {
  // User operations - required for Replit Auth
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Portfolio operations
  getPortfoliosByUser(userId: string): Promise<Portfolio[]>;
  getVisiblePortfolioIdsByUser(userId: string): Promise<string[]>;
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
  /** Single fetch for Overview page: holdings + totals per visible portfolio (no N× round-trips). */
  getOverviewBundle(userId: string): Promise<{
    byPortfolioId: Record<
      string,
      { holdings: Holding[]; totalRealized: number; dividendNet: number }
    >;
  }>;
  getHoldingByUserAndTicker(userId: string, ticker: string, portfolioId?: string | null): Promise<Holding | undefined>;
  getHoldingsForTickerAcrossPortfolios(userId: string, ticker: string): Promise<Holding[]>;
  getTransactionsForTickerAcrossPortfolios(userId: string, ticker: string): Promise<Transaction[]>;
  upsertHolding(userId: string, ticker: string, companyName: string, shares: string, averageCost: string, totalInvested: string, portfolioId?: string | null): Promise<Holding>;
  deleteHolding(userId: string, ticker: string, portfolioId?: string | null): Promise<void>;
  
  // User settings operations
  getUserSettings(userId: string): Promise<UserSettings | undefined>;
  upsertUserSettings(userId: string, settings: { alphaVantageKey?: string | null; finnhubKey?: string | null; preferredCurrency?: string | null }): Promise<UserSettings>;
  
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
    return Math.max(...rows.map((r) => r.sortOrder)) + 1;
  }

  async reorderPortfolios(userId: string, orderedIds: string[]): Promise<void> {
    const userPortfolios = await db
      .select({ id: portfolios.id })
      .from(portfolios)
      .where(eq(portfolios.userId, userId));
    const idSet = new Set(userPortfolios.map((p) => p.id));
    if (orderedIds.length !== idSet.size) {
      throw new Error("REORDER_LENGTH_MISMATCH");
    }
    for (const id of orderedIds) {
      if (!idSet.has(id)) {
        throw new Error("REORDER_UNKNOWN_ID");
      }
    }
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx
          .update(portfolios)
          .set({ sortOrder: i, updatedAt: new Date() })
          .where(and(eq(portfolios.id, orderedIds[i]!), eq(portfolios.userId, userId)));
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

    // Return all transactions for the user across visible portfolios (plus legacy rows with no portfolio)
    const visibleIds = await this.getVisiblePortfolioIdsByUser(userId);
    const portfolioFilter = visibleIds.length > 0
      ? or(isNull(transactions.portfolioId), inArray(transactions.portfolioId, visibleIds))
      : isNull(transactions.portfolioId);

    return await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.userId, userId), portfolioFilter))
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
    
    const visibleIds = await this.getVisiblePortfolioIdsByUser(userId);
    const portfolioFilter = visibleIds.length > 0
      ? or(isNull(transactions.portfolioId), inArray(transactions.portfolioId, visibleIds))
      : isNull(transactions.portfolioId);

    return await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.ticker, ticker),
          portfolioFilter
        )
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

  async getOverviewBundle(userId: string): Promise<{
    byPortfolioId: Record<
      string,
      { holdings: Holding[]; totalRealized: number; dividendNet: number }
    >;
  }> {
    const visibleIds = await this.getVisiblePortfolioIdsByUser(userId);
    if (visibleIds.length === 0) {
      return { byPortfolioId: {} };
    }

    const holdingsRows = await db
      .select()
      .from(holdings)
      .where(
        and(eq(holdings.userId, userId), inArray(holdings.portfolioId, visibleIds)),
      );

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
      if (pid && holdingsByPid.has(pid)) holdingsByPid.get(pid)!.push(h);
    }

    const txnsByPid = new Map<string, Transaction[]>();
    for (const id of visibleIds) txnsByPid.set(id, []);
    for (const t of txnRows) {
      const pid = t.portfolioId;
      if (pid && txnsByPid.has(pid)) txnsByPid.get(pid)!.push(t);
    }

    const byPortfolioId: Record<
      string,
      { holdings: Holding[]; totalRealized: number; dividendNet: number }
    > = {};

    for (const id of visibleIds) {
      const list = txnsByPid.get(id) ?? [];

      let totalRealized = 0;
      for (const txn of list) {
        if (txn.type === "SELL") {
          totalRealized += parseFloat(txn.realizedGain || "0");
        }
      }

      let dividendNet = 0;
      const dividendTransactions = list.filter((t) => t.type === "DIVIDEND");
      const taxTransactions = list.filter((t) => t.type === "TAX");
      for (const txn of dividendTransactions) {
        const shares = parseFloat(txn.shares);
        const dividendPerShare = parseFloat(txn.pricePerShare);
        const tax = parseFloat(txn.commission || "0");
        const gross = shares * dividendPerShare;
        dividendNet += gross - tax;
      }
      for (const txn of taxTransactions) {
        const shares = parseFloat(txn.shares);
        const pricePerShare = parseFloat(txn.pricePerShare);
        dividendNet += shares * pricePerShare;
      }

      byPortfolioId[id] = {
        holdings: holdingsByPid.get(id) ?? [],
        totalRealized,
        dividendNet,
      };
    }

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
    const visibleIds = await this.getVisiblePortfolioIdsByUser(userId);
    const portfolioFilter =
      visibleIds.length > 0
        ? or(isNull(transactions.portfolioId), inArray(transactions.portfolioId, visibleIds))
        : isNull(transactions.portfolioId);

    return await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          sql`lower(${transactions.ticker}) = ${normalized}`,
          portfolioFilter
        )
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

  async getUserSettings(userId: string): Promise<UserSettings | undefined> {
    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, userId));
    return settings;
  }

  async upsertUserSettings(
    userId: string, 
    settings: { alphaVantageKey?: string | null; finnhubKey?: string | null; preferredCurrency?: string | null }
  ): Promise<UserSettings> {
    const existing = await this.getUserSettings(userId);
    
    if (existing) {
      const updateData: Partial<UserSettings> = { updatedAt: new Date() };
      if (settings.alphaVantageKey !== undefined) {
        updateData.alphaVantageKey = settings.alphaVantageKey || null;
      }
      if (settings.finnhubKey !== undefined) {
        updateData.finnhubKey = settings.finnhubKey || null;
      }
      if (settings.preferredCurrency !== undefined) {
        updateData.preferredCurrency = settings.preferredCurrency || "EUR";
      }
      
      const [updated] = await db
        .update(userSettings)
        .set(updateData)
        .where(eq(userSettings.userId, userId))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(userSettings)
        .values({
          userId,
          alphaVantageKey: settings.alphaVantageKey || null,
          finnhubKey: settings.finnhubKey || null,
          preferredCurrency: settings.preferredCurrency || "EUR",
        })
        .returning();
      return created;
    }
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
