import { describe, expect, it } from "vitest";
import { runEngine } from "../electron/oracle/ffmpeg-runtime";

describe("runEngine cancellation", () => {
  it("terminates an active decoder when its signal is aborted", async () => {
    const controller = new AbortController();
    const running = runEngine(
      "ffmpeg",
      [
        "-nostdin",
        "-hide_banner",
        "-v",
        "error",
        "-re",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000",
        "-t",
        "30",
        "-f",
        "null",
        "-",
      ],
      undefined,
      controller.signal,
    );
    setTimeout(() => controller.abort(), 50);

    await expect(running).rejects.toThrow(/canceled/i);
  });
});
