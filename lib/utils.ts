import { type ClassValue, clsx } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

const currencyFormatter = new Intl.NumberFormat("ar-IQ", {
  style: "decimal",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number): string {
  return `${currencyFormatter.format(amount)} د.ع`;
}

/**
 * Rounds a money value to 2 decimal places, matching Postgres
 * `round(numeric, 2)`'s round-half-away-from-zero behavior for the
 * always-non-negative amounts this app computes. The `Number.EPSILON`
 * nudge avoids the classic JS binary-float glitch where
 * `Math.round(1.005 * 100)` evaluates to 100 instead of 101 because 1.005
 * isn't exactly representable in IEEE754 double precision.
 */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Rounds a quantity to 3 decimal places, matching the DB's
 * numeric(10,3) precision for weighed-product quantities — applied
 * immediately when a weight is typed in, so no small float-drift
 * artifact (e.g. 1.2000000000000002) ever reaches cart state or a
 * checkout payload.
 */
export function roundQuantity(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("ar-IQ", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat("ar-IQ", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatTime(date: string | Date): string {
  return new Intl.DateTimeFormat("ar-IQ", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

/** Generates a human-friendly invoice number, e.g. INV-20260804-4821. */
export function generateInvoiceNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `INV-${y}${m}${d}-${rand}`;
}
