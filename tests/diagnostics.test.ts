import { describe, expect, it } from "vitest";
import { createPrivacySafeDiagnostics } from "../electron/diagnostics";

describe("privacy-safe diagnostics", () => {
  it("aggregates session state without accepting identity or evidence fields", () => {
    const diagnostics = createPrivacySafeDiagnostics({
      generatedAt: "2026-07-26T00:00:00.000Z",
      application: {
        version: "0.1.0",
        packaged: true,
        platform: "darwin",
        architecture: "arm64",
      },
      runtime: {
        electron: "39.8.10",
        chrome: "test",
        node: "22",
        oracleWorkerCount: 2,
      },
      sessions: [
        { status: "completed" },
        { status: "failed" },
        { status: "completed" },
      ],
      engineManifest: { oracleEngine: { version: "test" } },
    });
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics.sessions).toEqual({
      total: 3,
      statuses: { completed: 2, failed: 1 },
    });
    expect(serialized).not.toContain("fixture.flac");
    expect(serialized).not.toContain("/music");
    expect(serialized).not.toContain("sha256");
  });
});
