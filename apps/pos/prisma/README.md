# Prisma Schema

This directory contains a symlink to the shared Prisma schema from the `inventory-ops` app.

The POS app shares its database with `inventory-ops` to enable:
- Cross-app cost layer integration (WAC/COGS tracking)
- Shared customer credit system (buylist payouts → POS payments)
- Unified inventory operations

## Schema Location

The actual schema file is at:
`../../inventory-ops/prisma/schema.prisma`

## Running Migrations

All migrations should be run from the `inventory-ops` app:

```bash
cd ../inventory-ops
pnpm db:migrate
```

## Generating Prisma Client

```bash
pnpm prisma generate
```

This will generate the Prisma client using the shared schema.
