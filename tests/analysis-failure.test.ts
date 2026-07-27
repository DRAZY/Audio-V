import { describe, expect, it } from "vitest";
import {
  classifyOracleFailure,
  OracleStageError,
} from "../electron/oracle/analysis-failure";
import { EngineProcessError } from "../electron/oracle/ffmpeg-runtime";

describe("Oracle failure classification", () => {
  it("classifies decoder-reported corruption as a deterministic file failure", () => {
    const error = new OracleStageError(
      "full-decode",
      new EngineProcessError(
        "ffmpeg decode failed",
        "ffmpeg",
        "exit",
        "Invalid data found when processing input: packet corrupt",
        1,
      ),
    );

    expect(classifyOracleFailure(error)).toEqual({
      category: "file-integrity",
      stage: "full-decode",
      code: "DECODE_INTEGRITY_FAILED",
      summary:
        "The decoder reported deterministic corruption while reading the audio stream.",
      evidence: "Invalid data found when processing input: packet corrupt",
    });
  });

  it("does not call an unavailable engine file damage", () => {
    const error = new OracleStageError(
      "stream-probe",
      new EngineProcessError(
        "ffprobe could not start: executable not found",
        "ffprobe",
        "launch",
      ),
    );

    expect(classifyOracleFailure(error)).toMatchObject({
      category: "analysis-error",
      stage: "stream-probe",
      code: "ENGINE_UNAVAILABLE",
    });
  });

  it("does not call a timeout or unknown internal exception file damage", () => {
    const timeout = classifyOracleFailure(
      new OracleStageError(
        "signal-measurement",
        new EngineProcessError(
          "ffmpeg exceeded the 30-minute analysis limit.",
          "ffmpeg",
          "timeout",
        ),
      ),
    );
    const internal = classifyOracleFailure(new Error("Unexpected accumulator fault"));

    expect(timeout).toMatchObject({
      category: "analysis-error",
      stage: "signal-measurement",
      code: "ENGINE_TIMEOUT",
    });
    expect(internal).toMatchObject({
      category: "analysis-error",
      stage: "oracle-engine",
      code: "ORACLE_INTERNAL_ERROR",
    });
  });
});
