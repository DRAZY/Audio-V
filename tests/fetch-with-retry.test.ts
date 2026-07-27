import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The provisioning helper is intentionally a Node ESM script.
import { fetchWithRetry } from "../scripts/fetch-with-retry.mjs";

describe("fetchWithRetry", () => {
  it("retries transient connection failures with bounded backoff", async () => {
    const fetchImplementation = vi
      .fn()
      .mockRejectedValueOnce(new Error("connect timeout"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const wait = vi.fn().mockResolvedValue(undefined);

    const response = await fetchWithRetry(
      "https://example.invalid/pinned-engine",
      {},
      {
        attempts: 3,
        baseDelayMs: 25,
        fetchImplementation,
        wait,
      },
    );

    expect(response.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(25);
  });

  it("does not retry a definitive client response", async () => {
    const response = { ok: false, status: 404 };
    const fetchImplementation = vi.fn().mockResolvedValue(response);
    const wait = vi.fn();

    await expect(
      fetchWithRetry("https://example.invalid/missing", {}, {
        fetchImplementation,
        wait,
      }),
    ).resolves.toBe(response);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("fails after the configured attempt limit", async () => {
    const fetchImplementation = vi
      .fn()
      .mockRejectedValue(new Error("offline"));

    await expect(
      fetchWithRetry("https://example.invalid/offline", {}, {
        attempts: 2,
        baseDelayMs: 1,
        fetchImplementation,
        wait: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow("Download failed after 2 attempts");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });
});
