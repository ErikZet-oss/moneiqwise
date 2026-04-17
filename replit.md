# PortfólioTracker - Investment Portfolio Tracker

## Overview

PortfólioTracker is a full-stack investment portfolio tracking application that enables users to monitor their stock holdings, analyze performance metrics, and manage buy/sell transactions in real-time. The application provides a comprehensive view of portfolio value, gains/losses, and daily changes with a focus on Slovak/European market users.

The system is built as a monorepo with a React frontend, Express backend, and PostgreSQL database. It integrates with stock market APIs to fetch real-time price quotes and calculates portfolio metrics based on user transaction history.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Monorepo Structure
The application follows a monorepo pattern with clear separation between client, server, and shared code:
- **client/**: React-based frontend application with Vite build tooling
- **server/**: Express.js backend API server
- **shared/**: Common TypeScript types and database schemas shared between frontend and backend
- **script/**: Build automation scripts for production deployment

This architecture enables code sharing (particularly database schemas and TypeScript types) while maintaining clear boundaries between frontend and backend concerns.

### Frontend Architecture

**Technology Stack:**
- **React 18** with TypeScript for type-safe component development
- **Wouter** for lightweight client-side routing (alternative to React Router)
- **TanStack Query (React Query)** for server state management and data fetching
- **React Hook Form** with Zod validation for form handling
- **Vite** as the build tool and development server
- **Tailwind CSS** for utility-first styling
- **shadcn/ui** component library built on Radix UI primitives

**Design System:**
The application uses a customized version of shadcn/ui with the "new-york" style variant. The design system includes:
- Custom color scheme optimized for financial data visualization with light/dark mode support
- Sidebar-based navigation pattern for authenticated users
- Card-based layouts for presenting portfolio data
- Responsive design with mobile breakpoints

**State Management Strategy:**
- Server state is managed entirely through TanStack Query with infinite stale time
- Form state uses React Hook Form
- Authentication state is derived from TanStack Query
- No global client state management library (Redux/Zustand) is used

**Key Pages:**
1. **Landing Page**: Unauthenticated marketing page with feature highlights
2. **Dashboard**: Portfolio overview with total value, gains/losses, and holdings table
3. **Transactions**: Form for adding buy/sell transactions with stock search
4. **History**: Filterable transaction history with type and ticker filters

### Backend Architecture

**Technology Stack:**
- **Express.js** as the HTTP server framework
- **TypeScript** for type safety across the backend
- **Drizzle ORM** for database access and query building
- **Neon Serverless PostgreSQL** driver optimized for serverless environments
- **OpenID Connect (OIDC)** via Passport.js for authentication

**API Design:**
RESTful API design with the following endpoints:
- `GET /api/auth/user` - Fetch authenticated user information
- `GET /api/holdings` - Get user's current portfolio holdings
- `GET /api/transactions` - Get user's transaction history
- `POST /api/transactions` - Create new buy/sell transaction
- `GET /api/stocks/quote/:ticker` - Fetch real-time stock quotes
- `GET /api/realized-gains` - Get realized gain/loss summary (totalRealized, YTD, monthly, daily, by ticker)
- `GET /api/dividends` - Get dividend income summary (total, YTD, monthly, daily, by ticker with gross/net/tax breakdown)
- `GET /api/exchange-rate` - Get EUR/USD exchange rate (ECB data, cached 1 hour)

**Authentication Flow:**
The application uses Replit's OIDC authentication system:
- Session management with connect-pg-simple for PostgreSQL-backed sessions
- Passport.js with openid-client strategy for OIDC integration
- Session cookies with 1-week TTL and httpOnly/secure flags
- User records are automatically created/updated on authentication

**Business Logic:**
Core portfolio calculation logic resides in the storage layer:
- Transaction processing updates holdings in real-time
- Average cost basis calculated using weighted averages
- Holdings automatically deleted when share quantity reaches zero
- All numeric values (shares, prices) stored as PostgreSQL NUMERIC for precision

### Database Schema

**Primary Tables:**
1. **sessions** - PostgreSQL-backed session storage for authentication
   - Required by connect-pg-simple middleware
   - Indexed on expiration for efficient cleanup

2. **users** - User profile data from OIDC provider
   - Stores email, name, profile image URL
   - Auto-generated UUID primary keys
   - Timestamps for creation and updates

3. **transactions** - Historical record of all buy/sell/dividend operations
   - Links to users table via foreign key
   - Stores ticker, company name, shares, price per share, commission
   - Transaction type enum: 'BUY', 'SELL', or 'DIVIDEND'
   - Transaction date allows backdating entries
   - **For SELL transactions:**
     - **realizedGain** - Calculated as (sellPrice - avgCost) * shares - commission
     - **costBasis** - Average cost at time of sale
   - **For DIVIDEND transactions:**
     - shares = number of shares owned at dividend date
     - pricePerShare = dividend amount per share
     - commission = withholding tax
     - Net dividend = (shares × pricePerShare) - commission
     - DIVIDEND transactions do NOT affect holdings (excluded from cost basis calculations)

4. **holdings** - Current portfolio positions (derived from transactions)
   - Composite unique constraint on userId + ticker
   - Stores aggregated shares, average cost, total invested
   - Updated via upsert operations on transaction creation

**Data Precision:**
Financial values use PostgreSQL NUMERIC type with appropriate precision:
- Shares: NUMERIC(18, 8) to support fractional shares
- Prices: NUMERIC(18, 4) for sub-cent precision
- Prevents floating-point arithmetic errors in financial calculations

**Schema Management:**
- Drizzle Kit for schema migrations and database pushes
- Schema defined in TypeScript with drizzle-orm and exported to shared code
- Drizzle-Zod integration for runtime validation from database schema

### Build and Deployment

**Development Mode:**
- Vite dev server with HMR for frontend
- Express server with tsx for TypeScript execution
- Development-only Replit plugins (cartographer, dev banner, runtime error overlay)

**Production Build:**
- Client: Vite builds React app to `dist/public`
- Server: esbuild bundles Express app to single `dist/index.cjs` file
- Selected dependencies are bundled to reduce cold start times
- Static file serving for built frontend assets

**Build Optimization:**
The build script uses an allowlist approach to bundle frequently-used dependencies (database drivers, authentication libraries) while externalizing others to balance bundle size and startup performance.

## External Dependencies

### Database
- **Neon Serverless PostgreSQL**: Cloud-native PostgreSQL with WebSocket support for serverless environments
- Connection pooling via @neondatabase/serverless
- Configured via DATABASE_URL environment variable

### Authentication
- **Replit OIDC**: OpenID Connect authentication provider
- Passport.js integration with openid-client strategy
- Requires ISSUER_URL, REPL_ID, and SESSION_SECRET environment variables
- PostgreSQL-backed session storage for persistence across restarts

### Stock Market Data
- API endpoints reference `/api/stocks/quote/:ticker` for fetching real-time stock quotes
- Implementation details for stock quote provider not visible in repository (likely requires additional API key configuration)
- Quote data includes: ticker, price, change, changePercent

### Options Trading
The application includes comprehensive options trading functionality.

**User Trading Setup:**
- Broker: Interactive Brokers (IBKR)
- Currency: USD (US Dollars)
- All option trades are denominated in USD

**Special CASH Ticker:**
- CASH is a virtual ticker for tracking cash reserves ready for investment
- Price is always fixed at 1.00 (1 unit = 1 currency unit)
- BUY CASH = deposit/add cash to account
- SELL CASH = withdraw/use cash for investment
- Searchable via "cash", "hotovosť", "peniaze", "money"
- Included in total portfolio value calculation
- No historical prices or daily changes

**API Endpoints:**
- `GET /api/options` - List all option trades (supports ?portfolio= filter)
- `GET /api/options/stats/summary` - Get options statistics (MUST be before /:id route)
- `POST /api/options` - Create new option trade
- `PATCH /api/options/:id` - Update/close option trade
- `DELETE /api/options/:id` - Delete option trade

**Option Trade Schema:**
- underlying, optionType (CALL/PUT), direction (BUY/SELL)
- strikePrice, expirationDate, premium, contracts, commission
- status: OPEN, CLOSED, EXPIRED, ASSIGNED
- realizedGain calculated based on status and direction

**P/L Calculation Logic:**
- SELL + EXPIRED: +premium × 100 × contracts - commission (seller keeps full premium)
- BUY + EXPIRED: -premium × 100 × contracts - commission (buyer loses premium)
- SELL + CLOSED: (openPremium - closePremium) × 100 × contracts - commissions
- BUY + CLOSED: (closePremium - openPremium) × 100 × contracts - commissions

**Important Implementation Notes:**
- Route ordering: `/api/options/stats/summary` MUST be defined before `/api/options/:id`
- Date handling: Frontend sends ISO strings, backend uses z.coerce.date() for conversion
- Cache invalidation: Uses predicate function to invalidate all /api/options* queries
- For EXPIRED/ASSIGNED status: Frontend only sends status and closeDate (no closePremium/closeCommission)

### UI Component Library
- **shadcn/ui**: Copy-paste component library built on Radix UI primitives
- Components are directly integrated into the codebase (not installed as dependency)
- Provides accessible, customizable components for forms, dialogs, navigation, data display

### Form Validation
- **Zod**: Schema validation library
- **@hookform/resolvers**: Integrates Zod with React Hook Form
- **drizzle-zod**: Generates Zod schemas from Drizzle database schema

### Styling
- **Tailwind CSS**: Utility-first CSS framework with custom design tokens
- PostCSS with Autoprefixer for vendor prefixing
- Custom CSS variables for theme management (light/dark modes)

### Development Tools
- **Replit-specific plugins**: Cartographer (file navigation), dev banner, runtime error modal
- Only loaded in development mode on Replit platform
- Gracefully excluded in production builds