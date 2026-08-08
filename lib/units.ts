/**
 * Converts a quantity expressed in a (possibly non-base) sale unit into
 * the equivalent base-unit stock quantity. Used everywhere stock is
 * incremented/decremented, so the atomic adjust_product_stock RPC always
 * receives a base-unit delta regardless of which unit was scanned/sold.
 */
export function toBaseUnits(quantity: number, conversionFactor = 1): number {
  return quantity * conversionFactor;
}

/**
 * Converts a cost price paid per (possibly non-base) purchase unit into
 * the equivalent cost per base unit. Inverse relationship to toBaseUnits:
 * quantity scales up by conversionFactor, cost-per-unit scales down by it.
 */
export function toBaseUnitCost(costPerUnit: number, conversionFactor = 1): number {
  return costPerUnit / conversionFactor;
}
