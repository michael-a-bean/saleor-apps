# Prisma Schema

This directory contains a symlink to the shared Prisma schema from the `inventory-ops` app.

The MTG Import app shares its database with `inventory-ops` to enable:
- Unified AppInstallation table for multi-tenancy
- Single source of truth for schema migrations
- No bidirectional `prisma db push` conflicts

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
