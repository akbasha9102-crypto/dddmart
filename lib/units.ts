/**
 * Converts a quantity expressed in a (possibly non-base) sale unit into
 * the equivalent base-unit stock quantity. Used everywhere stock is
 * incremented/decremented, so the atomic adjust_product_stock RPC always
 * receives a base-unit delta regardless of which unit was scanned/sold.
 */
export function toBaseUnits(quantity: number, conversionFactor = 1): number {
  return quantity * conversionFactor;
}
