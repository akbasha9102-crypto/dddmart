import { describe, expect, it } from "vitest";
import { isSettingsPath, visibleSettingsLinks } from "@/components/shared/navLinks";

describe("isSettingsPath", () => {
  it("returns true for the settings page itself", () => {
    expect(isSettingsPath("/settings")).toBe(true);
  });

  it("returns true for sales, customers, archive, and employees pages", () => {
    expect(isSettingsPath("/sales")).toBe(true);
    expect(isSettingsPath("/customers")).toBe(true);
    expect(isSettingsPath("/archive")).toBe(true);
    expect(isSettingsPath("/employees")).toBe(true);
  });

  it("returns true for nested sub-paths", () => {
    expect(isSettingsPath("/employees/123")).toBe(true);
    expect(isSettingsPath("/settings/store")).toBe(true);
  });

  it("returns false for unrelated paths", () => {
    expect(isSettingsPath("/pos")).toBe(false);
    expect(isSettingsPath("/inventory")).toBe(false);
  });
});

describe("visibleSettingsLinks", () => {
  it("includes admin-only links for an admin role", () => {
    const hrefs = visibleSettingsLinks("admin").map((link) => link.href);
    expect(hrefs).toEqual(["/sales", "/customers", "/archive", "/employees", "/suppliers", "/settings/store"]);
  });

  it("excludes admin-only links for a cashier role", () => {
    const hrefs = visibleSettingsLinks("cashier").map((link) => link.href);
    expect(hrefs).toEqual(["/customers", "/archive"]);
  });

  it("excludes admin-only links for a null role", () => {
    const hrefs = visibleSettingsLinks(null).map((link) => link.href);
    expect(hrefs).toEqual(["/customers", "/archive"]);
  });
});
