# Inventory Ops App - Implementation Plan

## Current Status: Phase 6 Complete

### Completed Phases

#### Phase 1: App Scaffolding (Complete)
- [x] App scaffolding (Next.js 15, tRPC, Prisma)
- [x] Docker configuration and deployment
- [x] Saleor App installation/authentication
- [x] Complete database schema (all tables defined)
- [x] Basic tRPC router structure
- [x] Multi-tenant support via AppInstallation
- [x] URL rewriting for Docker networking (localhost:8000 → api:8000)
- [x] HTTP IP filter disabled for local development

#### Phase 2: Supplier Management (Complete)
- [x] Full CRUD tRPC procedures (create, getById, update, deactivate, reactivate, search)
- [x] Supplier list page with search and status filter
- [x] Create supplier form with validation
- [x] Supplier detail/edit page
- [x] Soft delete (deactivate) instead of hard delete
- [x] Audit trail for all supplier changes
- [x] Navigation sidebar with app layout

#### Phase 3: Purchase Order Lifecycle (Complete)
- [x] Saleor GraphQL Integration (saleor-client.ts)
- [x] Full PO CRUD tRPC procedures (create, getById, update, addLine, updateLine, removeLine)
- [x] PO state machine (submit, approve, reject, cancel, duplicate)
- [x] Warehouse listing from Saleor
- [x] Variant search with autocomplete
- [x] PO list page with status filtering
- [x] Create PO page with supplier/warehouse selection
- [x] PO detail page with lines and status actions
- [x] Edit PO page with line management
- [x] Variant search modal component
- [x] Auto-generated PO numbers (PO-YYYYMMDD-NNNN)

#### Phase 4: Goods Receipt + Stock Posting (Complete)
- [x] Saleor stock integration (getStock, getVariantStocks, updateStock, adjustStock)
- [x] Full GR CRUD tRPC procedures (create, getById, update, addLine, updateLine, removeLine, delete)
- [x] GR posting logic with Saleor stock updates
- [x] GR reversal functionality
- [x] CostLayerEvent creation on posting
- [x] SaleorPostingRecord for idempotency
- [x] PO line qtyReceived/qtyRemaining updates
- [x] PO status auto-update (APPROVED → PARTIALLY_RECEIVED → FULLY_RECEIVED)
- [x] Goods receipts list page with status filtering
- [x] New goods receipt page with PO selection
- [x] GR detail page with line editing
- [x] Post confirmation modal
- [x] Reversal modal with reason input
- [x] Auto-generated GR numbers (GR-YYYYMMDD-NNNN)
- [x] Stock creation for new variant/warehouse combinations (uses productVariantStocksUpdate)

**Note**: Stock updates use `productVariantStocksUpdate` mutation (not `stockBulkUpdate`) because it can both create new stock records and update existing ones.

#### Phase 6: Landed Cost Allocation (Complete)
- [x] `landedCosts` tRPC router (create, update, delete, allocate, previewAllocation)
- [x] Allocation algorithms (BY_VALUE proportional, BY_QUANTITY equal per unit)
- [x] Allocation preview on GR detail page
- [x] Auto-allocation during GR posting
- [x] `landedCostDelta` field populated in CostLayerEvent
- [x] WAC calculation includes landed cost per unit
- [x] Landed costs UI on goods receipt detail page
- [x] Add/remove landed costs on draft GRs
- [x] Cost type categories (FREIGHT, DUTY, INSURANCE, HANDLING, OTHER)

### Database Tables Defined
- `AppInstallation` - Multi-tenant scoping
- `Supplier` - Vendor master data
- `PurchaseOrder` / `PurchaseOrderLine` - PO with lines
- `GoodsReceipt` / `GoodsReceiptLine` - Receiving with lines
- `LandedCost` / `LandedCostAllocation` - Cost allocation
- `CostLayerEvent` - Append-only cost ledger
- `SaleorPostingRecord` - Idempotency tracking
- `AuditEvent` - Audit trail

### Key Files Created/Modified in Phase 2
```
src/modules/suppliers/
├── index.ts                    # Module exports
└── suppliers-router.ts         # Full CRUD tRPC procedures

src/pages/suppliers/
├── index.tsx                   # List with search/filter
├── new.tsx                     # Create form
└── [id].tsx                    # Detail/edit page

src/ui/components/
└── app-layout.tsx              # Navigation sidebar
```

### Key Files Created/Modified in Phase 3
```
src/lib/
└── saleor-client.ts            # Saleor GraphQL client helpers

src/modules/purchase-orders/
├── index.ts                    # Module exports
└── purchase-orders-router.ts   # Full CRUD + state machine

src/pages/purchase-orders/
├── index.tsx                   # List with filtering
├── new.tsx                     # Create PO form
├── [id].tsx                    # PO detail with actions
└── [id]/edit.tsx               # Edit draft PO with lines

src/ui/components/
└── variant-search-modal.tsx    # Variant search for line items
```

### Key Files Created/Modified in Phase 4
```
src/lib/
└── saleor-client.ts            # Added stock operations (getStock, updateStock, adjustStock)

src/modules/goods-receipts/
├── index.ts                    # Module exports
└── goods-receipts-router.ts    # Full CRUD + posting + reversal

src/pages/goods-receipts/
├── index.tsx                   # List with status filtering
├── new.tsx                     # Create GR from PO selection
└── [id].tsx                    # GR detail with line editing, post/reverse actions
```

---

## Phase 3: Purchase Order Lifecycle (Complete)

**Goal:** Full PO CRUD with state machine and Saleor integration

### Tasks
1. **Saleor GraphQL Integration**
   - [x] Create `saleor-client.ts` with authenticated GraphQL client
   - [x] `listWarehouses()` - Fetch available warehouses
   - [x] `searchVariants(query)` - Search variants by SKU/name
   - [x] `getVariantById(id)` - Get variant details

2. **tRPC Procedures**
   - [x] `purchaseOrders.create` - Create draft PO
   - [x] `purchaseOrders.getById` - Get PO with lines
   - [x] `purchaseOrders.update` - Update draft PO
   - [x] `purchaseOrders.addLine` - Add line item
   - [x] `purchaseOrders.updateLine` - Update line item
   - [x] `purchaseOrders.removeLine` - Remove line item
   - [x] `purchaseOrders.submit` - Submit for approval (DRAFT → PENDING_APPROVAL)
   - [x] `purchaseOrders.approve` - Approve PO (PENDING_APPROVAL → APPROVED)
   - [x] `purchaseOrders.reject` - Reject PO (PENDING_APPROVAL → DRAFT)
   - [x] `purchaseOrders.cancel` - Cancel PO
   - [x] `purchaseOrders.duplicate` - Clone PO as draft

3. **UI Pages**
   - [x] `/purchase-orders` - List with status filters
   - [x] `/purchase-orders/new` - Create PO with supplier/warehouse selection
   - [x] `/purchase-orders/[id]` - PO detail with lines and actions
   - [x] `/purchase-orders/[id]/edit` - Edit draft PO with line management
   - [x] Variant search modal with SKU autocomplete
   - [x] Warehouse selector dropdown

4. **Business Logic**
   - [x] Auto-generate PO number (format: PO-YYYYMMDD-NNNN)
   - [x] State machine validation
   - [x] Cannot edit non-draft POs
   - [x] Lines must have variant, qty, expected cost

### State Machine
```
DRAFT → PENDING_APPROVAL → APPROVED → PARTIALLY_RECEIVED → FULLY_RECEIVED
  ↓            ↓                ↓              ↓
CANCELLED ←────┴────────────────←──────────────←
```

### Acceptance Criteria
- [x] Can create PO with supplier, warehouse, expected delivery date
- [x] Can add/edit/remove line items with variant search
- [x] Can submit PO for approval
- [x] Can approve/reject submitted PO
- [x] Cannot edit approved PO
- [x] PO number auto-generated and unique

---

## Phase 4: Goods Receipt + Stock Posting

**Goal:** Receiving workflow with Saleor stock integration

### Tasks
1. **Saleor Stock Integration**
   - `getStock(variantId, warehouseId)` - Current stock level
   - `updateStock(variantId, warehouseId, quantity)` - Adjust stock
   - Idempotency handling via `SaleorPostingRecord`

2. **tRPC Procedures**
   - `goodsReceipts.create` - Create GR from PO
   - `goodsReceipts.getById` - Get GR with lines
   - `goodsReceipts.addLine` - Add receiving line
   - `goodsReceipts.updateLine` - Update qty/cost
   - `goodsReceipts.removeLine` - Remove line
   - `goodsReceipts.post` - Post GR to Saleor stock
   - `goodsReceipts.reverse` - Create reversal GR

3. **Posting Logic**
   - Transaction: Create CostLayerEvent + Update Saleor stock
   - Idempotency: Check SaleorPostingRecord before mutation
   - Update PO line `qtyReceived` and `qtyRemaining`
   - Update PO status (APPROVED → PARTIALLY_RECEIVED → FULLY_RECEIVED)

4. **UI Pages**
   - `/goods-receipts` - List with status filters
   - `/goods-receipts/new?poId=xxx` - Create GR from PO
   - `/goods-receipts/[id]` - GR detail
   - Posting confirmation modal
   - Reversal confirmation modal (requires reason)

5. **Validation**
   - Cannot receive more than ordered (warn, allow override)
   - Unit cost required before posting
   - Cannot post if already posted
   - Cannot reverse if stock would go negative (unless setting allows)

### Acceptance Criteria
- [x] Can create GR from approved PO
- [x] Can receive partial quantities
- [x] Posting increases Saleor stock correctly
- [x] Posting creates CostLayerEvent
- [x] Posting is idempotent (retry-safe)
- [x] Can reverse posted GR (decreases stock)
- [x] PO status updates automatically

---

## Phase 5: Cost Layer Ledger + WAC

**Goal:** Weighted Average Cost calculation and reporting

### Tasks
1. **WAC Calculation Service**
   - `calculateWac(variantId, warehouseId)` - Compute from ledger
   - Update `wacAtEvent` and `qtyOnHandAtEvent` on each event
   - Handle currency consistency

2. **tRPC Procedures**
   - `costLayers.getWac` - Get current WAC (exists, needs enhancement)
   - `costLayers.getHistory` - Get cost events for variant
   - `costLayers.getInventoryValue` - WAC × qty for variant/warehouse
   - `reporting.inventoryValuation` - Full inventory value report
   - `reporting.costHistory` - Cost history by date range

3. **UI Pages**
   - `/reports/inventory-value` - Inventory valuation report
   - `/reports/cost-history` - Cost event history
   - WAC display on GR lines

### WAC Formula
```
New WAC = (Existing Qty × Existing WAC + New Qty × New Unit Cost) / (Existing Qty + New Qty)
```

### Acceptance Criteria
- [x] WAC calculated correctly per spec formula
- [x] WAC updates on each receipt
- [x] WAC updates on reversal
- [x] Inventory value report shows all variants
- [x] Cost history shows event audit trail

---

## Phase 6: Landed Cost Allocation

**Goal:** Freight/duty allocation across receipt lines

### Tasks
1. **tRPC Procedures**
   - `landedCosts.create` - Add landed cost to GR
   - `landedCosts.update` - Update before posting
   - `landedCosts.delete` - Remove before posting
   - `landedCosts.allocate` - Run allocation algorithm

2. **Allocation Algorithm**
   - BY_VALUE: Proportional to (qty × unitCost) per line
   - BY_QUANTITY: Equal per unit across lines
   - Store allocations in `LandedCostAllocation`
   - Update `landedCostDelta` in CostLayerEvent

3. **UI Components**
   - Landed cost entry form on GR
   - Allocation preview before posting
   - Allocation breakdown on GR detail

### Acceptance Criteria
- [x] Can add freight/duty/other costs to GR
- [x] Allocation by value distributes proportionally
- [x] Allocation by quantity distributes evenly
- [x] Allocations sum to original cost
- [x] Landed costs included in WAC calculation

---

## Phase 7: GR Reversal (Complete)

**Goal:** Full reversal workflow with audit trail

*Note: Implemented as part of Phase 4*

### Acceptance Criteria
- [x] Reversal creates new GR document
- [x] Stock decreased by reversal qty
- [x] Cost events show reversal entries
- [x] Original GR marked as reversed
- [x] WAC recalculated correctly

---

## Phase 8: Sales Integration (COGS Tracking)

**Goal:** Capture sales data for Cost of Goods Sold calculation

### Architecture Decision
- **inventory-ops captures transactional data** (cost layer events for sales)
- **Future analytics app** can query this data for rich reporting/dashboards
- Keeps single source of truth for all cost-related data

### Data Model Changes
```prisma
// New enum value
enum CostEventType {
  GOODS_RECEIPT
  GOODS_RECEIPT_REVERSAL
  LANDED_COST_ADJUSTMENT
  SALE                    // NEW
  SALE_RETURN             // NEW
}

// New model for sale references
model SaleEvent {
  id                String   @id @default(uuid())
  installationId    String
  saleorOrderId     String
  saleorOrderNumber String?
  saleorChannelId   String
  fulfilledAt       DateTime

  // Line-level data stored in CostLayerEvent with eventType=SALE
  costEvents        CostLayerEvent[]

  createdAt         DateTime @default(now())

  @@unique([installationId, saleorOrderId])
  @@index([installationId, fulfilledAt])
}
```

### Tasks
1. **Saleor Webhook Integration**
   - Subscribe to `ORDER_FULFILLED` webhook
   - Parse fulfillment data (lines, quantities, warehouse)
   - Handle partial fulfillments

2. **SALE Cost Layer Events**
   - For each fulfilled line:
     - Look up current WAC for variant/warehouse
     - Create SALE event: `qtyDelta: -qty, unitCost: WAC`
   - Store sale revenue for margin calculation
   - Handle multi-warehouse fulfillments

3. **tRPC Procedures**
   - `sales.list` - List sales with COGS data
   - `sales.getById` - Sale detail with line-level COGS
   - `sales.getSummary` - Sales totals by period
   - `reporting.salesByProduct` - Revenue, COGS, margin per SKU
   - `reporting.profitability` - Gross margin trends

4. **Basic Reports (in inventory-ops)**
   - `/reports/sales` - Sales list with COGS
   - `/reports/profitability` - Basic margin report
   - Sales data on cost history page

5. **Future Analytics App (separate)**
   - Rich dashboards and visualizations
   - Trend analysis and forecasting
   - Could use Metabase, Grafana, or custom app
   - Queries inventory-ops data via API or direct DB

### Webhook Payload Processing
```typescript
// ORDER_FULFILLED webhook
{
  order: {
    id: "T3JkZXI6MTIz",
    number: "123",
    channel: { id: "..." },
    fulfillments: [{
      lines: [{
        orderLine: {
          variant: { id: "...", sku: "..." },
          quantity: 2,
          unitPrice: { gross: { amount: 9.99 } }
        },
        quantity: 2
      }],
      warehouse: { id: "..." }
    }]
  }
}
```

### COGS Calculation
```
For each fulfilled line:
  COGS = qty_fulfilled × WAC_at_fulfillment_time

Gross Margin = Revenue - COGS
Margin % = (Revenue - COGS) / Revenue × 100
```

### Acceptance Criteria
- [ ] ORDER_FULFILLED webhook registered and receiving events
- [ ] SALE cost layer events created on fulfillment
- [ ] COGS calculated using WAC at time of sale
- [ ] Sales list shows revenue, COGS, margin
- [ ] Profitability report shows margin trends
- [ ] Handles partial fulfillments correctly
- [ ] Idempotent (re-processing same fulfillment is safe)

---

## Phase 9: Settings + UI Polish

**Goal:** Configuration and UX improvements

### Tasks
1. **Settings**
   - `allowNegativeStock` - Allow reversals below zero
   - `requireCostOnReceipt` - Block posting without cost
   - `defaultAllocationMethod` - BY_VALUE or BY_QUANTITY
   - `landedCostEnabled` - Enable/disable landed cost feature

2. **UI Improvements**
   - [x] Navigation sidebar (completed in Phase 2)
   - Breadcrumbs
   - Toast notifications
   - Loading states
   - Error boundaries
   - Mobile responsive (basic)

3. **Audit Trail UI**
   - Show audit events on entity detail pages
   - Filter by action type

### Acceptance Criteria
- [ ] Settings persist per installation
- [ ] Settings affect behavior as documented
- [x] Consistent navigation across all pages
- [ ] Clear feedback on all actions

---

## Phase 10: Testing + Documentation

**Goal:** Test coverage and operational documentation

### Tasks
1. **Unit Tests**
   - WAC calculation
   - State machine transitions
   - Allocation algorithms

2. **Integration Tests**
   - PO → GR → Post → Reverse flow
   - Saleor API mocking
   - Idempotency verification

3. **E2E Tests (Playwright)**
   - Create supplier
   - Create and approve PO
   - Receive and post GR
   - Reverse GR

4. **Documentation**
   - README with setup instructions
   - API reference
   - User guide for operators

### Acceptance Criteria
- [ ] Core business logic has unit tests
- [ ] Happy path has E2E coverage
- [ ] README sufficient for new developer setup

---

## File Structure (Current)

```
apps/inventory-ops/
├── prisma/
│   └── schema.prisma              # ✅ Complete
├── src/
│   ├── app/api/                   # ✅ App routes
│   │   ├── manifest/route.ts
│   │   ├── register/route.ts
│   │   ├── trpc/[trpc]/route.ts
│   │   └── webhooks/              # 📋 Phase 8 - Saleor webhooks
│   ├── lib/
│   │   ├── env.ts                 # ✅ Environment config
│   │   ├── prisma.ts              # ✅ Prisma client
│   │   ├── logger.ts              # ✅ Structured logging
│   │   ├── graphql-client.ts      # ✅ GraphQL client factory
│   │   ├── saleor-app.ts          # ✅ APL configuration
│   │   └── saleor-client.ts       # ✅ Saleor API helpers
│   ├── modules/
│   │   ├── trpc/                  # ✅ tRPC setup
│   │   │   ├── trpc-server.ts
│   │   │   ├── trpc-client.ts
│   │   │   ├── trpc-router.ts
│   │   │   ├── context-app-router.ts
│   │   │   └── protected-client-procedure.ts
│   │   ├── suppliers/             # ✅ Phase 2 - Complete
│   │   │   ├── index.ts
│   │   │   └── suppliers-router.ts
│   │   ├── purchase-orders/       # ✅ Phase 3 - Complete
│   │   │   ├── index.ts
│   │   │   └── purchase-orders-router.ts
│   │   ├── goods-receipts/        # ✅ Phase 4 - Complete
│   │   │   ├── index.ts
│   │   │   └── goods-receipts-router.ts
│   │   ├── cost-layers/           # ✅ Phase 5 - Complete
│   │   │   ├── index.ts
│   │   │   ├── cost-layers-router.ts
│   │   │   └── wac-service.ts
│   │   ├── reporting/             # ✅ Phase 5 - Complete
│   │   │   ├── index.ts
│   │   │   └── reporting-router.ts
│   │   ├── landed-costs/          # ✅ Phase 6 - Complete
│   │   │   ├── index.ts
│   │   │   ├── landed-costs-router.ts
│   │   │   └── allocation-service.ts
│   │   └── sales/                 # 📋 Phase 8
│   ├── ui/
│   │   └── components/
│   │       ├── app-layout.tsx     # ✅ Navigation sidebar
│   │       └── variant-search-modal.tsx  # ✅ Variant search
│   └── pages/
│       ├── _app.tsx               # ✅ App wrapper with layout
│       ├── index.tsx              # ✅ Redirect to /purchase-orders
│       ├── suppliers/             # ✅ Phase 2 - Complete
│       │   ├── index.tsx
│       │   ├── new.tsx
│       │   └── [id].tsx
│       ├── purchase-orders/       # ✅ Phase 3 - Complete
│       │   ├── index.tsx
│       │   ├── new.tsx
│       │   ├── [id].tsx
│       │   └── [id]/edit.tsx
│       ├── goods-receipts/        # ✅ Phase 4 - Complete
│       │   ├── index.tsx
│       │   ├── new.tsx
│       │   └── [id].tsx
│       ├── reports/               # ✅ Phase 5 - Complete
│       │   ├── inventory-value.tsx
│       │   ├── cost-history.tsx
│       │   ├── sales.tsx          # 📋 Phase 8
│       │   └── profitability.tsx  # 📋 Phase 8
│       └── settings/              # 📋 Phase 9
├── Dockerfile                     # ✅ Multi-stage build
└── package.json                   # ✅ Dependencies
```

---

## Development Notes

### Saleor Permissions Required
- `MANAGE_PRODUCTS` - Query variants (currently configured)
- `MANAGE_STOCKS` - Update stock quantities (add in Phase 4)
- `MANAGE_WAREHOUSES` - List warehouses (add in Phase 3)

### Key Design Decisions
1. **Append-only ledger**: CostLayerEvent never updated, only inserted
2. **Idempotent posting**: SaleorPostingRecord prevents double-posts
3. **Multi-tenant**: All data scoped by AppInstallation
4. **No ERP**: This is operational, not accounting
5. **Soft delete**: Suppliers deactivated, not deleted (preserve references)

### Environment Variables
```env
DATABASE_URL=postgresql://inventory_ops:inventory_ops@inventory-ops-db:5432/inventory_ops
SECRET_KEY=<32+ character secret>
APP_API_BASE_URL=http://inventory-ops-app:3002
APP_IFRAME_BASE_URL=http://localhost:3002
ALLOWED_DOMAIN_PATTERN=/.*/
```

### Docker Services
| Service | Port | Purpose |
|---------|------|---------|
| inventory-ops-app | 3002 | Next.js app |
| inventory-ops-db | 5433 | PostgreSQL database |

### Known Issues & Workarounds

1. **HTTP IP Filter**: Saleor blocks private IPs by default. Set `HTTP_IP_FILTER_ENABLED=False` in API and worker services.

2. **URL Rewriting**: The app rewrites `localhost:8000` → `api:8000` for Docker networking in `/api/register`.

3. **App Bridge**: Import `appBridgeInstance` directly from `_app.tsx` into `trpc-client.ts` (not via setter function).

4. **Macaw UI Types**: Use `__flex`, `__maxWidth`, `__width` for CSS values, not `flex={1}`.

---

## Quick Start for New Session

```bash
# Start all services
docker compose up -d

# Check app is running
docker compose logs inventory-ops-app --tail 20

# Access via Dashboard
# 1. Go to http://localhost:9000
# 2. Click Apps → Inventory Ops
# 3. Use sidebar to navigate

# Rebuild after code changes
docker compose build inventory-ops-app
docker compose up -d inventory-ops-app

# Run Prisma migrations (if schema changed)
docker compose exec inventory-ops-app pnpm prisma db push
```

---

## Next Steps

Two phases are ready for implementation:

### Option A: Phase 6 - Landed Cost Allocation
Enables adding freight, duty, and other costs to goods receipts:
1. Create `landedCosts` tRPC procedures (create, update, delete, allocate)
2. Implement allocation algorithms (BY_VALUE, BY_QUANTITY)
3. Build UI for adding landed costs to GR
4. Update WAC calculation to include landed cost delta

### Option B: Phase 8 - Sales Integration (COGS Tracking)
Enables tracking sales and calculating profitability:
1. Add `ORDER_FULFILLED` webhook handler
2. Create SALE cost layer events on fulfillment
3. Build sales list and profitability reports
4. Calculate COGS using WAC at time of sale
