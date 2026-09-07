import { describe, expect, it } from "vitest";
import { endOfDay, startOfDay } from "@/lib/dateRange";

describe("startOfDay", () => {
  it("zeroes the time on a date that already has an arbitrary time-of-day", () => {
    const result = startOfDay(new Date("2026-08-14T15:42:07.123"));
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
    expect(result.getDate()).toBe(14);
  });

  it("leaves a date already at midnight unchanged", () => {
    const input = new Date(2026, 7, 14, 0, 0, 0, 0);
    const result = startOfDay(input);
    expect(result.getTime()).toBe(input.getTime());
  });

  it("does not mutate the input Date", () => {
    const input = new Date("2026-08-14T15:42:07.123");
    const originalTime = input.getTime();
    startOfDay(input);
    expect(input.getTime()).toBe(originalTime);
  });
});

describe("endOfDay", () => {
  it("maxes the time on a date that already has an arbitrary time-of-day", () => {
    const result = endOfDay(new Date("2026-08-14T09:05:00.000"));
    expect(result.getHours()).toBe(23);
    expect(result.getMinutes()).toBe(59);
    expect(result.getSeconds()).toBe(59);
    expect(result.getMilliseconds()).toBe(999);
    expect(result.getDate()).toBe(14);
  });

  it("moves a date already at midnight to the end of that same calendar day", () => {
    const input = new Date(2026, 7, 14, 0, 0, 0, 0);
    const result = endOfDay(input);
    expect(result.getDate()).toBe(14);
    expect(result.getHours()).toBe(23);
  });

  it("does not mutate the input Date", () => {
    const input = new Date("2026-08-14T09:05:00.000");
    const originalTime = input.getTime();
    endOfDay(input);
    expect(input.getTime()).toBe(originalTime);
  });
});

describe("startOfDay and endOfDay together", () => {
  it("produce a non-zero-width window for a same-day range", () => {
    const day = new Date("2026-08-14T12:00:00.000");
    expect(endOfDay(day).getTime()).toBeGreaterThan(startOfDay(day).getTime());
  });
});
