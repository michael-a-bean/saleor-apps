import type { PrismaClient } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

/**
 * Allocation Service for Landed Costs
 *
 * Supports two allocation methods:
 * - BY_VALUE: Proportional to (qty × unitCost) per line
 * - BY_QUANTITY: Equal per unit across all lines
 */

export interface AllocationResult {
  lineId: string;
  allocatedAmount: Decimal;
}

export interface AllocationPreview {
  landedCostId: string;
  costType: string;
  description: string;
  totalAmount: string;
  allocationMethod: string;
  allocations: Array<{
    lineId: string;
    variantSku: string | null;
    variantName: string | null;
    lineValue: string;
    lineQty: number;
    allocatedAmount: string;
    allocationPercent: string;
  }>;
}

/**
 * Calculate allocations for a landed cost using BY_VALUE method
 * Amount is distributed proportionally based on line value (qty × unitCost)
 */
export function allocateByValue(
  landedCost: { amount: Decimal },
  lines: Array<{ id: string; qtyReceived: number; unitCost: Decimal }>
): AllocationResult[] {
  // Calculate total line value
  const lineValues = lines.map((line) => ({
    id: line.id,
    value: new Decimal(line.unitCost).times(line.qtyReceived),
  }));

  const totalValue = lineValues.reduce((sum, line) => sum.plus(line.value), new Decimal(0));

  if (totalValue.isZero()) {
    // Edge case: all lines have zero value, distribute equally
    const equalAmount = new Decimal(landedCost.amount).div(lines.length);
    return lines.map((line) => ({
      lineId: line.id,
      allocatedAmount: equalAmount,
    }));
  }

  // Allocate proportionally
  const allocations: AllocationResult[] = [];
  let remainingAmount = new Decimal(landedCost.amount);

  for (let i = 0; i < lineValues.length; i++) {
    const isLast = i === lineValues.length - 1;

    if (isLast) {
      // Last line gets remaining to avoid rounding errors
      allocations.push({
        lineId: lineValues[i].id,
        allocatedAmount: remainingAmount,
      });
    } else {
      const proportion = lineValues[i].value.div(totalValue);
      const allocatedAmount = new Decimal(landedCost.amount).times(proportion).toDecimalPlaces(4);

      allocations.push({
        lineId: lineValues[i].id,
        allocatedAmount,
      });
      remainingAmount = remainingAmount.minus(allocatedAmount);
    }
  }

  return allocations;
}

/**
 * Calculate allocations for a landed cost using BY_QUANTITY method
 * Amount is distributed equally per unit across all lines
 */
export function allocateByQuantity(
  landedCost: { amount: Decimal },
  lines: Array<{ id: string; qtyReceived: number; unitCost: Decimal }>
): AllocationResult[] {
  // Calculate total quantity
  const totalQty = lines.reduce((sum, line) => sum + line.qtyReceived, 0);

  if (totalQty === 0) {
    // Edge case: no quantity, distribute equally by line count
    const equalAmount = new Decimal(landedCost.amount).div(lines.length);
    return lines.map((line) => ({
      lineId: line.id,
      allocatedAmount: equalAmount,
    }));
  }

  // Amount per unit
  const amountPerUnit = new Decimal(landedCost.amount).div(totalQty);

  // Allocate by quantity
  const allocations: AllocationResult[] = [];
  let remainingAmount = new Decimal(landedCost.amount);

  for (let i = 0; i < lines.length; i++) {
    const isLast = i === lines.length - 1;

    if (isLast) {
      // Last line gets remaining to avoid rounding errors
      allocations.push({
        lineId: lines[i].id,
        allocatedAmount: remainingAmount,
      });
    } else {
      const allocatedAmount = amountPerUnit.times(lines[i].qtyReceived).toDecimalPlaces(4);

      allocations.push({
        lineId: lines[i].id,
        allocatedAmount,
      });
      remainingAmount = remainingAmount.minus(allocatedAmount);
    }
  }

  return allocations;
}

/**
 * Calculate allocations based on allocation method
 */
export function calculateAllocations(
  landedCost: { amount: Decimal; allocationMethod: "VALUE" | "QUANTITY" },
  lines: Array<{ id: string; qtyReceived: number; unitCost: Decimal }>
): AllocationResult[] {
  if (landedCost.allocationMethod === "QUANTITY") {
    return allocateByQuantity(landedCost, lines);
  }
  return allocateByValue(landedCost, lines);
}

/**
 * Generate allocation preview for a goods receipt
 */
export async function generateAllocationPreview(
  prisma: PrismaClient,
  goodsReceiptId: string
): Promise<AllocationPreview[]> {
  const gr = await prisma.goodsReceipt.findUnique({
    where: { id: goodsReceiptId },
    include: {
      lines: {
        orderBy: { lineNumber: "asc" },
      },
      landedCosts: {
        where: { isAllocated: false },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!gr || gr.lines.length === 0 || gr.landedCosts.length === 0) {
    return [];
  }

  const previews: AllocationPreview[] = [];

  for (const landedCost of gr.landedCosts) {
    const allocations = calculateAllocations(
      {
        amount: new Decimal(landedCost.amount),
        allocationMethod: landedCost.allocationMethod,
      },
      gr.lines.map((line) => ({
        id: line.id,
        qtyReceived: line.qtyReceived,
        unitCost: new Decimal(line.unitCost),
      }))
    );

    // Calculate total line value for percentage display
    const totalValue = gr.lines.reduce(
      (sum, line) => sum.plus(new Decimal(line.unitCost).times(line.qtyReceived)),
      new Decimal(0)
    );
    const totalQty = gr.lines.reduce((sum, line) => sum + line.qtyReceived, 0);

    const allocationDetails = allocations.map((alloc) => {
      const line = gr.lines.find((l) => l.id === alloc.lineId)!;
      const lineValue = new Decimal(line.unitCost).times(line.qtyReceived);

      let percent: Decimal;
      if (landedCost.allocationMethod === "QUANTITY") {
        percent = totalQty > 0 ? new Decimal(line.qtyReceived).div(totalQty).times(100) : new Decimal(0);
      } else {
        percent = totalValue.gt(0) ? lineValue.div(totalValue).times(100) : new Decimal(0);
      }

      return {
        lineId: line.id,
        variantSku: line.saleorVariantSku,
        variantName: line.saleorVariantName,
        lineValue: lineValue.toFixed(4),
        lineQty: line.qtyReceived,
        allocatedAmount: alloc.allocatedAmount.toFixed(4),
        allocationPercent: percent.toFixed(2),
      };
    });

    previews.push({
      landedCostId: landedCost.id,
      costType: landedCost.costType,
      description: landedCost.description,
      totalAmount: new Decimal(landedCost.amount).toFixed(4),
      allocationMethod: landedCost.allocationMethod,
      allocations: allocationDetails,
    });
  }

  return previews;
}

/**
 * Execute allocation and save to database
 * Also updates landedCostDelta on GR lines for WAC calculation
 */
export async function executeAllocations(
  prisma: PrismaClient,
  goodsReceiptId: string
): Promise<{ success: boolean; allocatedCount: number }> {
  const gr = await prisma.goodsReceipt.findUnique({
    where: { id: goodsReceiptId },
    include: {
      lines: true,
      landedCosts: {
        where: { isAllocated: false },
      },
    },
  });

  if (!gr || gr.lines.length === 0 || gr.landedCosts.length === 0) {
    return { success: true, allocatedCount: 0 };
  }

  // Track total landed cost per line for updating the CostLayerEvent later
  const lineLandedCostTotals: Map<string, Decimal> = new Map();

  // Initialize all lines with zero
  for (const line of gr.lines) {
    lineLandedCostTotals.set(line.id, new Decimal(0));
  }

  // Process each landed cost
  for (const landedCost of gr.landedCosts) {
    const allocations = calculateAllocations(
      {
        amount: new Decimal(landedCost.amount),
        allocationMethod: landedCost.allocationMethod,
      },
      gr.lines.map((line) => ({
        id: line.id,
        qtyReceived: line.qtyReceived,
        unitCost: new Decimal(line.unitCost),
      }))
    );

    // Create allocation records
    await prisma.landedCostAllocation.createMany({
      data: allocations.map((alloc) => ({
        landedCostId: landedCost.id,
        goodsReceiptLineId: alloc.lineId,
        allocatedAmount: alloc.allocatedAmount,
      })),
    });

    // Mark landed cost as allocated
    await prisma.landedCost.update({
      where: { id: landedCost.id },
      data: { isAllocated: true },
    });

    // Accumulate totals per line
    for (const alloc of allocations) {
      const current = lineLandedCostTotals.get(alloc.lineId) || new Decimal(0);
      lineLandedCostTotals.set(alloc.lineId, current.plus(alloc.allocatedAmount));
    }
  }

  return { success: true, allocatedCount: gr.landedCosts.length };
}

/**
 * Get total allocated landed cost per unit for a GR line
 * This is used when creating CostLayerEvent during posting
 */
export async function getLandedCostPerUnit(
  prisma: PrismaClient,
  grLineId: string
): Promise<Decimal> {
  const line = await prisma.goodsReceiptLine.findUnique({
    where: { id: grLineId },
    include: {
      landedCostAllocations: true,
    },
  });

  if (!line || line.qtyReceived === 0) {
    return new Decimal(0);
  }

  const totalAllocated = line.landedCostAllocations.reduce(
    (sum, alloc) => sum.plus(new Decimal(alloc.allocatedAmount)),
    new Decimal(0)
  );

  // Return per-unit landed cost
  return totalAllocated.div(line.qtyReceived);
}

/**
 * Get total allocated landed cost for a GR line (not per unit)
 */
export async function getTotalLandedCostForLine(
  prisma: PrismaClient,
  grLineId: string
): Promise<Decimal> {
  const allocations = await prisma.landedCostAllocation.findMany({
    where: { goodsReceiptLineId: grLineId },
  });

  return allocations.reduce(
    (sum, alloc) => sum.plus(new Decimal(alloc.allocatedAmount)),
    new Decimal(0)
  );
}
