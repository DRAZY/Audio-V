import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeAudioFile } from "../electron/oracle/oracle-engine";
import { pcmWave } from "./helpers/wave-fixture";

const temporaryDirectories: string[] = [];

async function writeAudio(name: string, bytes: Buffer): Promise<string> {
  const directory = await fs.mkdtemp(path.join(process.cwd(), "tests/.tmp-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, name);
  await fs.writeFile(filePath, bytes);
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("analyzeAudioFile", () => {
  it("returns a scoped clear verdict when current deterministic checks pass", async () => {
    const filePath = await writeAudio("clean.wav", pcmWave({ seconds: 0.25 }));

    const result = await analyzeAudioFile(filePath);

    expect(result.verdict).toBe("verified");
    expect(result.confidence).toBe(100);
    expect(result.scope).toBe("oracle-integrity-fidelity-v5");
    expect(result.headline).toBe("Current checks passed");
    expect(result.measurements?.frames).toBe(11_025);
    expect(result.evidence[0].kind).toBe("deterministic");
    expect(result.measuredAt).not.toBeNull();
  });

  it("routes clipped audio to review without calling it damaged", async () => {
    const filePath = await writeAudio(
      "clipped.wav",
      pcmWave({ seconds: 0.25, amplitude: 1.2 }),
    );

    const result = await analyzeAudioFile(filePath);

    expect(result.verdict).toBe("review");
    expect(result.confidence).toBe(100);
    expect(result.measurements?.clippedSamples).toBeGreaterThan(0);
    expect(result.headline).toBe("Review signal findings");
    expect(result.interpretation).toContain("clipped samples");
  });

  it("returns a deterministic damage verdict for a truncated WAVE stream", async () => {
    const valid = pcmWave({ seconds: 0.1 });
    const filePath = await writeAudio(
      "truncated.wav",
      valid.subarray(0, valid.length - 7),
    );

    const result = await analyzeAudioFile(filePath);

    expect(result.verdict).toBe("damaged");
    expect(result.confidence).toBe(100);
    expect(result.measurements).toBeNull();
    expect(result.evidence[0].disposition).toBe("contradicts");
  });

  it("returns a deterministic damage verdict for an invalid FLAC stream", async () => {
    const filePath = await writeAudio("track.flac", Buffer.from("fLaC"));

    const result = await analyzeAudioFile(filePath);

    expect(result.verdict).toBe("damaged");
    expect(result.measurements).toBeNull();
    expect(result.headline).toBe("Audio stream integrity failed");
  });
});
