import type { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

/*
 * WAC (Weighted Average Cost) Calculation Service
 *
 * WAC Formula:
 * New WAC = (Existing Qty × Existing WAC + New Qty × New Unit Cost) / (Existing Qty + New Qty)
 *
 * The service processes cost layer events chronologically and computes:
 * - Running WAC after each event
 * - Running quantity on hand after each event
 * - Total inventory value
 */

export interface WacResult {
  variantId: string;
  warehouseId: string;
  wac: string;
  qtyOnHand: number;
  totalValue: string;
  currency: string | null;
  eventCount: number;
  lastEventAt: Date | null;
}

export interface WacAtEvent {
  eventId: string;
  eventTimestamp: Date;
  eventType: string;
  qtyDelta: number;
  unitCost: string;
  landedCostDelta: string;
  totalUnitCost: string;
  qtyOnHandAfter: number;
  wacAfter: string;
  totalValueAfter: string;
}

export interface InventoryValueItem {
  variantId: string;
  warehouseId: string;
  variantSku: string | null;
  variantName: string | null;
  qtyOnHand: number;
  wac: string;
  totalValue: string;
  currency: string;
  lastEventAt: Date | null;
}

export interface InventoryValuationReport {
  items: InventoryValueItem[];
  totalValue: string;
  currency: string;
  generatedAt: Date;
}

interface WacCalculationParams {
  prisma: PrismaClient;
  installationId: string;
  variantId: string;
  warehouseId: string;
}

interface ComputeWacParams extends WacCalculationParams {
  newQtyDelta: number;
  newUnitCost: Decimal;
  newLandedCostDelta?: Decimal;
}

interface GetInventoryValuationParams {
  prisma: PrismaClient;
  installationId: string;
  warehouseId?: string;
  currency?: string;
}

interface GetCostHistoryParams {
  prisma: PrismaClient;
  installationId: string;
  startDate?: Date;
  endDate?: Date;
  variantId?: string;
  warehouseId?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}

/**
 * Calculate WAC for a specific variant/warehouse combination
 */
export async function calculateWac(params: WacCalculationParams): Promise<WacResult> {
  const { prisma, installationId, variantId, warehouseId } = params;

  const events = await prisma.costLayerEvent.findMany({
    where: {
      installationId,
      saleorVariantId: variantId,
      saleorWarehouseId: warehouseId,
    },
    orderBy: { eventTimestamp: "asc" },
  });

  if (events.length === 0) {
    return {
      variantId,
      warehouseId,
      wac: "0.0000",
      qtyOnHand: 0,
      totalValue: "0.0000",
      currency: null,
      eventCount: 0,
      lastEventAt: null,
    };
  }

  let runningQty = 0;
  let runningValue = new Decimal(0);
  const currency = events[0].currency;

  for (const event of events) {
    const eventUnitCost = new Decimal(event.unitCost);
    const eventLandedCost = new Decimal(event.landedCostDelta || 0);
    const totalUnitCost = eventUnitCost.plus(eventLandedCost);
    const eventValue = totalUnitCost.times(event.qtyDelta);

    if (event.qtyDelta > 0) {
      runningValue = runningValue.plus(eventValue);
      runningQty += event.qtyDelta;
    } else {
      const currentWac = runningQty > 0 ? runningValue.div(runningQty) : new Decimal(0);
      runningValue = runningValue.plus(currentWac.times(event.qtyDelta));
      runningQty += event.qtyDelta;
    }

    if (runningQty < 0) {
      runningQty = 0;
      runningValue = new Decimal(0);
    }
  }

  const wac = runningQty > 0 ? runningValue.div(runningQty) : new Decimal(0);
  const lastEvent = events[events.length - 1];

  return {
    variantId,
    warehouseId,
    wac: wac.toFixed(4),
    qtyOnHand: runningQty,
    totalValue: runningValue.toFixed(4),
    currency,
    eventCount: events.length,
    lastEventAt: lastEvent.eventTimestamp,
  };
}

/**
 * Calculate WAC at each event for a variant/warehouse (for history display)
 */
export async function calculateWacHistory(params: WacCalculationParams): Promise<WacAtEvent[]> {
  const { prisma, installationId, variantId, warehouseId } = params;

  const events = await prisma.costLayerEvent.findMany({
    where: {
      installationId,
      saleorVariantId: variantId,
      saleorWarehouseId: warehouseId,
    },
    orderBy: { eventTimestamp: "asc" },
  });

  if (events.length === 0) {
    return [];
  }

  const history: WacAtEvent[] = [];
  let runningQty = 0;
  let runningValue = new Decimal(0);

  for (const event of events) {
    const eventUnitCost = new Decimal(event.unitCost);
    const eventLandedCost = new Decimal(event.landedCostDelta || 0);
    const totalUnitCost = eventUnitCost.plus(eventLandedCost);

    if (event.qtyDelta > 0) {
      runningValue = runningValue.plus(totalUnitCost.times(event.qtyDelta));
      runningQty += event.qtyDelta;
    } else {
      const currentWac = runningQty > 0 ? runningValue.div(runningQty) : new Decimal(0);
      runningValue = runningValue.plus(currentWac.times(event.qtyDelta));
      runningQty += event.qtyDelta;
    }

    if (runningQty < 0) {
      runningQty = 0;
      runningValue = new Decimal(0);
    }

    const wacAfter = runningQty > 0 ? runningValue.div(runningQty) : new Decimal(0);

    history.push({
      eventId: event.id,
      eventTimestamp: event.eventTimestamp,
      eventType: event.eventType,
      qtyDelta: event.qtyDelta,
      unitCost: eventUnitCost.toFixed(4),
      landedCostDelta: eventLandedCost.toFixed(4),
      totalUnitCost: totalUnitCost.toFixed(4),
      qtyOnHandAfter: runningQty,
      wacAfter: wacAfter.toFixed(4),
      totalValueAfter: runningValue.toFixed(4),
    });
  }

  return history;
}

/**
 * Compute WAC at the time of a new event (for storing in wacAtEvent field)
 */
export async function computeWacForNewEvent(
  params: ComputeWacParams
): Promise<{ wacAtEvent: Decimal; qtyOnHandAtEvent: number }> {
  const {
    prisma,
    installationId,
    variantId,
    warehouseId,
    newQtyDelta,
    newUnitCost,
    newLandedCostDelta = new Decimal(0),
  } = params;

  const events = await prisma.costLayerEvent.findMany({
    where: {
      installationId,
      saleorVariantId: variantId,
      saleorWarehouseId: warehouseId,
    },
    orderBy: { eventTimestamp: "asc" },
  });

  let runningQty = 0;
  let runningValue = new Decimal(0);

  for (const event of events) {
    const eventUnitCost = new Decimal(event.unitCost);
    const eventLandedCost = new Decimal(event.landedCostDelta || 0);
    const totalUnitCost = eventUnitCost.plus(eventLandedCost);

    if (event.qtyDelta > 0) {
      runningValue = runningValue.plus(totalUnitCost.times(event.qtyDelta));
      runningQty += event.qtyDelta;
    } else {
      const currentWac = runningQty > 0 ? runningValue.div(runningQty) : new Decimal(0);
      runningValue = runningValue.plus(currentWac.times(event.qtyDelta));
      runningQty += event.qtyDelta;
    }

    if (runningQty < 0) {
      runningQty = 0;
      runningValue = new Decimal(0);
    }
  }

  const totalNewCost = newUnitCost.plus(newLandedCostDelta);

  if (newQtyDelta > 0) {
    runningValue = runningValue.plus(totalNewCost.times(newQtyDelta));
    runningQty += newQtyDelta;
  } else {
    const currentWac = runningQty > 0 ? runningValue.div(runningQty) : new Decimal(0);
    runningValue = runningValue.plus(currentWac.times(newQtyDelta));
    runningQty += newQtyDelta;
  }

  if (runningQty < 0) {
    runningQty = 0;
    runningValue = new Decimal(0);
  }

  const wacAtEvent = runningQty > 0 ? runningValue.div(runningQty) : new Decimal(0);

  return {
    wacAtEvent,
    qtyOnHandAtEvent: runningQty,
  };
}

/**
 * Get inventory valuation report for all variants in an installation
 */
export async function getInventoryValuation(
  params: GetInventoryValuationParams
): Promise<InventoryValuationReport> {
  const { prisma, installationId, warehouseId, currency = "USD" } = params;

  const groupedEvents = await prisma.costLayerEvent.groupBy({
    by: ["saleorVariantId", "saleorWarehouseId"],
    where: {
      installationId,
      ...(warehouseId && { saleorWarehouseId: warehouseId }),
    },
  });

  const items: InventoryValueItem[] = [];
  let totalValue = new Decimal(0);

  for (const group of groupedEvents) {
    const wacResult = await calculateWac({
      prisma,
      installationId,
      variantId: group.saleorVariantId,
      warehouseId: group.saleorWarehouseId,
    });

    if (wacResult.qtyOnHand > 0) {
      const latestLine = await prisma.goodsReceiptLine.findFirst({
        where: {
          saleorVariantId: group.saleorVariantId,
          goodsReceipt: {
            saleorWarehouseId: group.saleorWarehouseId,
            purchaseOrder: {
              installationId,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        select: {
          saleorVariantSku: true,
          saleorVariantName: true,
        },
      });

      items.push({
        variantId: group.saleorVariantId,
        warehouseId: group.saleorWarehouseId,
        variantSku: latestLine?.saleorVariantSku || null,
        variantName: latestLine?.saleorVariantName || null,
        qtyOnHand: wacResult.qtyOnHand,
        wac: wacResult.wac,
        totalValue: wacResult.totalValue,
        currency: wacResult.currency || currency,
        lastEventAt: wacResult.lastEventAt,
      });

      totalValue = totalValue.plus(new Decimal(wacResult.totalValue));
    }
  }

  items.sort((a, b) => parseFloat(b.totalValue) - parseFloat(a.totalValue));

  return {
    items,
    totalValue: totalValue.toFixed(4),
    currency,
    generatedAt: new Date(),
  };
}

/**
 * Get cost history for a date range
 */
export async function getCostHistory(params: GetCostHistoryParams) {
  const {
    prisma,
    installationId,
    startDate,
    endDate,
    variantId,
    warehouseId,
    eventType,
    limit = 100,
    offset = 0,
  } = params;

  const where = {
    installationId,
    ...(variantId && { saleorVariantId: variantId }),
    ...(warehouseId && { saleorWarehouseId: warehouseId }),
    ...(eventType && { eventType: eventType as "GOODS_RECEIPT" | "GOODS_RECEIPT_REVERSAL" | "LANDED_COST_ADJUSTMENT" }),
    ...(startDate || endDate
      ? {
          eventTimestamp: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        }
      : {}),
  };

  const [events, total] = await Promise.all([
    prisma.costLayerEvent.findMany({
      where,
      orderBy: { eventTimestamp: "desc" },
      take: limit,
      skip: offset,
      include: {
        sourceGrLine: {
          select: {
            id: true,
            saleorVariantSku: true,
            saleorVariantName: true,
            goodsReceipt: {
              select: {
                id: true,
                receiptNumber: true,
              },
            },
          },
        },
      },
    }),
    prisma.costLayerEvent.count({ where }),
  ]);

  return { events, total };
}
