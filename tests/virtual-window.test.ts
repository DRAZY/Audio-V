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
    expect(createVirtualWindow(items, 99_999, 380, 38, 4).end).toBe(100);
  });
});
