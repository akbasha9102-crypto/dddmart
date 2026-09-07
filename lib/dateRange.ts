/**
 * Returns a NEW Date set to the very start of the given date's calendar day
 * (00:00:00.000), without mutating the Date passed in. Used wherever a
 * date-range's start bound must include the entire first day regardless of
 * what time-of-day it was originally constructed with.
 */
export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Returns a NEW Date set to the very end of the given date's calendar day
 * (23:59:59.999), without mutating the Date passed in. Custom date ranges
 * built from a raw `<input type="date">` value parse to midnight — without
 * this correction, an inclusive "end date" silently excludes almost the
 * entire last day from any query built from it (this exact bug was fixed
 * once in SalesExportModal's toExportRange and then reintroduced in
 * useSalesAnalytics's resolveRange — hence being pulled out here as shared
 * logic so it can't be forgotten a third time).
 */
export function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}
