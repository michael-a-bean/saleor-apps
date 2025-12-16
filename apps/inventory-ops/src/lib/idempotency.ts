/**
 * Generate idempotency keys for Saleor mutations to prevent duplicate operations
 */

export type IdempotencyKeyParams = {
  goodsReceiptId: string;
  lineId: string;
  operation: "post" | "reverse";
};

/**
 * Generate a unique idempotency key for a goods receipt line operation
 */
export function generateIdempotencyKey(params: IdempotencyKeyParams): string {
  return `gr-${params.goodsReceiptId}-line-${params.lineId}-${params.operation}`;
}

/**
 * Parse an idempotency key back to its components
 */
export function parseIdempotencyKey(key: string): IdempotencyKeyParams | null {
  const match = key.match(/^gr-(.+)-line-(.+)-(post|reverse)$/);

  if (!match) {
    return null;
  }

  return {
    goodsReceiptId: match[1],
    lineId: match[2],
    operation: match[3] as "post" | "reverse",
  };
}
