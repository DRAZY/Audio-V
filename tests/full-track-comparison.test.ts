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

  it("null-tests an explicit channel map across differing layouts", async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(process.cwd(), "tests", ".tmp-channel-map-"),
    );
    const stereo = path.join(temporaryDirectory, "stereo.wav");
    const mono = path.join(temporaryDirectory, "mono.wav");
    await runEngine("ffmpeg", [
      "-nostdin", "-hide_banner", "-v", "error",
      "-f", "lavfi", "-i",
      "aevalsrc=0.2*sin(2*PI*440*t)|0.15*sin(2*PI*660*t):s=48000:d=1",
      "-c:a", "pcm_s24le", "-y", stereo,
    ]);
    await runEngine("ffmpeg", [
      "-nostdin", "-hide_banner", "-v", "error",
      "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=1",
      "-af", "volume=0.15/0.125",
      "-c:a", "pcm_s24le", "-y", mono,
    ]);

    const fallback = await compareAudioFiles(stereo, mono);
    expect(fallback.fullTrack).toBe(false);
    expect(fallback.limitation).toContain("requires matching channel counts");

    const mapped = await compareAudioFiles(
      stereo,
      mono,
      undefined,
      [{ leftChannel: 1, rightChannel: 0 }],
    );
    expect(mapped.method).toBe("Audio-V explicit channel-map null v3");
    expect(mapped.fullTrack).toBe(true);
    expect(mapped.comparedChannels).toBe(1);
    expect(mapped.perChannel[0]).toMatchObject({
      leftChannel: 1,
      rightChannel: 0,
    });
    expect(mapped.perChannel[0].nullDepthDb).toBeGreaterThan(70);
  });

  it("does not call unrelated periodic signals equivalent from a short overlap", async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(process.cwd(), "tests", ".tmp-distinct-null-"),
    );
    const left = path.join(temporaryDirectory, "left.flac");
    const right = path.join(temporaryDirectory, "right.flac");
    await runEngine("ffmpeg", [
      "-nostdin", "-hide_banner", "-v", "error",
      "-f", "lavfi", "-i",
      "sine=frequency=440:sample_rate=48000:duration=2",
      "-ac", "2", "-c:a", "flac", "-y", left,
    ]);
    await runEngine("ffmpeg", [
      "-nostdin", "-hide_banner", "-v", "error",
      "-f", "lavfi", "-i",
      "sine=frequency=880:sample_rate=48000:duration=2",
      "-ac", "2", "-c:a", "flac", "-y", right,
    ]);

    const result = await compareAudioFiles(left, right);

    expect(result.fullTrack).toBe(true);
    expect(result.durationCoveragePercent).toBeLessThan(20);
    expect(result.relationship).toBe("distinct");
  });
});
