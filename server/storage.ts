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
import { eq, and, desc, sql, isNull, or } from "drizzle-orm";

export interface IStorage {
  // User operations - required for Replit Auth
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  
  // Portfolio operations
  getPortfoliosByUser(userId: string): Promise<Portfolio[]>;
  getPortfolioById(portfolioId: string, userId: string): Promise<Portfolio | undefined>;
  getDefaultPortfolio(userId: string): Promise<Portfolio | undefined>;
  createPortfolio(portfolio: InsertPortfolio): Promise<Portfolio>;
  updatePortfolio(portfolioId: string, userId: string, data: Partial<InsertPortfolio>): Promise<Portfolio>;
  deletePortfolio(portfolioId: string, userId: string): Promise<void>;
  ensureDefaultPortfolio(userId: string): Promise<Portfolio>;
  
  // Transaction operations
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  getTransactionsByUser(userId: string, portfolioId?: string | null): Promise<Transaction[]>;
  getTransactionsByUserAndTicker(userId: string, ticker: string, portfolioId?: string | null): Promise<Transaction[]>;
  updateTransaction(transactionId: string, userId: string, data: Partial<InsertTransaction>): Promise<void>;
  deleteTransaction(transactionId: string, userId: string): Promise<void>;
  getTransactionById(transactionId: string, userId: string): Promise<Transaction | undefined>;
  
  // Holdings operations
  getHoldingsByUser(userId: string, portfolioId?: string | null): Promise<Holding[]>;
  getHoldingByUserAndTicker(userId: string, ticker: string, portfolioId?: string | null): Promise<Holding | undefined>;
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
      .orderBy(desc(portfolios.isDefault), portfolios.name);
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
    
    // Return all transactions for the user (all portfolios)
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
          eq(transactions.ticker, ticker)
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
    
    // When viewing all portfolios, aggregate holdings by ticker
    const allHoldings = await db
      .select()
      .from(holdings)
      .where(eq(holdings.userId, userId));
    
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
    
    const [holding] = await db
      .select()
      .from(holdings)
      .where(
        and(
          eq(holdings.userId, userId),
          eq(holdings.ticker, ticker)
        )
      );
    return holding;
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
    
    return await db
      .select()
      .from(optionTrades)
      .where(eq(optionTrades.userId, userId))
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
