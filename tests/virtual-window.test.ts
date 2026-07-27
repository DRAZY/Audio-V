import { describe, expect, it } from "vitest";
import { createVirtualWindow } from "../shared/virtual-window";

describe("createVirtualWindow", () => {
  it("bounds a 10,000-row library to the visible rows plus overscan", () => {
    const items = Array.from({ length: 10_000 }, (_, index) => index);
    const window = createVirtualWindow(items, 190_000, 760, 38, 8);

    expect(window.items.length).toBeLessThanOrEqual(36);
    expect(window.start).toBe(4_992);
    expect(window.items[0]).toBe(4_992);
    expect(window.paddingTop + window.paddingBottom).toBeGreaterThan(370_000);
  });

  it("clamps the first and last windows safely", () => {
    const items = Array.from({ length: 100 }, (_, index) => index);

    expect(createVirtualWindow(items, -100, 380, 38, 4).start).toBe(0);
    const lastWindow = createVirtualWindow(items, 99_999, 380, 38, 4);
    expect(lastWindow.end).toBe(100);
    expect(lastWindow.items.length).toBeGreaterThan(0);
    expect(lastWindow.paddingBottom).toBe(0);
  });

  it("keeps rows rendered when an incremental update leaves a stale scroll offset", () => {
    const items = Array.from({ length: 2_525 }, (_, index) => index);
    const window = createVirtualWindow(items, 999_999, 418, 38, 8);

    expect(window.items.length).toBeGreaterThan(0);
    expect(window.end).toBe(items.length);
    expect(window.items.at(-1)).toBe(items.at(-1));
    expect(window.paddingBottom).toBe(0);
  });

  it("returns an empty zero-height window for an empty result set", () => {
    expect(createVirtualWindow([], 50_000, 418, 38, 8)).toEqual({
      items: [],
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });
});
