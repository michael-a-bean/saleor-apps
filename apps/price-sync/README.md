# Price Sync Worker

Standalone worker for syncing MTG card prices from external providers (Scryfall, TCGPlayer) to the shared inventory database.

## Overview

This worker fetches current market prices and stores them in `SellPriceSnapshot` table, which is consumed by:
- **Buylist App** - For calculating buy prices from market value
- **Inventory Ops** - For margin analysis and reporting
- **Storefront** - For displaying current market prices (optional)

## Architecture

```
┌─────────────────┐
│   Scryfall API  │
│   (free, 100ms  │
│    rate limit)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────────────────────┐
│   price-sync    │────▶│  SellPriceSnapshot table        │
│    (worker)     │     │  (shared PostgreSQL database)   │
└─────────────────┘     └─────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
              ┌──────────┐     ┌──────────────┐  ┌───────────┐
              │ Buylist  │     │ Inventory Ops│  │ Storefront│
              └──────────┘     └──────────────┘  └───────────┘
```

## Commands

### Seed Sync (Bootstrap)

Downloads Scryfall bulk data (~80MB) and creates initial SellPriceSnapshot records for all NM variants. Run once to bootstrap pricing data.

```bash
# Via Docker (recommended)
docker compose --profile tools run --rm price-sync node dist/index.mjs seed

# Dry run first
docker compose --profile tools run --rm price-sync node dist/index.mjs seed --dry-run --limit 100
```

### Full Sync

Updates prices for all variants with existing snapshots from Scryfall bulk data.

```bash
docker compose --profile tools run --rm price-sync node dist/index.mjs full
```

**Recommended**: Run daily at 2-3am when API usage is low.

### Delta Sync

Updates prices for recently active variants (used in buylists, cost events, or with stale prices).

```bash
docker compose --profile tools run --rm price-sync node dist/index.mjs delta
docker compose --profile tools run --rm price-sync node dist/index.mjs delta --lookback 3 --limit 200 --min-age 2
```

Options:
- `--lookback <days>` - How far back to look for active variants (default: 7)
- `--limit <count>` - Maximum variants to process (default: 500)
- `--min-age <hours>` - Only sync prices older than this (default: 4)

**Recommended**: Run every 1-4 hours.

### Single Variant

Sync price for a specific variant by ID.

```bash
docker compose --profile tools run --rm price-sync node dist/index.mjs variant <saleor-variant-id>
```

## Setup

### 1. Install dependencies

```bash
cd saleor-apps/apps/price-sync
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

Required variables:
- `DATABASE_URL` - PostgreSQL connection string (same as inventory-ops)
- `INSTALLATION_ID` - Your Saleor app installation UUID

### 3. Generate Prisma client

```bash
pnpm db:generate
```

### 4. Run sync

```bash
# Via Docker (recommended)
docker compose --profile tools run --rm price-sync node dist/index.mjs seed  # First time
docker compose --profile tools run --rm price-sync node dist/index.mjs delta # Ongoing

# Local development
pnpm sync:delta
```

## Scheduling

### Using cron

```cron
# Full sync daily at 2am
0 2 * * * cd /path/to/price-sync && pnpm sync:full >> /var/log/price-sync.log 2>&1

# Delta sync every 2 hours
0 */2 * * * cd /path/to/price-sync && pnpm sync:delta >> /var/log/price-sync.log 2>&1
```

### Using Docker Compose

The price-sync service is already configured in docker-compose.yml with the `tools` profile:

```bash
# Full sync daily
docker compose --profile tools run --rm price-sync node dist/index.mjs full

# Delta sync hourly
docker compose --profile tools run --rm price-sync node dist/index.mjs delta
```

For automated scheduling, add cron entries on the Docker host:

```cron
# Full sync daily at 2am
0 2 * * * cd /path/to/saleor-platform && docker compose --profile tools run --rm price-sync node dist/index.mjs full >> /var/log/price-sync.log 2>&1

# Delta sync every 2 hours
0 */2 * * * cd /path/to/saleor-platform && docker compose --profile tools run --rm price-sync node dist/index.mjs delta >> /var/log/price-sync.log 2>&1
```

## Rate Limits

Scryfall requires 50-100ms between requests. The worker respects this by default.

- Full sync: Uses bulk data download (single request), then batch DB updates
- Delta sync: ~500 requests/hour max (with 100ms delay)

## Troubleshooting

### "Cannot determine card identifier"

The variant doesn't have any existing price snapshots with Scryfall URLs. Initial data must be seeded through the buylist app's card search, which creates the first snapshot.

### "No variants need price updates"

All active variants have been synced within the `--min-age` window. This is normal if delta sync runs frequently.

### Slow full sync

Full sync downloads ~80MB of data. On slow connections, this may take several minutes. The bulk data is streamed and parsed incrementally to minimize memory usage.
