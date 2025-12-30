# Saleor POS App

Point of Sale (POS) application for in-store transactions built as a Saleor App.

## Features

### Phase 1 (MVP)
- Register session management (open/close with cash counts)
- Barcode scanning (keyboard wedge mode)
- Cart management (add/remove items, quantities)
- Cash payment processing
- Browser-based receipt printing
- Customer attachment (optional)
- WAC/COGS integration via cost layer events

### Phase 2 (Planned)
- Returns and exchanges
- Stripe Terminal integration (card-present)
- Split tender payments
- Discounts and price overrides

### Phase 3 (Planned)
- Tax exemption handling
- Cash drops and payouts
- End-of-day reports (Z report)

### Phase 4 (Planned)
- Offline mode with transaction queue
- Local product cache
- Reconciliation UI

### Phase 5 (Planned)
- ESC/POS printer support
- Cash drawer integration

## Development

### Prerequisites

- Node.js 22+
- pnpm
- PostgreSQL (shared with inventory-ops at port 5433)

### Setup

1. Copy environment file:
   ```bash
   cp .env.example .env
   ```

2. Generate a secret key:
   ```bash
   openssl rand -hex 32
   ```

3. Install dependencies:
   ```bash
   pnpm install
   ```

4. Generate Prisma client:
   ```bash
   pnpm prisma generate
   ```

5. Start development server:
   ```bash
   pnpm dev
   ```

The app will be available at http://localhost:3004

### Database

The POS app shares its database with the `inventory-ops` app. Run migrations from there:

```bash
cd ../inventory-ops
pnpm db:migrate
```

## Architecture

- **Framework**: Next.js with App Router + Pages Router
- **API**: tRPC for type-safe procedures
- **Database**: PostgreSQL with Prisma ORM (shared schema)
- **UI**: Saleor Macaw UI components
- **Validation**: Zod schemas

## Integration

### Saleor GraphQL
- Product/variant lookup
- Draft order creation
- Order completion and payment recording
- Customer search/creation

### Inventory Ops
- Shared database for cost layer events
- WAC calculation at time of sale
- COGS tracking via ORDER_FULFILLED webhook

### Buylist
- Unified store credit system
- Buylist payouts can be used as POS payment method
