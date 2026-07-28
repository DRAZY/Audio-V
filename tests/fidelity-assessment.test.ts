import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeAudioFile } from "../electron/oracle/oracle-engine";

const fixtures = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "fidelity-engine",
);

describe("spectral-origin assessment", () => {
  it("does not flag a native wideband high-resolution control", async () => {
    const result = await analyzeAudioFile(
      path.join(fixtures, "native-wideband-96.flac"),
    );

    expect(result.verdict).toBe("verified");
    expect(result.fidelity?.classification).toBe(
      "no-strong-spectral-anomaly",
    );
    expect(result.fidelity?.confidenceType).toBeNull();
    expect(result.fidelity?.confidence).toBeNull();
    expect(result.fidelity?.ruleStrength).toBe("strong");
    expect(result.fidelity?.evidenceCoverage).toBeGreaterThanOrEqual(90);
  });

  it("routes a known MP3-to-FLAC control to conservative review", async () => {
    const result = await analyzeAudioFile(
      path.join(fixtures, "mp3-128-transcoded-to-flac.flac"),
    );

    expect(result.verdict).toBe("review");
    expect(result.confidence).toBeNull();
    expect(result.fidelity?.classification).toBe(
      "possible-lossy-transcode",
    );
    expect(result.fidelity?.reasonCode).toBe("possible-lossy-transcode");
    expect(result.fidelity?.ruleStrength).toBe("strong");
    expect(
      result.fidelity?.independentIndicators?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(result.assessments?.origin.status).toBe(
      "strong-multi-feature-pattern",
    );
  });

  it("routes a known 44.1-to-96 kHz control to conservative review", async () => {
    const result = await analyzeAudioFile(
      path.join(fixtures, "upsampled-44-to-96.flac"),
    );

    expect(result.verdict).toBe("review");
    expect(result.confidence).toBeNull();
    expect(result.fidelity?.classification).toBe("possible-upsample");
    expect(result.fidelity?.limitation).toContain("not proof");
    expect(result.fidelity?.limitation).toContain("not a probability");
    expect(result.fidelity?.analysisFftSize).toBe(4096);
    expect(result.fidelity?.stabilityPercent).toBeGreaterThanOrEqual(65);
  });

  it("explains inconclusive evidence without fabricating confidence", async () => {
    const result = await analyzeAudioFile(
      path.join(fixtures, "short-wideband-44.flac"),
    );

    expect(result.fidelity?.classification).toBe("inconclusive");
    expect(result.fidelity?.reasonCode).toBe("insufficient-duration");
    expect(result.fidelity?.confidence).toBeNull();
    expect(result.fidelity?.confidenceType).toBeNull();
    expect(result.fidelity?.evidenceCoverage).toBeGreaterThan(0);
    expect(result.fidelity?.evidenceCoverage).toBeLessThanOrEqual(45);
  });
});
