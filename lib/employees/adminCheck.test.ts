import { describe, expect, it } from "vitest";
import { isAdminRole, isSelfLockout } from "@/lib/employees/adminCheck";

describe("isAdminRole", () => {
  it("returns true for an admin role", () => {
    expect(isAdminRole("admin")).toBe(true);
  });

  it("returns false for a cashier role", () => {
    expect(isAdminRole("cashier")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAdminRole(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe("isSelfLockout", () => {
  it("rejects when the caller tries to deactivate their own account", () => {
    expect(isSelfLockout("user-1", "user-1", true)).toBe(true);
  });

  it("allows the caller to reactivate their own account", () => {
    expect(isSelfLockout("user-1", "user-1", false)).toBe(false);
  });

  it("allows deactivating a different account", () => {
    expect(isSelfLockout("user-2", "user-1", true)).toBe(false);
  });

  it("allows activating a different account", () => {
    expect(isSelfLockout("user-2", "user-1", false)).toBe(false);
  });
});
