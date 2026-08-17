import type { UserRole } from "@/types/database.types";

/**
 * Pure decision logic for the employee-management API routes, kept separate
 * from the actual Supabase I/O (fetching role, resolving user id) so it's
 * unit-testable without a fake Supabase client.
 */

/** True only for the literal "admin" role — everything else (cashier, null, undefined) is rejected. */
export function isAdminRole(role: UserRole | string | null | undefined): boolean {
  return role === "admin";
}

/**
 * True when an admin is attempting to deactivate their own account — the
 * one case the API must block to avoid a full lockout. Self-reactivation is
 * harmless and is NOT blocked.
 */
export function isSelfLockout(targetId: string, callerId: string, willDeactivate: boolean): boolean {
  return willDeactivate && targetId === callerId;
}

/**
 * True when the admin making the request is the same account as the one
 * being edited — used to block ALL self-mutation (edit/reset
 * password/delete) through the employee-management route, not just
 * self-deactivation.
 */
export function isSelfTarget(targetId: string, callerId: string): boolean {
  return targetId === callerId;
}
