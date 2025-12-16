# Inventory Ops - Saleor App

Inventory operations app for Saleor - manage purchase orders, goods receipts, and cost tracking with Weighted Average Cost (WAC) calculations.

## Features

- **Purchase Orders (POs)**: Create, approve, and track purchase orders from suppliers
- **Goods Receipts (GRs)**: Receive goods against POs with partial receiving support
- **Saleor Stock Integration**: Automatically post stock increases to Saleor warehouses
- **Cost Tracking**: Weighted Average Cost (WAC) calculation with append-only ledger
- **Landed Costs**: Allocate freight, duty, and other costs across receipt lines
- **Audit Trail**: Complete audit trail of all inventory and cost events

## Requirements

- Node.js 22+
- pnpm 10+
- PostgreSQL 15+
- Saleor 3.21+

## Local Development

### 1. Copy environment file

```bash
cp .env.example .env
```

### 2. Configure environment variables

Edit `.env` with your settings:

```bash
# Required
DATABASE_URL=postgresql://inventory:inventory@localhost:5433/inventory_ops
SECRET_KEY=your-secret-key-at-least-32-characters

# Optional
APP_IFRAME_BASE_URL=http://localhost:3002
APP_API_BASE_URL=http://localhost:3002
DEFAULT_CURRENCY=USD
```

### 3. Start the database

Using Docker Compose from the platform root:

```bash
docker compose up -d inventory-ops-db
```

### 4. Run database migrations

```bash
pnpm db:push
```

### 5. Start the development server

```bash
pnpm dev
```

The app will be available at http://localhost:3002

### 6. Install in Saleor Dashboard

1. Go to Saleor Dashboard → Apps → Install App
2. Enter the app URL: `http://localhost:3002/api/manifest`
3. Click Install

## Docker Deployment

The app is configured in the platform's `docker-compose.yml`:

```bash
# From platform root
docker compose up -d inventory-ops-app inventory-ops-db
```

## Database Schema

The app uses PostgreSQL with Prisma ORM. Key tables:

| Table | Purpose |
|-------|---------|
| `AppInstallation` | Multi-tenant app installation tracking |
| `Supplier` | Vendor/supplier master data |
| `PurchaseOrder` | PO header with status tracking |
| `PurchaseOrderLine` | PO line items with variant references |
| `GoodsReceipt` | Receipt header with reversal support |
| `GoodsReceiptLine` | Receipt line items with cost data |
| `CostLayerEvent` | Append-only cost ledger (IMMUTABLE) |
| `SaleorPostingRecord` | Idempotency tracking for Saleor mutations |

## API

The app exposes a tRPC API for the dashboard UI:

- `health.check` - Verify app installation
- `suppliers.list` - List all suppliers
- `purchaseOrders.list` - List purchase orders
- `goodsReceipts.list` - List goods receipts
- `costLayers.getWac` - Get WAC for a variant/warehouse

## Permissions

The app requires the following Saleor permissions:

- `MANAGE_PRODUCTS` - Required for stock updates

## License

BSD-3-Clause
