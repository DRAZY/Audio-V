import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runEngine } from "../electron/oracle/ffmpeg-runtime";
import { compareAudioFiles } from "../electron/oracle/signal-comparison";

let temporaryDirectory = "";

afterEach(async () => {
  if (temporaryDirectory) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = "";
  }
});

describe("compareAudioFiles", () => {
  it("performs a full-track null across every matching channel", async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(process.cwd(), "tests", ".tmp-null-"),
    );
    const file = path.join(temporaryDirectory, "stereo.wav");
    await runEngine("ffmpeg", [
      "-nostdin", "-hide_banner", "-v", "error",
      "-f", "lavfi", "-i",
      "aevalsrc=0.2*sin(2*PI*440*t)|0.15*sin(2*PI*660*t):s=48000:d=1",
      "-c:a", "pcm_s24le", "-y", file,
    ]);

    const result = await compareAudioFiles(file, file);

    expect(result.fullTrack).toBe(true);
    expect(result.comparedChannels).toBe(2);
    expect(result.durationCoveragePercent).toBeGreaterThan(99);
    expect(result.perChannel).toHaveLength(2);
    expect(result.perChannel.every((channel) => channel.nullDepthDb === Infinity))
      .toBe(true);
  });
});
